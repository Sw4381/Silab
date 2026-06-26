// member-performance.js - 멤버별 종합 실적 집계 (로그인 전용)
// 설정값은 config.js 참조 (firebaseConfig, ALLOWED_EMAIL)
//
// 데이터 출처
//   members/{phd,ms,bs}                  : 현재 구성원 (parttime / alumni / professor 제외)
//   publications/{sci,kci,other}         : 논문(SCI/KCI/Conference) + 수상(award 필드)
//   performance/__track__/patents        : 특허(출원/등록)
//   memberPerfAliases/{memberKey}        : 멤버별 저자 표기(별칭) — 영문/이니셜 정확매칭용
//                                          (DB 규칙에 관리자 read/write 허용 필요)
//
// 매칭 규칙 (정확 일치만 인정, 애매한 부분일치는 제외)
//   - 한글 저자 토큰: 이름 "완전일치"만 인정 (예: '이선우' === '이선우')
//   - 영문/이니셜 토큰: 멤버에 등록된 별칭과 정규화 후 "완전일치"할 때만 인정 ('Lee'처럼 성만 → 제외)
//   - 특허 label(예: '선우(GNN)'): 이름 끝일치(닉네임) 또는 별칭 일치 — 트래커 라벨은 관리자가 큐레이션
//
// 점수 = Σ (항목 가중치 × 저자 가중치)

// ==================== 상수 ====================
const TRACK_KEY = '__track__';
const ALIAS_PATH = 'memberPerfAliases';        // DB 규칙에 read/write 허용 필요(관리자)
const PATENT_MAP_PATH = 'memberPerfPatents';   // 특허 발명자 매핑 {patentId:{member,status}}
const EXT = '__ext__';                          // 외부/해당없음(확인됨) 표식
const PATENT_STATUS = [
    { v: 'applied',    label: '출원', color: 'blue' },
    { v: 'registered', label: '등록(완료)', color: 'red' }
];
function patentStatusDef(v) { return PATENT_STATUS.find(s => s.v === v) || PATENT_STATUS[0]; }

const SECTIONS = [
    { key: 'phd', label: '박사과정', short: '박사' },
    { key: 'ms',  label: '석사과정', short: '석사' },
    { key: 'bs',  label: '학부연구생', short: '학부' }
];

// 실적 점수표 (항목 × 주저자/공동). SCIE는 JIF 백분위로 3단계.
const SCORE = {
    confDom:  { first: 1, co: 0 },
    confIntl: { first: 2, co: 0.5 },
    kci:      { first: 2, co: 0.5 },
    sci90:    { first: 8, co: 2 },     // SCIE JIF 백분위 90↑
    sci75:    { first: 6, co: 1.5 },   // SCIE 75↑
    sciOther: { first: 4, co: 1 }      // SCIE 그 외(또는 백분위 미입력)
};
const PATENT_SCORE = { registered: 2, applied: 1 };   // 특허 등록 2 / 출원 1
const AWARD_SCORE = 1;                                 // 수상 1인당
function sciTier(pct) { pct = Number(pct); if (pct >= 90) return 'sci90'; if (pct >= 75) return 'sci75'; return 'sciOther'; }
function scoreKey(pub) { return pub._cat === 'sci' ? sciTier(pub.percentile) : pub._cat; }

const CATS = [
    { key: 'sci',      label: 'SCI',  cls: 'cat-sci' },
    { key: 'kci',      label: 'KCI',  cls: 'cat-kci' },
    { key: 'confIntl', label: '국제', cls: 'cat-ci'  },
    { key: 'confDom',  label: '국내', cls: 'cat-cd'  },
    { key: 'award',    label: '수상', cls: 'cat-aw'  }
];

const ALLOWED_USERS = [ALLOWED_EMAIL];

// ==================== 전역 상태 ====================
let auth, database;
let currentUser = null;
const state = {
    members: [],     // [{key, section, name, ..., _kor:Set, _lat:Set}]
    aliases: {},     // {memberKey: "표기1; 표기2"}
    pubs: [],
    patents: [],
    awards: [],
    firstOnly: false,
    sort: 'score',
    query: ''
};

