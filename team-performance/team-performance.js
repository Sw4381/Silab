// team-performance.js - 팀별 종합 실적 집계 (로그인 전용)
// 멤버 실적(논문/특허/수상 건수)을 팀(연구분야) 단위로 합산. 멤버는 여러 팀 소속 가능.
// 데이터: members, publications/{sci,kci,other}, performance/__track__/patents, awards, memberPerfAliases, teams

// ==================== 상수 ====================
const TRACK_KEY = '__track__';
const ALIAS_PATH = 'memberPerfAliases';
const TEAMS_PATH = 'teams';
const PATENT_STATUS = [
    { v: 'applied', label: '출원', color: 'blue' },
    { v: 'registered', label: '등록(완료)', color: 'red' }
];
function patentStatusDef(v) { return PATENT_STATUS.find(s => s.v === v) || PATENT_STATUS[0]; }
const SECTIONS = [
    { key: 'phd', label: '박사과정', short: '박사' },
    { key: 'ms', label: '석사과정', short: '석사' },
    { key: 'bs', label: '학부연구생', short: '학부' }
];
const CATS = [
    { key: 'sci', label: 'SCI', cls: 'cat-sci' },
    { key: 'kci', label: 'KCI', cls: 'cat-kci' },
    { key: 'confIntl', label: '국제', cls: 'cat-ci' },
    { key: 'confDom', label: '국내', cls: 'cat-cd' }
];
const ALLOWED_USERS = [ADMIN_UID, ROOT_UID];   // UID 기준

// ==================== 전역 상태 ====================
let auth, database, currentUser = null;
const state = {
    members: [], aliases: {}, pubs: [], patents: [], awards: [],
    teams: [],          // [{key,name,area,leader,members:[memberKey],order}]
    sort: 'papers', editKey: null
};
let loginBtn, logoutBtn, loginModal, loginClose, userInfo, userName, authGate, tpApp;

// ==================== 유틸 (멤버 실적과 동일 매칭 로직) ====================
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showAlert(message, type) {
    const el = document.createElement('div'); el.className = `perf-alert ${type || 'info'}`;
    el.textContent = message; document.body.appendChild(el); setTimeout(() => el.remove(), 3000);
}
function uid() { return 't' + Math.abs(((performance.now() * 1000) | 0)).toString(36) + (state._seq = (state._seq || 0) + 1).toString(36); }
function hasHangul(s) { return /[가-힣]/.test(String(s || '')); }
function korName(token) { const m = String(token || '').match(/[가-힣]{2,5}/); return m ? m[0] : ''; }
function normLatin(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function parseAliases(s) { return String(s || '').split(/[;\n]/).map(t => t.trim()).filter(Boolean); }
function parseAuthors(s) {
    return String(s || '').split(/[,，;、]/)
        .map(t => t.replace(/[*†‡✝0-9\[\]<>]/g, '').replace(/교신저자|제1저자|공동저자|교신|저자/g, '').trim()).filter(Boolean);
}
function parseMemberName(name) {
    const s = String(name || ''); const pm = s.match(/\(([^)]*)\)/);
    const eng = pm ? pm[1].trim() : ''; const before = s.split('(')[0];
    return { kor: korName(before) || before.trim(), eng };
}
function genLatinForms(eng) {
    const forms = new Set();
    const clean = String(eng || '').replace(/[._\-]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return forms;
    const full = normLatin(clean); if (full) forms.add(full);
    const parts = clean.split(' ').filter(Boolean);
    if (parts.length >= 2) {
        const surname = parts[parts.length - 1], given = parts.slice(0, -1);
        const gFull = given.join(''), gInit = given.map(g => g[0]).join('');
        [gFull + surname, surname + gFull, gInit + surname, surname + gInit].forEach(x => { const n = normLatin(x); if (n) forms.add(n); });
    }
    return forms;
}
function buildMemberForms(m) {
    m._kor = new Set(); m._lat = new Set();
    const { kor, eng } = parseMemberName(m.name); m._korName = kor;
    if (kor) m._kor.add(kor);
    if (eng) genLatinForms(eng).forEach(x => m._lat.add(x));
    parseAliases(state.aliases[m.key]).forEach(f => {
        if (!f) return;
        if (hasHangul(f)) { const k = korName(f) || f.trim(); if (k) m._kor.add(k); }
        else genLatinForms(f).forEach(x => m._lat.add(x));
    });
}
function pubAuthorMatch(token, m) {
    if (hasHangul(token)) { const k = korName(token); return !!k && m._kor.has(k); }
    const n = normLatin(token); return n.length >= 2 && m._lat.has(n);
}
function pubCategory(pub) {
    if (pub.type === 'sci') return 'sci';
    if (pub.type === 'kci') return 'kci';
    return hasHangul(pub.journal) ? 'confDom' : 'confIntl';
}
function patentToken(label) { return String(label || '').split(/[（(]/)[0].trim(); }
function matchPatentMember(token, members) {
    if (!token) return null;
    const kt = korName(token) || token;
    let m = members.find(x => x._kor.has(kt)); if (m) return m;
    if (hasHangul(kt) && kt.length >= 2) {
        const c = members.filter(x => x._korName && x._korName.endsWith(kt));
        if (c.length === 1) return c[0];
        if (c.length > 1) return c.sort((a, b) => Math.abs(a._korName.length - kt.length) - Math.abs(b._korName.length - kt.length))[0];
    }
    const n = normLatin(token);
    if (n.length >= 2) { m = members.find(x => x._lat.has(n)); if (m) return m; }
    return null;
}
function sectionShort(secKey) { const s = SECTIONS.find(x => x.key === secKey); return s ? s.short : ''; }

// ==================== 인증 ====================
async function loginUser(email, password) {
    // 접근 권한은 로그인 후 UID(ALLOWED_USERS)로 확인 — 임의 계정 자동생성은 하지 않음
    try { return await auth.signInWithEmailAndPassword(email, password); }
    catch (e) {
        if (e.code === 'auth/user-not-found') throw new Error('등록되지 않은 계정입니다.');
        if (e.code === 'auth/wrong-password') throw new Error('비밀번호가 틀렸습니다.');
        if (e.code === 'auth/invalid-email') throw new Error('이메일 형식이 올바르지 않습니다.');
        throw e;
    }
}
function updateAuthUI() {
    const a = !!currentUser;
    if (loginBtn) loginBtn.style.display = a ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = a ? 'flex' : 'none';
    if (userInfo) userInfo.style.display = a ? 'flex' : 'none';
    if (userName && currentUser) userName.textContent = currentUser.email;
    if (authGate) authGate.style.display = a ? 'none' : 'flex';
    if (tpApp) tpApp.style.display = a ? 'block' : 'none';
}

// ==================== 데이터 로드 ====================
async function loadData() {
    const [memSnap, sciSnap, kciSnap, otherSnap, patSnap, awardSnap, teamSnap] = await Promise.all([
        database.ref('members').once('value'),
        database.ref('publications/sci').once('value'),
        database.ref('publications/kci').once('value'),
        database.ref('publications/other').once('value'),
        database.ref(`performance/${TRACK_KEY}/patents`).once('value'),
        database.ref('awards').once('value'),
        database.ref(TEAMS_PATH).once('value')
    ]);
    try { state.aliases = (await database.ref(ALIAS_PATH).once('value')).val() || {}; }
    catch (e) { state.aliases = {}; }

    const mem = memSnap.val() || {}; const members = [];
    SECTIONS.forEach(sec => Object.entries(mem[sec.key] || {}).forEach(([key, m]) => {
        members.push({ key, section: sec.key, name: (m.name || '').trim(), role: m.role || '', research: m.research || '', photo: m.photo || '', order: m.order || 0 });
    }));
    members.sort((a, b) => (SECTIONS.findIndex(s => s.key === a.section) - SECTIONS.findIndex(s => s.key === b.section)) || (a.order - b.order));
    members.forEach(buildMemberForms);
    state.members = members;

    const collect = (snap, type) => Object.entries(snap.val() || {}).map(([id, v]) => ({
        id, type, title: v.title || '', authors: v.authors || '', journal: v.journal || '', award: (v.award || '').trim(),
        url: v.url || '', _cat: pubCategory({ type, journal: v.journal }), _tokens: parseAuthors(v.authors)
    }));
    state.pubs = [...collect(sciSnap, 'sci'), ...collect(kciSnap, 'kci'), ...collect(otherSnap, 'other')];
    state.patents = Object.entries(patSnap.val() || {}).map(([id, v]) => ({ id, ...v }));
    state.awards = Object.entries(awardSnap.val() || {}).map(([id, v]) => {
        const content = v.content || '';
        const names = content.includes(' - ') ? content.split(' - ')[0].split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [];
        return { id, content, highlight: v.highlight || '', date: v.date || '', _names: names };
    });

    const traw = teamSnap.val() || {};
    state.teams = Object.entries(traw).map(([key, t]) => ({
        key, name: t.name || '(이름없음)', area: t.area || '', leader: t.leader || '',
        members: Array.isArray(t.members) ? t.members.slice() : (t.members ? Object.values(t.members) : []), order: t.order || 0
    })).sort((a, b) => (a.order || 0) - (b.order || 0));

    render();
}

// ==================== 멤버별 집계 (멤버 실적과 동일) ====================
function emptyMetrics() {
    const m = { papersTotal: 0, patentTotal: 0, awardTotal: 0, patent: { reg: 0, app: 0 } };
    CATS.forEach(c => m[c.key] = { first: 0, co: 0 }); m.award = { first: 0, co: 0 };
    return m;
}
function catCount(b, key) { return (b[key].first || 0) + (b[key].co || 0); }
function aggregateMembers() {
    const buckets = new Map();
    state.members.forEach(m => buckets.set(m.key, { member: m, ...emptyMetrics() }));
    state.pubs.forEach(pub => state.members.forEach(m => {
        const idx = pub._tokens.findIndex(t => pubAuthorMatch(t, m)); if (idx < 0) return;
        const b = buckets.get(m.key); b[pub._cat][idx === 0 ? 'first' : 'co']++; b.papersTotal++;
    }));
    state.patents.forEach(p => {
        const m = matchPatentMember(patentToken(p.label), state.members); if (!m) return;
        const b = buckets.get(m.key);
        if (patentStatusDef(p.status).v === 'registered') b.patent.reg++; else b.patent.app++;
        b.patentTotal++;
    });
    state.awards.forEach(a => {
        if (!a._names || !a._names.length) return;
        state.members.forEach(m => {
            const idx = a._names.findIndex(n => { const k = korName(n); return !!k && m._kor.has(k); });
            if (idx < 0) return; const b = buckets.get(m.key); b.award[idx === 0 ? 'first' : 'co']++; b.awardTotal++;
        });
    });
    return buckets;
}

// ==================== 팀별 집계 ====================
function teamAggregate() {
    const byMember = aggregateMembers();   // Map(memberKey -> metrics)
    const validKeys = new Set(state.members.map(m => m.key));
    const teamRows = state.teams.map(t => {
        const keys = (t.members || []).filter(k => validKeys.has(k));
        const agg = { sci: 0, kci: 0, confIntl: 0, confDom: 0, papersTotal: 0, patReg: 0, patApp: 0, patentTotal: 0, awardTotal: 0 };
        keys.forEach(k => {
            const b = byMember.get(k); if (!b) return;
            CATS.forEach(c => agg[c.key] += catCount(b, c.key));
            agg.papersTotal += b.papersTotal; agg.patReg += b.patent.reg; agg.patApp += b.patent.app;
            agg.patentTotal += b.patentTotal; agg.awardTotal += b.awardTotal;
        });
        return { team: t, memberKeys: keys, ...agg };
    });
    const assigned = new Set(); teamRows.forEach(tr => tr.memberKeys.forEach(k => assigned.add(k)));
    const unassigned = state.members.filter(m => !assigned.has(m.key)).map(m => ({ member: m, b: byMember.get(m.key) }));
    return { teamRows, unassigned, byMember };
}
function memberName(key) { const m = state.members.find(x => x.key === key); return m ? m.name : key; }

// ==================== 렌더 ====================
function sortTeams(rows) {
    const a = rows.slice();
    if (state.sort === 'name') a.sort((x, y) => x.team.name.localeCompare(y.team.name, 'ko'));
    else if (state.sort === 'sci') a.sort((x, y) => y.sci - x.sci || y.papersTotal - x.papersTotal);
    else if (state.sort === 'patents') a.sort((x, y) => y.patentTotal - x.patentTotal || y.papersTotal - x.papersTotal);
    else if (state.sort === 'awards') a.sort((x, y) => y.awardTotal - x.awardTotal || y.papersTotal - x.papersTotal);
    else if (state.sort === 'members') a.sort((x, y) => y.memberKeys.length - x.memberKeys.length);
    else a.sort((x, y) => y.papersTotal - x.papersTotal || y.patentTotal - x.patentTotal);
    return a;
}
function render() {
    const { teamRows, unassigned } = teamAggregate();
    renderStatCards(teamRows, unassigned);
    const sorted = sortTeams(teamRows);
    renderTable(sorted);
    renderCards(sorted);
    renderUnassigned(unassigned);
}
function renderStatCards(teamRows, unassigned) {
    const el = document.getElementById('tmStatCards'); if (!el) return;
    const assignedCount = state.members.length - unassigned.length;
    const papers = teamRows.reduce((a, t) => a + t.papersTotal, 0);
    const pats = teamRows.reduce((a, t) => a + t.patentTotal, 0);
    const awards = teamRows.reduce((a, t) => a + t.awardTotal, 0);
    const cards = [
        { icon: 'fa-people-group', label: '팀', main: `${state.teams.length}`, sub: `배정 ${assignedCount}/${state.members.length}명` },
        { icon: 'fa-file-lines', label: '논문(팀 합산)', main: `${papers}`, sub: '중복 포함' },
        { icon: 'fa-certificate', label: '특허(팀 합산)', main: `${pats}`, sub: '등록+출원' },
        { icon: 'fa-trophy', label: '수상(팀 합산)', main: `${awards}`, sub: '' }
    ];
    el.innerHTML = cards.map(c => `
        <div class="mp-stat-card"><div class="mp-stat-icon"><i class="fas ${c.icon}"></i></div>
        <div class="mp-stat-body"><div class="mp-stat-label">${c.label}</div><div class="mp-stat-main">${c.main}</div><div class="mp-stat-sub">${c.sub}</div></div></div>`).join('');
}
function numCell(v) { return v ? `<td class="mp-num">${v}</td>` : `<td class="mp-num zero">·</td>`; }
function renderTable(rows) {
    const el = document.getElementById('tmTableWrap'); if (!el) return;
    if (!rows.length) { el.innerHTML = `<div class="empty-state small"><i class="fas fa-people-group"></i><p>등록된 팀이 없습니다. 우측 상단 ‘팀 추가’로 시작하세요.</p></div>`; return; }
    const maxP = Math.max(1, ...rows.map(r => r.papersTotal));
    const body = rows.map((r, i) => {
        const patCell = (r.patReg || r.patApp) ? `<td class="mp-num">${r.patentTotal}<span class="mp-first" title="등록 ${r.patReg} / 출원 ${r.patApp}">${r.patReg}↑</span></td>` : `<td class="mp-num zero">·</td>`;
        return `<tr data-key="${esc(r.team.key)}">
            <td class="mp-rank ${i < 3 ? 'rank-' + (i + 1) : ''}">${i + 1}</td>
            <td class="mp-td-name"><span class="mp-name">${esc(r.team.name)}</span>${r.team.area ? `<span class="tm-area">${esc(r.team.area)}</span>` : ''}</td>
            <td class="mp-num">${r.memberKeys.length}</td>
            ${numCell(r.sci)}${numCell(r.kci)}${numCell(r.confIntl)}${numCell(r.confDom)}${patCell}${numCell(r.awardTotal)}
            <td class="mp-score-cell"><div class="mp-score-bar"><span style="width:${(r.papersTotal / maxP * 100).toFixed(0)}%"></span></div><b>${r.papersTotal}</b></td>
        </tr>`;
    }).join('');
    el.innerHTML = `<table class="mp-table">
        <thead><tr><th>#</th><th>팀</th><th>인원</th><th>SCI</th><th>KCI</th><th>국제<small>컨퍼</small></th><th>국내<small>컨퍼</small></th><th>특허</th><th>수상</th><th>논문 합</th></tr></thead>
        <tbody>${body}</tbody></table>
        <div class="mp-table-foot">특허 ↑ = 등록 건수 · 멤버가 여러 팀이면 각 팀에 중복 합산됩니다 · 행 클릭 → 팀 수정</div>`;
    el.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => openTeamForm(tr.dataset.key)));
}
function renderCards(rows) {
    const el = document.getElementById('tmCards'); if (!el) return;
    if (!rows.length) { el.innerHTML = ''; return; }
    el.innerHTML = rows.map(r => {
        const t = r.team;
        const chips = r.memberKeys.map(k => {
            const m = state.members.find(x => x.key === k); if (!m) return '';
            const lead = (t.leader && t.leader === k) ? ' tm-lead' : '';
            return `<span class="tm-chip${lead}">${esc(m.name)}${lead ? ' <i class="fas fa-crown"></i>' : ''}</span>`;
        }).join('') || '<span class="mp-none">팀원 없음</span>';
        return `<div class="tm-card card">
            <div class="tm-card-head">
                <div>
                    <div class="tm-card-name">${esc(t.name)}</div>
                    ${t.area ? `<div class="tm-card-area"><i class="fas fa-flask"></i> ${esc(t.area)}</div>` : ''}
                </div>
                <button class="tb-btn mini" data-edit="${esc(t.key)}"><i class="fas fa-pen"></i> 수정</button>
            </div>
            <div class="tm-card-stats">
                <div class="mp-stat"><b>${r.memberKeys.length}</b><span>인원</span></div>
                <div class="mp-stat"><b>${r.sci}</b><span>SCI</span></div>
                <div class="mp-stat"><b>${r.kci}</b><span>KCI</span></div>
                <div class="mp-stat"><b>${r.confIntl}</b><span>국제컨퍼</span></div>
                <div class="mp-stat"><b>${r.confDom}</b><span>국내컨퍼</span></div>
                <div class="mp-stat"><b>${r.patentTotal}</b><span>특허</span></div>
                <div class="mp-stat"><b>${r.awardTotal}</b><span>수상</span></div>
            </div>
            <div class="tm-card-members">${chips}</div>
        </div>`;
    }).join('');
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openTeamForm(b.dataset.edit)));
}
function renderUnassigned(unassigned) {
    const section = document.getElementById('tmUnassignedSection');
    const el = document.getElementById('tmUnassigned'); if (!section || !el) return;
    if (!unassigned.length) { section.style.display = 'none'; return; }
    section.style.display = 'block';
    el.innerHTML = unassigned.map(u => `<span class="tm-chip muted">${esc(u.member.name)}<span class="mp-tag mp-tag-${u.member.section}">${sectionShort(u.member.section)}</span></span>`).join('');
}