let loginBtn, logoutBtn, loginModal, loginClose, userInfo, userName, authGate, mpApp;

// ==================== 유틸 ====================
function esc(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmt = n => (Math.round(Number(n) * 100) / 100).toString();
function showAlert(message, type) {
    const el = document.createElement('div');
    el.className = `perf-alert ${type || 'info'}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

// --- 이름 정규화 ---
function hasHangul(s) { return /[가-힣]/.test(String(s || '')); }
// 토큰에서 한글 이름만 추출 (앞쪽 한글 2~5자)
function korName(token) { const m = String(token || '').match(/[가-힣]{2,5}/); return m ? m[0] : ''; }
// 영문/이니셜 정규화: 소문자 + 영숫자만 ("S. W. Lee" -> "swlee", "L.S.W" -> "lsw")
function normLatin(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
// 별칭 문자열 -> 표기 배열 (세미콜론/줄바꿈 구분)
function parseAliases(s) { return String(s || '').split(/[;\n]/).map(t => t.trim()).filter(Boolean); }

// 저자 문자열 -> 저자 토큰 배열 (순서 유지, 첫 항목 = 1저자)
function parseAuthors(s) {
    return String(s || '')
        .split(/[,，;、]/)
        .map(t => t.replace(/[*†‡✝0-9\[\]<>]/g, '').replace(/교신저자|제1저자|공동저자|교신|저자/g, '').trim())
        .filter(Boolean);
}

// 멤버 이름 "한글(English)" 파싱
function parseMemberName(name) {
    const s = String(name || '');
    const pm = s.match(/\(([^)]*)\)/);
    const eng = pm ? pm[1].trim() : '';
    const before = s.split('(')[0];
    return { kor: korName(before) || before.trim(), eng };
}
// 영문 이름 -> 정규화된 매칭 후보들 (성은 마지막 토큰으로 가정 / 서양식)
//  "Sun Woo Lee" -> {sunwoolee, leesunwoo, swlee, leesw}
function genLatinForms(eng) {
    const forms = new Set();
    const clean = String(eng || '').replace(/[._\-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return forms;
    const full = normLatin(clean);
    if (full) forms.add(full);
    const parts = clean.split(' ').filter(Boolean);
    if (parts.length >= 2) {
        const surname = parts[parts.length - 1];
        const given = parts.slice(0, -1);
        const gFull = given.join('');
        const gInit = given.map(g => g[0]).join('');
        [gFull + surname, surname + gFull, gInit + surname, surname + gInit].forEach(x => {
            const n = normLatin(x); if (n) forms.add(n);
        });
    }
    return forms;
}
// 멤버에 한글/영문 표기 Set 부여 (이름 괄호 영문 + 수동 별칭)
function buildMemberForms(m) {
    m._kor = new Set();
    m._lat = new Set();
    const { kor, eng } = parseMemberName(m.name);
    m._korName = kor;
    if (kor) m._kor.add(kor);
    if (eng) genLatinForms(eng).forEach(x => m._lat.add(x));
    parseAliases(state.aliases[m.key]).forEach(f => {
        if (!f) return;
        if (hasHangul(f)) { const k = korName(f) || f.trim(); if (k) m._kor.add(k); }
        else genLatinForms(f).forEach(x => m._lat.add(x));
    });
}

// 논문 저자 토큰 ↔ 멤버 정확매칭
function pubAuthorMatch(token, m) {
    if (hasHangul(token)) { const k = korName(token); return !!k && m._kor.has(k); }
    const n = normLatin(token);
    return n.length >= 2 && m._lat.has(n);
}

// 논문 카테고리
function pubCategory(pub) {
    if (pub.type === 'sci') return 'sci';
    if (pub.type === 'kci') return 'kci';
    return hasHangul(pub.journal) ? 'confDom' : 'confIntl';   // other = Conference
}

// 특허 label 발명자 토큰
function patentToken(label) { return String(label || '').split(/[（(]/)[0].trim(); }
// 특허 ↔ 멤버 매칭 (정확 + 닉네임 끝일치 + 별칭)
function matchPatentMember(token, members) {
    if (!token) return null;
    const kt = korName(token) || token;
    let m = members.find(x => x._kor.has(kt));
    if (m) return m;
    // 닉네임(이름 끝) 일치 — 멤버명의 한글 부분으로 비교 (예: 라벨 '선우' ↔ '이선우')
    if (hasHangul(kt) && kt.length >= 2) {
        const c = members.filter(x => x._korName && x._korName.endsWith(kt));
        if (c.length === 1) return c[0];
        if (c.length > 1) return c.sort((a, b) => Math.abs(a._korName.length - kt.length) - Math.abs(b._korName.length - kt.length))[0];
    }
    const n = normLatin(token);
    if (n.length >= 2) { m = members.find(x => x._lat.has(n)); if (m) return m; }
    return null;
}

// ==================== 인증 ====================
async function loginUser(email, password) {
    if (!ALLOWED_USERS.includes(email)) throw new Error('접근 권한이 없습니다. 연구실 멤버만 사용할 수 있습니다.');
    try {
        return await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (error.code === 'auth/user-not-found') return await auth.createUserWithEmailAndPassword(email, password);
        if (error.code === 'auth/wrong-password') throw new Error('비밀번호가 틀렸습니다.');
        if (error.code === 'auth/invalid-email') throw new Error('이메일 형식이 올바르지 않습니다.');
        throw error;
    }
}
function updateAuthUI() {
    const authed = !!currentUser;
    if (loginBtn)  loginBtn.style.display  = authed ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = authed ? 'flex' : 'none';
    if (userInfo)  userInfo.style.display  = authed ? 'flex' : 'none';
    if (userName && currentUser) userName.textContent = currentUser.email;
    if (authGate) authGate.style.display = authed ? 'none' : 'flex';
    if (mpApp)    mpApp.style.display    = authed ? 'block' : 'none';
}

// ==================== 데이터 로드 ====================
async function loadData() {
    const [memSnap, sciSnap, kciSnap, otherSnap, patSnap, awardSnap] = await Promise.all([
        database.ref('members').once('value'),
        database.ref('publications/sci').once('value'),
        database.ref('publications/kci').once('value'),
        database.ref('publications/other').once('value'),
        database.ref(`performance/${TRACK_KEY}/patents`).once('value'),
        database.ref('awards').once('value')
    ]);

    // 별칭은 별도로 읽되, 권한/네트워크 실패해도 페이지는 계속 동작
    try {
        const aliasSnap = await database.ref(ALIAS_PATH).once('value');
        state.aliases = aliasSnap.val() || {};
    } catch (e) {
        state.aliases = {};
        console.warn('별칭 로드 실패(무시):', e.message);
    }

    const mem = memSnap.val() || {};
    const members = [];
    SECTIONS.forEach(sec => {
        Object.entries(mem[sec.key] || {}).forEach(([key, m]) => {
            members.push({
                key, section: sec.key,
                name: (m.name || '').trim(),
                role: m.role || '', degree: m.degree || '',
                research: m.research || '', photo: m.photo || '',
                order: m.order || 0
            });
        });
    });
    members.sort((a, b) => {
        const d = SECTIONS.findIndex(s => s.key === a.section) - SECTIONS.findIndex(s => s.key === b.section);
        return d || (a.order - b.order);
    });
    members.forEach(buildMemberForms);
    state.members = members;

    const collect = (snap, type) => Object.entries(snap.val() || {}).map(([id, v]) => ({
        id, type,
        title: v.title || '', authors: v.authors || '',
        journal: v.journal || '', award: (v.award || '').trim(),
        url: v.url || '', percentile: v.percentile,
        _cat: pubCategory({ type, journal: v.journal }),
        _tokens: parseAuthors(v.authors)
    }));
    state.pubs = [...collect(sciSnap, 'sci'), ...collect(kciSnap, 'kci'), ...collect(otherSnap, 'other')];

    state.patents = Object.entries(patSnap.val() || {}).map(([id, v]) => ({ id, ...v }));

    // 수상: content "수상자1, 수상자2, … - 상세 (날짜)" 형식에서 ' - ' 앞을 수상자로 파싱
    state.awards = Object.entries(awardSnap.val() || {}).map(([id, v]) => {
        const content = v.content || '';
        const names = content.includes(' - ')
            ? content.split(' - ')[0].split(/[,，、]/).map(s => s.trim()).filter(Boolean)
            : [];
        return { id, content, highlight: v.highlight || '', date: v.date || '', _names: names };
    });

    render();
}

// ==================== 집계 ====================
function emptyMetrics() {
    const m = { score: 0, papersTotal: 0, patentTotal: 0, awardTotal: 0,
        patent: { reg: 0, app: 0 }, items: { pubs: [], patents: [], awards: [] } };
    CATS.forEach(c => { m[c.key] = { first: 0, co: 0 }; });
    return m;
}
function catCount(b, key) { return (b[key].first || 0) + (b[key].co || 0); }

function aggregate() {
    const buckets = new Map();
    state.members.forEach(m => buckets.set(m.key, { member: m, ...emptyMetrics() }));
    const matchedPubIds = new Set();
    const unassignedPatents = [];

    state.pubs.forEach(pub => {
        state.members.forEach(m => {
            const idx = pub._tokens.findIndex(t => pubAuthorMatch(t, m));
            if (idx < 0) return;
            const isFirst = idx === 0;
            if (state.firstOnly && !isFirst) return;
            matchedPubIds.add(pub.id);
            const b = buckets.get(m.key);
            const pos = isFirst ? 'first' : 'co';
            b[pub._cat][pos]++;
            b.papersTotal++;
            b.items.pubs.push({ ...pub, isFirst });
            b.score += (SCORE[scoreKey(pub)][pos] || 0);
        });
    });

    state.patents.forEach(p => {
        const m = matchPatentMember(patentToken(p.label), state.members);
        if (!m) { unassignedPatents.push(p); return; }
        const b = buckets.get(m.key);
        if (patentStatusDef(p.status).v === 'registered') { b.patent.reg++; b.score += PATENT_SCORE.registered; }
        else { b.patent.app++; b.score += PATENT_SCORE.applied; }
        b.patentTotal++;
        b.items.patents.push(p);
    });

    // 수상 (awards 노드) — 수상자 첫 항목 = 대표(1.0), 나머지 공동(0.3)
    state.awards.forEach(a => {
        if (!a._names || !a._names.length) return;
        state.members.forEach(m => {
            const idx = a._names.findIndex(n => { const k = korName(n); return !!k && m._kor.has(k); });
            if (idx < 0) return;
            const isFirst = idx === 0;
            const b = buckets.get(m.key);
            const pos = isFirst ? 'first' : 'co';
            b.award[pos]++;
            b.awardTotal++;
            b.items.awards.push({ ...a, isFirst });
            b.score += AWARD_SCORE;
        });
    });

    const unmatchedPubs = state.pubs.filter(p => !matchedPubIds.has(p.id));
    return { rows: [...buckets.values()], unassignedPatents, unmatchedPubs };
}

// ==================== 렌더 ====================
function sectionShort(secKey) { const s = SECTIONS.find(x => x.key === secKey); return s ? s.short : ''; }

function sortRows(rows) {
    const arr = rows.slice();
    if (state.sort === 'name')        arr.sort((a, b) => a.member.name.localeCompare(b.member.name, 'ko'));
    else if (state.sort === 'sci')    arr.sort((a, b) => catCount(b, 'sci') - catCount(a, 'sci') || b.score - a.score);
    else if (state.sort === 'papers') arr.sort((a, b) => b.papersTotal - a.papersTotal || b.score - a.score);
    else if (state.sort === 'patents') arr.sort((a, b) => b.patentTotal - a.patentTotal || b.score - a.score);
    else arr.sort((a, b) => b.score - a.score || b.papersTotal - a.papersTotal);
    return arr;
}

function render() {
    const { rows, unassignedPatents, unmatchedPubs } = aggregate();
    renderStatCards(rows);
    const q = (state.query || '').trim().toLowerCase();
    const view = q ? rows.filter(r => (r.member.name || '').toLowerCase().includes(q)) : rows;
    const sorted = sortRows(view);
    renderTable(sorted);
    renderCards(sorted);
    renderUnassigned(unassignedPatents, unmatchedPubs);
}

function renderStatCards(rows) {
    const el = document.getElementById('mpStatCards');
    if (!el) return;
    const totMembers = rows.length;
    const active = rows.filter(r => r.papersTotal + r.patentTotal + r.awardTotal > 0).length;
    const sci = state.pubs.filter(p => p._cat === 'sci').length;
    const kci = state.pubs.filter(p => p._cat === 'kci').length;
    const conf = state.pubs.filter(p => p._cat === 'confIntl' || p._cat === 'confDom').length;
    const awards = (state.awards || []).length;
    const patReg = state.patents.filter(p => patentStatusDef(p.status).v === 'registered').length;
    const patApp = state.patents.length - patReg;

    const cards = [
        { icon: 'fa-users',       label: '현재 구성원', main: `${active}/${totMembers}`, sub: '실적보유 / 전체' },
        { icon: 'fa-file-lines',  label: '논문 SCI',    main: `${sci}`, sub: `KCI ${kci} · 컨퍼 ${conf}` },
        { icon: 'fa-certificate', label: '특허',        main: `${patReg}<span class="mp-card-unit">등록</span>`, sub: `출원 ${patApp}건` },
        { icon: 'fa-trophy',      label: '수상',        main: `${awards}`, sub: '수상 논문' }
    ];
    el.innerHTML = cards.map(c => `
        <div class="mp-stat-card">
            <div class="mp-stat-icon"><i class="fas ${c.icon}"></i></div>
            <div class="mp-stat-body">
                <div class="mp-stat-label">${c.label}</div>
                <div class="mp-stat-main">${c.main}</div>
                <div class="mp-stat-sub">${c.sub}</div>
            </div>
        </div>`).join('');
}

function numCell(b, key) {
    const f = b[key].first || 0, c = b[key].co || 0;
    if (!f && !c) return `<td class="mp-num zero">·</td>`;
    return `<td class="mp-num">${f + c}${f ? `<span class="mp-first" title="1저자 ${f}건">①${f}</span>` : ''}</td>`;
}

function renderTable(rows) {
    const el = document.getElementById('mpTableWrap');
    if (!el) return;
    if (!rows.length) {
        el.innerHTML = `<div class="empty-state small"><i class="fas fa-users"></i><p>현재 구성원이 없습니다. Members 페이지에서 구성원을 등록하세요.</p></div>`;
        return;
    }
    const maxScore = Math.max(1, ...rows.map(r => r.score));
    const body = rows.map((r, i) => {
        const m = r.member;
        const rank = i + 1;
        const rankCls = rank <= 3 ? `rank-${rank}` : '';
        const patCell = (r.patent.reg || r.patent.app)
            ? `<td class="mp-num">${r.patentTotal}<span class="mp-first" title="등록 ${r.patent.reg} / 출원 ${r.patent.app}">${r.patent.reg}↑</span></td>`
            : `<td class="mp-num zero">·</td>`;
        const awCnt = r.award.first + r.award.co;
        return `<tr>
            <td class="mp-rank ${rankCls}">${rank}</td>
            <td class="mp-td-name">
                <span class="mp-name">${esc(m.name || '(이름없음)')}</span>
                <span class="mp-tag mp-tag-${m.section}">${sectionShort(m.section)}</span>
            </td>
            ${numCell(r, 'sci')}${numCell(r, 'kci')}${numCell(r, 'confIntl')}${numCell(r, 'confDom')}
            ${patCell}
            ${awCnt ? `<td class="mp-num">${awCnt}</td>` : `<td class="mp-num zero">·</td>`}
            <td class="mp-score-cell">
                <div class="mp-score-bar"><span style="width:${(r.score / maxScore * 100).toFixed(0)}%"></span></div>
                <b>${fmt(r.score)}</b>
            </td>
        </tr>`;
    }).join('');
    el.innerHTML = `
        <table class="mp-table">
            <thead><tr>
                <th>#</th><th>구성원</th>
                <th>SCI</th><th>KCI</th><th>국제<small>컨퍼</small></th><th>국내<small>컨퍼</small></th>
                <th>특허</th><th>수상</th><th>실적 점수</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table>
        <div class="mp-table-foot">① = 1저자 건수 · 특허 ↑ = 등록 건수 · 점수(주저자/공동): SCIE 90↑ <b>8/2</b> · 75↑ <b>6/1.5</b> · 그외 <b>4/1</b> · KCI·국제 <b>2/0.5</b> · 국내 <b>1/0</b> · 특허 등록2·출원1 · 수상 1</div>`;
}

function pubItemRow(it) {
    const cat = CATS.find(c => c.key === it._cat);
    const titleHtml = it.url
        ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title || '(제목없음)')}</a>`
        : esc(it.title || '(제목없음)');
    const jif = (it._cat === 'sci' && it.percentile !== '' && it.percentile != null)
        ? `<span class="mp-jif" title="JIF 백분위(JCR 최고 카테고리)">JIF ${it.percentile}%</span>` : '';
    return `<div class="mp-item ${it.isFirst ? 'is-first' : ''}">
        <span class="mp-cat ${cat ? cat.cls : ''}">${cat ? cat.label : esc(it.type)}</span>
        ${it.isFirst ? `<span class="mp-first-badge" title="1저자">1저자</span>` : ''}${jif}
        <span class="mp-item-label">${titleHtml}<span class="mp-venue">${esc(it.journal || '')}</span></span>
        ${it.award ? `<span class="mp-award-badge"><i class="fas fa-trophy"></i> ${esc(it.award)}</span>` : ''}
    </div>`;
}
function patentItemRow(p) {
    const sd = patentStatusDef(p.status);
    return `<div class="mp-item">
        <span class="mp-cat cat-pat">특허</span>
        <span class="mp-item-label">${esc(p.label || '(제목없음)')}<span class="mp-venue">${esc(p.venue || '')}</span></span>
        <span class="mp-item-status mp-${sd.color}">${esc(sd.label)}</span>
        ${p.date ? `<span class="mp-venue mp-inline">${esc(p.date)}</span>` : ''}
    </div>`;
}
function awardItemRow(a) {
    return `<div class="mp-item ${a.isFirst ? 'is-first' : ''}">
        <span class="mp-cat cat-aw"><i class="fas fa-trophy"></i></span>
        ${a.isFirst ? `<span class="mp-first-badge" title="대표 수상자">대표</span>` : ''}
        <span class="mp-item-label">${esc(a.highlight || a.content)}<span class="mp-venue">${esc(a.content)}</span></span>
        ${a.date ? `<span class="mp-venue mp-inline">${esc(a.date)}</span>` : ''}
    </div>`;
}

function renderCards(rows) {
    const el = document.getElementById('mpCards');
    if (!el) return;
    if (!rows.length) { el.innerHTML = ''; return; }
    el.innerHTML = rows.map(r => {
        const m = r.member;
        const photo = m.photo || './members_img/f4.png';
        const empty = (r.papersTotal + r.patentTotal + r.awardTotal) === 0;
        const pubs = r.items.pubs.slice().sort((a, b) =>
            (b.isFirst - a.isFirst) || (CATS.findIndex(c => c.key === a._cat) - CATS.findIndex(c => c.key === b._cat)));
        return `<div class="mp-card ${empty ? 'is-empty' : ''}">
            <div class="mp-card-head">
                <img class="mp-photo" src="${esc(photo)}" alt="${esc(m.name)}" loading="lazy" onerror="this.src='./members_img/f4.png'">
                <div class="mp-card-id">
                    <div class="mp-card-name">${esc(m.name || '(이름없음)')}
                        <span class="mp-tag mp-tag-${m.section}">${sectionShort(m.section)}</span>
                    </div>
                    <div class="mp-card-role">${esc(m.role || '')}</div>
                    ${m.research ? `<div class="mp-card-research"><i class="fas fa-flask"></i> ${esc(m.research)}</div>` : ''}
                </div>
                <div class="mp-card-score">
                    <div class="mp-card-score-num">${fmt(r.score)}</div>
                    <div class="mp-card-score-lbl">실적 점수</div>
                </div>
            </div>
            <div class="mp-card-stats">
                <div class="mp-stat"><b>${catCount(r,'sci')}</b><span>SCI</span></div>
                <div class="mp-stat"><b>${catCount(r,'kci')}</b><span>KCI</span></div>
                <div class="mp-stat"><b>${catCount(r,'confIntl')}</b><span>국제컨퍼</span></div>
                <div class="mp-stat"><b>${catCount(r,'confDom')}</b><span>국내컨퍼</span></div>
                <div class="mp-stat"><b>${r.patentTotal}</b><span>특허</span></div>
                <div class="mp-stat"><b>${r.awardTotal}</b><span>수상</span></div>
            </div>
            <div class="mp-card-body">
                <div class="mp-list-block">
                    <div class="mp-list-title"><i class="fas fa-file-lines"></i> 논문 <span class="mp-cnt">${r.papersTotal}</span></div>
                    ${pubs.length ? pubs.map(pubItemRow).join('') : `<span class="mp-none">매칭된 논문 없음</span>`}
                </div>
                <div class="mp-list-block">
                    <div class="mp-list-title"><i class="fas fa-certificate"></i> 특허 <span class="mp-cnt">${r.patentTotal}</span></div>
                    ${r.items.patents.length ? r.items.patents.map(patentItemRow).join('') : `<span class="mp-none">매칭된 특허 없음</span>`}
                </div>
                ${r.awardTotal ? `<div class="mp-list-block">
                    <div class="mp-list-title"><i class="fas fa-trophy"></i> 수상 <span class="mp-cnt">${r.awardTotal}</span></div>
                    ${r.items.awards.map(awardItemRow).join('')}
                </div>` : ''}
            </div>
        </div>`;
    }).join('');
}

function renderUnassigned(unassignedPatents, unmatchedPubs) {
    const section = document.getElementById('mpUnassignedSection');
    const el = document.getElementById('mpUnassigned');
    if (!section || !el) return;
    if (!unassignedPatents.length && !unmatchedPubs.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';

    const patHtml = unassignedPatents.map(p => {
        const sd = patentStatusDef(p.status);
        return `<div class="mp-item">
            <span class="mp-cat cat-pat">특허</span>
            <span class="mp-item-label">${esc(p.label || '(제목없음)')}${p.venue ? ' · ' + esc(p.venue) : ''}</span>
            <span class="mp-item-status mp-${sd.color}">${esc(sd.label)}</span>
        </div>`;
    }).join('');

    const pubHtml = unmatchedPubs.map(it => {
        const cat = CATS.find(c => c.key === it._cat);
        return `<div class="mp-item">
            <span class="mp-cat ${cat ? cat.cls : ''}">${cat ? cat.label : esc(it.type)}</span>
            <span class="mp-item-label">${esc(it.title || '(제목없음)')}<span class="mp-venue">${esc(it.authors || '')}</span></span>
        </div>`;
    }).join('');

    el.innerHTML =
        (unmatchedPubs.length ? `<div class="mp-unassigned-group"><div class="mp-ug-title">미매칭 논문 <span class="mp-cnt">${unmatchedPubs.length}</span> <small>(현재 구성원 저자 표기와 일치 안 됨 — 졸업생/외부저자이거나 별칭 등록 필요)</small></div>${pubHtml}</div>` : '') +
        (unassignedPatents.length ? `<div class="mp-unassigned-group"><div class="mp-ug-title">미배정 특허 <span class="mp-cnt">${unassignedPatents.length}</span></div>${patHtml}</div>` : '');
}

// ==================== 별칭(표기) 관리 ====================
function openAliasModal() {
    const wrap = document.getElementById('aliasFields');
    const modal = document.getElementById('aliasModal');
    if (!wrap || !modal) return;
    if (!state.members.length) { showAlert('먼저 구성원이 등록되어 있어야 합니다.', 'warning'); return; }
    wrap.innerHTML = state.members.map(m => `
        <div class="alias-row">
            <div class="alias-name">${esc(m.name || '(이름없음)')}
                <span class="mp-tag mp-tag-${m.section}">${sectionShort(m.section)}</span>
            </div>
            <input type="text" id="alias_${m.key}" class="alias-input"
                   value="${esc(state.aliases[m.key] || '')}"
                   placeholder="예: Lee Seon Woo; S.W. Lee; L.S.W">
        </div>`).join('');
    modal.classList.add('open');
}
async function saveAliases(e) {
    e.preventDefault();
    if (!currentUser) { showAlert('로그인이 필요합니다.', 'error'); return; }
    const updates = {};
    const next = {};
    state.members.forEach(m => {
        const inp = document.getElementById('alias_' + m.key);
        const val = inp ? inp.value.trim() : '';
        updates[ALIAS_PATH + '/' + m.key] = val || null;
        if (val) next[m.key] = val;
    });
    try {
        await database.ref().update(updates);
        state.aliases = next;
        state.members.forEach(buildMemberForms);
        const modal = document.getElementById('aliasModal');
        if (modal) modal.classList.remove('open');
        showAlert('저자 표기가 저장되었습니다.', 'success');
        render();
    } catch (err) {
        showAlert('저장 실패: ' + err.message, 'error');
    }
}

// ==================== 이벤트 ====================
function setupEvents() {
    if (loginBtn) loginBtn.addEventListener('click', () => loginModal && (loginModal.style.display = 'block'));
    const gateBtn = document.getElementById('gateLoginBtn');
    if (gateBtn) gateBtn.addEventListener('click', () => loginModal && (loginModal.style.display = 'block'));
    if (loginClose) loginClose.addEventListener('click', () => loginModal && (loginModal.style.display = 'none'));
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
        await auth.signOut(); currentUser = null; updateAuthUI();
        showAlert('로그아웃되었습니다.', 'success');
    });
    if (loginModal) loginModal.addEventListener('click', e => { if (e.target === loginModal) loginModal.style.display = 'none'; });

    const form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', async e => {
        e.preventDefault();
        const email = (document.getElementById('email').value || '').trim();
        const password = document.getElementById('password').value || '';
        try {
            const res = await loginUser(email, password);
            currentUser = res.user;
            updateAuthUI();
            if (loginModal) loginModal.style.display = 'none';
            form.reset();
            showAlert('로그인 성공!', 'success');
            await loadData();
        } catch (err) {
            showAlert('로그인 실패: ' + err.message, 'error');
        }
    });

    const firstChk = document.getElementById('mpFirstOnly');
    if (firstChk) firstChk.addEventListener('change', () => { state.firstOnly = firstChk.checked; render(); });
    const sortSel = document.getElementById('mpSortSel');
    if (sortSel) sortSel.addEventListener('change', () => { state.sort = sortSel.value; render(); });
    const searchInp = document.getElementById('mpSearch');
    if (searchInp) searchInp.addEventListener('input', () => { state.query = searchInp.value; render(); });

    const aliasBtn = document.getElementById('mpAliasBtn');
    if (aliasBtn) aliasBtn.addEventListener('click', openAliasModal);
    const aliasForm = document.getElementById('aliasForm');
    if (aliasForm) aliasForm.addEventListener('submit', saveAliases);
    // data-close 처리 (모달 닫기 버튼)
    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.getAttribute('data-close'));
            if (target) target.classList.remove('open');
        });
    });
    const aliasModal = document.getElementById('aliasModal');
    if (aliasModal) aliasModal.addEventListener('click', e => { if (e.target === aliasModal) aliasModal.classList.remove('open'); });
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', () => {
    loginBtn   = document.getElementById('loginBtn');
    logoutBtn  = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal');
    loginClose = document.getElementById('loginClose');
    userInfo   = document.getElementById('userInfo');
    userName   = document.getElementById('userName');
    authGate   = document.getElementById('authGate');
    mpApp      = document.getElementById('mpApp');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
        auth.onAuthStateChanged(async user => {
            currentUser = (user && ALLOWED_USERS.includes(user.email)) ? user : null;
            updateAuthUI();
            if (currentUser) {
                try { await loadData(); }
                catch (e) { showAlert('데이터 로드 실패: ' + e.message, 'error'); }
            }
        });
    } catch (e) {
        showAlert('Firebase 초기화 실패: ' + e.message, 'error');
    }

    setupEvents();
});