// ==================== 팀 추가/수정 ====================
function openTeamForm(key) {
    state.editKey = key || null;
    const t = key ? state.teams.find(x => x.key === key) : null;
    const g = id => document.getElementById(id);
    g('teamFormTitle').textContent = t ? '팀 수정' : '새 팀 추가';
    g('teamName').value = t ? t.name : '';
    g('teamArea').value = t ? t.area : '';
    g('deleteTeamBtn').style.display = t ? '' : 'none';
    const sel = new Set(t ? t.members : []);
    // 팀원 체크리스트
    g('teamMembers').innerHTML = SECTIONS.map(sec => {
        const ms = state.members.filter(m => m.section === sec.key);
        if (!ms.length) return '';
        return `<div class="tm-pick-group"><div class="tm-pick-sec">${sec.label}</div>` +
            ms.map(m => `<label class="tm-pick"><input type="checkbox" class="tm-pick-cb" value="${esc(m.key)}"${sel.has(m.key) ? ' checked' : ''}> ${esc(m.name)}</label>`).join('') + `</div>`;
    }).join('');
    refreshLeaderOptions();
    g('teamMembers').querySelectorAll('.tm-pick-cb').forEach(cb => cb.addEventListener('change', refreshLeaderOptions));
    document.getElementById('teamFormModal').classList.add('open');
}
function checkedMemberKeys() { return Array.from(document.querySelectorAll('#teamMembers .tm-pick-cb:checked')).map(cb => cb.value); }
function refreshLeaderOptions() {
    const keys = checkedMemberKeys();
    const cur = document.getElementById('teamLeader').value;
    const t = state.editKey ? state.teams.find(x => x.key === state.editKey) : null;
    const lead = cur || (t ? t.leader : '');
    document.getElementById('teamLeader').innerHTML = '<option value="">(팀장 없음)</option>' +
        keys.map(k => `<option value="${esc(k)}"${k === lead ? ' selected' : ''}>${esc(memberName(k))}</option>`).join('');
    document.getElementById('teamMemberCount').textContent = keys.length ? `${keys.length}명 선택` : '';
}
async function saveTeam(e) {
    e.preventDefault();
    const name = document.getElementById('teamName').value.trim();
    if (!name) { showAlert('팀명을 입력하세요.', 'warning'); return; }
    const members = checkedMemberKeys();
    const existing = state.editKey ? state.teams.find(x => x.key === state.editKey) : null;
    const obj = {
        name, area: document.getElementById('teamArea').value.trim(),
        leader: document.getElementById('teamLeader').value || '',
        members, order: existing ? existing.order : state.teams.length
    };
    const key = state.editKey || uid();
    try {
        await database.ref(`${TEAMS_PATH}/${key}`).set(obj);
        document.getElementById('teamFormModal').classList.remove('open');
        showAlert('저장되었습니다.', 'success');
        await loadData();
    } catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}
async function deleteTeam() {
    if (!state.editKey) return;
    const t = state.teams.find(x => x.key === state.editKey);
    if (!confirm(`‘${t ? t.name : ''}’ 팀을 삭제할까요? (멤버·실적 데이터는 그대로 유지됩니다)`)) return;
    try {
        await database.ref(`${TEAMS_PATH}/${state.editKey}`).remove();
        document.getElementById('teamFormModal').classList.remove('open');
        showAlert('삭제되었습니다.', 'success');
        await loadData();
    } catch (err) { showAlert('삭제 실패: ' + err.message, 'error'); }
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', () => {
    loginBtn = document.getElementById('loginBtn'); logoutBtn = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal'); loginClose = document.getElementById('loginClose');
    userInfo = document.getElementById('userInfo'); userName = document.getElementById('userName');
    authGate = document.getElementById('authGate'); tpApp = document.getElementById('tpApp');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth(); database = firebase.database();
        auth.onAuthStateChanged(async user => {
            currentUser = (user && ALLOWED_USERS.includes(user.uid)) ? user : null;
            updateAuthUI();
            if (currentUser) { try { await loadData(); } catch (e) { console.error(e); showAlert('데이터 로드 실패: ' + e.message, 'error'); } }
        });
    } catch (e) { showAlert('Firebase 초기화 실패: ' + e.message, 'error'); }

    // 로그인 모달
    const openLogin = () => loginModal && (loginModal.style.display = 'block');
    loginBtn && loginBtn.addEventListener('click', openLogin);
    const gateBtn = document.getElementById('gateLoginBtn'); gateBtn && gateBtn.addEventListener('click', openLogin);
    loginClose && loginClose.addEventListener('click', () => loginModal.style.display = 'none');
    loginModal && loginModal.addEventListener('click', e => { if (e.target === loginModal) loginModal.style.display = 'none'; });
    logoutBtn && logoutBtn.addEventListener('click', async () => { await auth.signOut(); currentUser = null; updateAuthUI(); showAlert('로그아웃되었습니다.', 'success'); });
    const form = document.getElementById('loginForm');
    form && form.addEventListener('submit', async e => {
        e.preventDefault();
        try {
            const res = await loginUser(document.getElementById('email').value.trim(), document.getElementById('password').value);
            currentUser = res.user; updateAuthUI(); loginModal.style.display = 'none'; form.reset();
            showAlert('로그인 성공!', 'success'); await loadData();
        } catch (err) { showAlert('로그인 실패: ' + err.message, 'error'); }
    });

    const sortSel = document.getElementById('tmSortSel');
    sortSel && sortSel.addEventListener('change', () => { state.sort = sortSel.value; render(); });
    document.getElementById('addTeamBtn').addEventListener('click', () => openTeamForm(null));
    document.getElementById('teamForm').addEventListener('submit', saveTeam);
    document.getElementById('teamLeader') && document.getElementById('teamMembers');
    document.getElementById('deleteTeamBtn').addEventListener('click', deleteTeam);
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { const m = document.getElementById(b.dataset.close); if (m) m.classList.remove('open'); }));
    document.querySelectorAll('.perf-modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));
});
