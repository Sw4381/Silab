// budget.js - 과제별 예산 현황 (로그인 전용) · Performance 스타일
// 설정값은 config.js 참조 (firebaseConfig, ALLOWED_EMAIL)
// DB 경로: budget/{year}/{projects, meta} · 학생인건비(통합)은 payroll/{year} 에서 자동 합산
// 금액 단위: 원 · 현금 항목 합계 = 총액 (현물/자부담은 별도, 총액 미포함)

// ==================== 상수 ====================
const ALLOWED_USERS = [ADMIN_UID, ROOT_UID];   // UID 기준
const DEFAULT_YEAR = 2026;
const YEAR_NUMS = [2025, 2026, 2027, 2028, 2029];
const ALL = 'all';            // 연도: 전체기간 누계
const OVERVIEW = '__all__';   // 과제: 전체 개요
const CATEGORIES = ['국가R&D', '비R&D', '기타'];

// 예산 항목 (현금 기준 — 합계가 총액과 일치)
const BITEMS = [
    { key: 'inHouseCash', label: '내부인건비(현금)', grp: 'labor' },
    { key: 'inHouseInKind', label: '내부인건비(현물)', grp: 'labor' },   // 현물·자부담 — 총액 포함
    { key: 'external', label: '외부인건비', grp: 'labor' },   // 인건비 소계 포함
    { key: 'student', label: '학생인건비(통합)', grp: 'labor', linked: true },
    { key: 'equipCash', label: '기자재(현금)', grp: 'direct' },
    { key: 'material', label: '재료비', grp: 'direct' },
    { key: 'activity', label: '연구활동비', grp: 'direct' },
    { key: 'stipend', label: '연구수당', grp: 'direct' },
    { key: 'indirect', label: '간접비', grp: 'other' },
    { key: 'vat', label: '부가세', grp: 'other' }
];
const LABOR_KEYS = BITEMS.filter(i => i.grp === 'labor').map(i => i.key);   // 현금 기준(현물 제외)
const DIRECT_KEYS = BITEMS.filter(i => i.grp === 'direct').map(i => i.key);
const LAYOUT = [
    { type: 'item', key: 'inHouseCash' },
    { type: 'item', key: 'inHouseInKind' },
    { type: 'item', key: 'external' },
    { type: 'item', key: 'student' },
    { type: 'sub', label: '인건비 소계', calc: 'labor' },
    ...BITEMS.filter(i => i.grp === 'direct').map(i => ({ type: 'item', key: i.key })),
    { type: 'sub', label: '직접비 총계', calc: 'direct' },
    { type: 'item', key: 'indirect' },
    { type: 'item', key: 'vat' },
    { type: 'total', label: '총액', calc: 'grand' }
];

// 엑셀 '1 진행중인과제' 시트 기준 2026 현재 진행 과제 (현금 항목 = 총액)
const SEED = {};  // 공개 저장소 보호: 실데이터는 Firebase에만

// ==================== 상태 ====================
let auth, database, currentUser = null;
const state = {
    year: DEFAULT_YEAR, projects: {}, payrollByYear: {},
    currentKey: OVERVIEW, editKey: null, isSeed: false, readOnly: false, isRoot: false
};
let loginBtn, logoutBtn, loginModal, loginClose, loginForm, userInfo, userName;
let authGate, budApp, yearSelect, projectSelect, seedBanner;
let overviewWrap, detailWrap, summaryCards, matrixWrap, peopleWrap, peoplePeriod;

// ==================== 유틸 ====================
function escHtmlSafe(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(v) { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
function won(n) { return Math.round(num(n)).toLocaleString('ko-KR'); }
function wonShort(n) {
    n = num(n); const s = n < 0 ? '-' : ''; n = Math.abs(n);
    if (n >= 1e8) return s + (n / 1e8).toFixed(n % 1e8 ? 1 : 0) + '억';
    if (n >= 1e4) return s + Math.round(n / 1e4).toLocaleString('ko-KR') + '만';
    return s + Math.round(n).toLocaleString('ko-KR');
}
function pct(a, b) { return b ? a / b : 0; }
function uid() { return 'b' + Math.abs(((performance.now() * 1000) | 0)).toString(36) + (state._seq = (state._seq || 0) + 1).toString(36); }
function showAlert(msg, type) { const el = document.createElement('div'); el.className = `perf-alert ${type || 'info'}`; el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 3000); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function normalize(s) { return String(s || '').toLowerCase().replace(/[\s()（）_\-~,.·]/g, ''); }
// 교수님 지정 순서(과제명 매칭) 우선, 그 외엔 order → 미매칭은 뒤로
function sortedKeys() {
    const P = state.projects;
    return Object.keys(P).sort((a, b) => {
        const ca = silabCanonRank(P[a].name), cb = silabCanonRank(P[b].name);
        return (ca - cb) || ((P[a].order || 0) - (P[b].order || 0));
    });
}
function currentProject() { return state.projects[state.currentKey]; }

function normalizePerson(e) {
    const o = { name: String(e.name || ''), grp: e.grp === 'internal' ? 'internal' : 'student', amount: num(e.amount) };
    if (e.note) o.note = true;
    if (e.memo) o.memo = String(e.memo);   // 잔여 사유 등 비고
    if (e.excl) o.excl = true;   // 인력엔 있으나 예산 합계엔 미포함(별도)
    if (e.rate != null && e.rate !== '') o.rate = num(e.rate);
    if (e.base != null && e.base !== '') o.base = num(e.base);
    if (e.months != null && e.months !== '') o.months = num(e.months);
    return o;
}
// 항목별 집행맵 정리 (+ 구버전 actSpent → spent.activity 마이그레이션)
function spentClean(p) {
    const o = {}; const src = p.spent;
    if (src) Object.keys(src).forEach(k => { if (BITEMS.find(i => i.key === k)) o[k] = num(src[k]); });
    if (o.activity == null && num(p.actSpent)) o.activity = num(p.actSpent);
    return o;
}
function spentOf(p, key) { return num((p.spent || {})[key]); }
function normalizeProject(p) {
    const clean = obj => { const o = {}; if (obj) Object.keys(obj).forEach(k => { if (BITEMS.find(i => i.key === k)) o[k] = num(obj[k]); }); return o; };
    let people = p.people;
    if (people && !Array.isArray(people)) people = Object.keys(people).map(k => people[k]);
    people = (people || []).filter(Boolean).map(normalizePerson);
    return {
        name: String(p.name || '(이름없음)'),
        category: CATEGORIES.includes(p.category) ? p.category : '국가R&D',
        manager: String(p.manager || ''), period: String(p.period || ''), note: String(p.note || ''),
        order: num(p.order), payrollName: String(p.payrollName || ''),
        actNote: String(p.actNote || ''),   // 연구활동비 집행 이슈/메모
        alloc: clean(p.alloc), spent: spentClean(p), people
    };
}

// ==================== 학생인건비 자동 연동 (차년도 기간 정확 합산) ====================
// 같은 이름의 인건비 과제가 있으면, 예산 차년도 기간(시작월~종료월, 해 넘어가도)에 해당하는
// 인건비 월들을 각 달력연도에서 합산해 학생인건비(통합)에 자동 반영.
function findPayrollProjectInYear(year, target) {
    const yp = state.payrollByYear[String(year)] || {};
    let best = null;
    for (const k of Object.keys(yp)) {
        const n = normalize(yp[k].name); if (!n) continue;
        if (n === target) return yp[k];
        if (n.includes(target) || target.includes(n)) best = best || yp[k];
    }
    return best;
}
// period 문자열에서 시작/종료(YY.M)를 읽어 (달력연도, 0-based 월) 리스트로 변환
function periodMonths(period, fallbackYear) {
    const m = String(period || '').match(/(\d{2})\.(\d{1,2})(?:\.\d{1,2})?\s*[~∼\-]\s*(\d{2})\.(\d{1,2})/);
    let sy, sm, ey, em;
    if (m) { sy = 2000 + (+m[1]); sm = +m[2]; ey = 2000 + (+m[3]); em = +m[4]; }
    else { sy = fallbackYear; sm = 1; ey = fallbackYear; em = 12; }   // 기간 표기 없으면 그 해 1~12월
    const out = []; let y = sy, mo = sm, guard = 0;
    while ((y < ey || (y === ey && mo <= em)) && guard < 60) { out.push({ year: y, m: mo - 1 }); mo++; if (mo > 12) { mo = 1; y++; } guard++; }
    return out;
}
// 매칭 과제가 하나도 없으면 null(연동 안 함 → 예산 입력값 유지)
function payrollWindowSum(p, budgetYear) {
    const target = normalize(p.payrollName || p.name); if (!target) return null;
    let total = 0, matched = false;
    periodMonths(p.period, budgetYear).forEach(({ year, m }) => {
        const pr = findPayrollProjectInYear(year, target);
        if (pr) { matched = true; (pr.rows || []).forEach(r => total += num((r.m || [])[m])); }
    });
    return matched ? Math.round(total * 10000) : null;   // 만원 → 원
}

// ==================== 계산 ====================
function isLinked(p) { return state.year !== ALL && payrollWindowSum(p, state.year) != null; }
function effAlloc(p) {
    const a = Object.assign({}, p.alloc || {});
    // Root는 인건비 페이지에서 실시간 합산, 일반 관리자는 과제에 저장된 학생인건비 합계 값을 표시
    if (state.isRoot && state.year !== ALL) { const s = payrollWindowSum(p, state.year); if (s != null) a.student = s; }
    return a;
}
function sumKeys(m, keys) { return keys.reduce((a, k) => a + num(m[k]), 0); }
function calc(m) {
    const labor = sumKeys(m, LABOR_KEYS);
    const direct = labor + sumKeys(m, DIRECT_KEYS);
    return { labor, direct, grand: direct + num(m.indirect) };   // 총액 = 직접비 총계 + 간접비 (부가세 제외)
}
function total(p) { return calc(effAlloc(p)).grand; }

// ==================== 연구활동비 집행현황 ====================
// 배정 = 연구활동비(activity) 배정액 · 집행 = 수기 입력(actSpent) · 잔액 = 배정-집행
function actStat(p) {
    const budget = num(effAlloc(p).activity);
    let spent = spentOf(p, 'activity');
    const am = state.activityByName || {};
    const k1 = normalize(p.name), k2 = normalize(p.payrollName || '');
    if (am[k1] != null) spent = am[k1];          // 연구활동비 집행 탭과 연동(과제명 매칭)
    else if (k2 && am[k2] != null) spent = am[k2];
    return { budget, spent, remain: budget - spent, rate: pct(spent, budget) };
}
// 과제 기간(차년도) 중 현재까지 경과 비율 (전체 연도(ALL)·기간미상이면 null)
function elapsedFraction(p) {
    if (state.year === ALL) return null;
    const list = periodMonths(p.period, state.year);
    if (!list.length) return null;
    const now = new Date(), ny = now.getFullYear(), nm = now.getMonth() + 1;
    let el = 0;
    list.forEach(({ year, m }) => { const mm = m + 1; if (year < ny || (year === ny && mm <= nm)) el++; });
    return el / list.length;
}
// 집행률 vs 기간경과율 비교 → 페이스 해석
function paceOf(p) {
    const { budget, rate } = actStat(p);
    if (!budget) return { label: '연구활동비 없음', cls: 'na', el: null };
    const el = elapsedFraction(p);
    if (el == null) return { label: '—', cls: 'na', el: null };
    if (el <= 0) return { label: '시작 전', cls: 'na', el };
    const diff = rate - el;
    if (diff < -0.15) return { label: '집행 지연', cls: 'slow', el, diff };
    if (diff > 0.15) return { label: '빠른 집행', cls: 'fast', el, diff };
    return { label: '적정 페이스', cls: 'ok', el, diff };
}
function execBarHTML(rate, sm) { const w = Math.min(100, Math.max(0, rate * 100)); return `<div class="exec-bar${sm ? ' sm' : ''}"><span style="width:${w.toFixed(1)}%"></span></div>`; }
function paceBadge(pace) { return `<span class="pace-badge pace-${pace.cls}">${escHtmlSafe(pace.label)}</span>`; }

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
    if (budApp) budApp.style.display = a ? 'block' : 'none';
    const ptab = document.getElementById('budPayrollTab');
    if (ptab) ptab.style.display = (a && state.isRoot) ? '' : 'none';   // 학생인건비 탭은 Root만
}

// ==================== 로드/저장 ====================
async function loadData() {
    // 차년도 기간이 해를 넘어가므로 모든 연도의 인건비를 로드해 둔다
    // payroll 은 Root 전용(DB 규칙). 일반 관리자는 읽기 거부될 수 있으므로 실패해도 빈 값으로 진행.
    const paySnaps = await Promise.all(YEAR_NUMS.map(y => database.ref('payroll/' + y + '/projects').once('value').then(s => s.val()).catch(() => null)));
    state.payrollByYear = {}; YEAR_NUMS.forEach((y, i) => state.payrollByYear[String(y)] = paySnaps[i] || {});
    // 연구활동비 집행(activity) 연동: 과제명 매칭 시 집행액을 가져온다
    const actSnap = await database.ref('activity/' + (state.year === ALL ? DEFAULT_YEAR : state.year)).once('value').then(s => s.val()).catch(() => null);
    state.activityByName = {};
    if (actSnap && actSnap.projects) Object.keys(actSnap.projects).forEach(k => {
        const ap = actSnap.projects[k]; let items = ap.items; if (items && !Array.isArray(items)) items = Object.values(items);
        let s = 0; (items || []).forEach(it => s += num(it.spent));
        state.activityByName[normalize(ap.name)] = s;
    });
    if (state.year === ALL) { await loadAllYears(); return; }
    const snap = await database.ref('budget/' + state.year).once('value');
    const data = snap.val();
    if (data && data.projects) {
        const pr = {}; Object.keys(data.projects).forEach(k => pr[k] = normalizeProject(data.projects[k]));
        state.projects = pr; state.isSeed = false;
    } else if (SEED[String(state.year)]) {
        const pr = {}; SEED[String(state.year)].forEach((p, i) => pr['seed' + i] = normalizeProject(Object.assign({ order: i }, p)));
        state.projects = pr; state.isSeed = true;
    } else { state.projects = {}; state.isSeed = false; }
}
async function loadAllYears() {
    // 연도별로 DB 우선, 없으면 시드 → 과제명 기준 합산 (읽기전용)
    const snaps = await Promise.all(YEAR_NUMS.map(y => database.ref('budget/' + y).once('value')));
    const byName = {}; let i = 0;
    YEAR_NUMS.forEach((y, idx) => {
        const d = snaps[idx].val();
        const list = (d && d.projects) ? Object.values(d.projects) : (SEED[String(y)] || []);
        list.forEach(p0 => {
            const p = normalizeProject(p0), nm = p.name;
            if (!byName[nm]) { byName[nm] = p; byName[nm].order = i++; byName[nm].period = '전체기간 누계'; byName[nm].people = []; }
            else { const t = byName[nm]; BITEMS.forEach(it => { t.alloc[it.key] = num(t.alloc[it.key]) + num(p.alloc[it.key]); t.spent[it.key] = num((t.spent || {})[it.key]) + spentOf(p, it.key); }); }
        });
    });
    state.projects = byName; state.isSeed = false;
}
async function saveAll() {
    if (state.year === ALL) return;
    await database.ref('budget/' + state.year).set({
        projects: state.projects,
        meta: { updatedAt: new Date().toISOString(), updatedBy: currentUser ? currentUser.email : '' }
    });
    state.isSeed = false;
}

// ==================== 렌더 ====================
function renderAll() {
    state.readOnly = (state.year === ALL);
    if (seedBanner) seedBanner.style.display = (state.isSeed && !state.readOnly) ? 'flex' : 'none';
    document.getElementById('addProjectBtn').style.display = state.readOnly ? 'none' : '';
    const lsb = document.getElementById('loadSeedBtn');
    if (lsb) lsb.style.display = (!state.readOnly && (SEED[String(state.year)] || []).length) ? '' : 'none';
    const keys = sortedKeys();
    projectSelect.innerHTML = `<option value="${OVERVIEW}">📊 전체 개요</option>` +
        keys.map(k => `<option value="${escHtmlSafe(k)}">${escHtmlSafe(state.projects[k].name)}</option>`).join('');
    if (state.currentKey !== OVERVIEW && !state.projects[state.currentKey]) state.currentKey = OVERVIEW;
    projectSelect.value = state.currentKey;
    renderCurrent();
}
function renderCurrent() {
    const overview = (state.currentKey === OVERVIEW) || !currentProject();
    overviewWrap.style.display = overview ? '' : 'none';
    detailWrap.style.display = overview ? 'none' : '';
    const canEdit = !state.readOnly && !overview;
    document.getElementById('editProjectBtn').style.display = canEdit ? '' : 'none';
    document.getElementById('deleteProjectBtn').style.display = canEdit ? '' : 'none';
    if (overview) renderOverview(); else renderDetail();
}

function compParts(p) {
    const a = effAlloc(p), c = calc(a);
    return { labor: c.labor, directOnly: c.direct - c.labor, io: num(a.indirect) + num(a.vat), grand: c.grand, a, c };
}

// ---- 전체 개요 ----
function renderOverview() {
    const keys = sortedKeys();
    let tG = 0, tL = 0, tD = 0, tI = 0, tAct = 0, tStip = 0, tEq = 0, tMat = 0;
    keys.forEach(k => {
        const x = compParts(state.projects[k]), a = x.a;
        tG += x.grand; tL += x.labor; tD += x.directOnly; tI += x.io;
        tAct += num(a.activity); tStip += num(a.stipend); tEq += num(a.equipCash); tMat += num(a.material);
    });
    const ylabel = state.year === ALL ? '전체기간 누계' : state.year + '년';
    const kpis = [
        { ic: 'fa-folder-open', label: '진행 과제', val: keys.length + '개', sub: ylabel },
        { ic: 'fa-sack-dollar', label: '예산 총액', val: wonShort(tG), sub: won(tG) + '원' },
        { ic: 'fa-user-group', label: '인건비', val: wonShort(tL), sub: '총액의 ' + Math.round(pct(tL, tG) * 100) + '%' },
        { ic: 'fa-flask', label: '직접비(기타)', val: wonShort(tD), sub: '총액의 ' + Math.round(pct(tD, tG) * 100) + '%' },
        { ic: 'fa-building', label: '간접비·부가세', val: wonShort(tI), sub: '총액의 ' + Math.round(pct(tI, tG) * 100) + '%' }
    ];
    const kpiHtml = `<div class="summary-cards">${kpis.map(c => `
        <div class="summary-card"><div class="sc-icon"><i class="fas ${c.ic}"></i></div>
        <div class="sc-body"><div class="sc-label">${c.label}</div><div class="sc-value">${escHtmlSafe(c.val)}</div><div class="sc-sub">${escHtmlSafe(c.sub)}</div></div></div>`).join('')}</div>`;

    if (!keys.length) { overviewWrap.innerHTML = kpiHtml + `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>등록된 예산이 없습니다</h3><p>상단 '과제 추가'로 시작하세요.</p></div>`; return; }

    // 교수님 지정 순서(고정) — keys 가 이미 그 순서
    const byAmt = keys.slice();

    // ---- 연구활동비 집행현황 (전체 취합) — 예산에서 가장 중요 ----
    let eBud = 0, eSpent = 0;
    keys.forEach(k => { const st = actStat(state.projects[k]); eBud += st.budget; eSpent += st.spent; });
    const eRemain = eBud - eSpent, eRate = pct(eSpent, eBud);
    const execRows = byAmt.filter(k => actStat(state.projects[k]).budget > 0).map(k => {
        const p = state.projects[k], st = actStat(p), pace = paceOf(p);
        return `<tr data-key="${escHtmlSafe(k)}">
            <td class="ex-name">${escHtmlSafe(p.name)}</td>
            <td class="bt-num">${won(st.budget)}</td>
            <td class="bt-num">${won(st.spent)}</td>
            <td class="bt-num">${won(st.remain)}</td>
            <td class="ex-barcell">${execBarHTML(st.rate, true)}<span class="ex-rate">${Math.round(st.rate * 100)}%</span></td>
            <td class="ex-pace">${state.year !== ALL ? paceBadge(pace) : '<span class="muted">-</span>'}</td>
            <td class="ex-note">${p.actNote ? escHtmlSafe(p.actNote) : '<span class="muted">-</span>'}</td>
        </tr>`;
    }).join('');
    const execHtml = `<div class="ov-sec-head"><i class="fas fa-gauge-high"></i> 연구활동비 집행현황 / 이슈 <span class="ov-sec-sub">(예산에서 가장 중요한 부분)</span></div>
        <div class="exec-overview card">
            <div class="exec-metrics big">
                <div class="exec-m"><span class="exec-m-label">연구활동비 배정</span><span class="exec-m-val">${wonShort(eBud)}<small>원</small></span></div>
                <div class="exec-m"><span class="exec-m-label">집행</span><span class="exec-m-val">${wonShort(eSpent)}<small>원</small></span></div>
                <div class="exec-m"><span class="exec-m-label">잔액</span><span class="exec-m-val${eRemain < 0 ? ' neg' : ''}">${wonShort(eRemain)}<small>원</small></span></div>
                <div class="exec-m"><span class="exec-m-label">전체 집행률</span><span class="exec-m-val">${Math.round(eRate * 100)}<small>%</small></span></div>
            </div>
            ${execBarHTML(eRate)}
            ${execRows
            ? `<div class="matrix-wrap"><table class="bud-ov-table exec-table"><thead><tr><th class="ex-name">과제</th><th class="bt-num">배정</th><th class="bt-num">집행</th><th class="bt-num">잔액</th><th>집행률</th><th>페이스</th><th class="ex-note">이슈/메모</th></tr></thead><tbody>${execRows}</tbody></table></div>`
            : `<div class="muted" style="padding:12px 2px 2px">연구활동비 배정/집행이 입력된 과제가 없습니다. ‘과제 추가/수정’에서 연구활동비 배정과 집행액을 입력하면 여기에 집계됩니다.</div>`}
        </div>`;

    // 과제별 요약 표 (검토용) — 직접비를 항목별로 풀어서 표시
    const cz = v => v ? won(v) : '<span class="muted">-</span>';   // 0이면 '-'
    const trows = byAmt.map(k => {
        const p = state.projects[k], x = compParts(p), a = x.a;
        const catCls = p.category === '국가R&D' ? 'c-nat' : (p.category === '비R&D' ? 'c-non' : 'c-etc');
        return `<tr data-key="${escHtmlSafe(k)}">
            <td class="bt-name">${escHtmlSafe(p.name)}${isLinked(p) ? ' <i class="fas fa-link link-ic"></i>' : ''}</td>
            <td class="bt-cat"><span class="src-dot ${catCls}"></span>${escHtmlSafe(p.category)}</td>
            <td class="bt-num bt-total"><b>${won(x.grand)}</b></td>
            <td class="bt-num">${won(x.labor)} <span class="bt-pct">${Math.round(pct(x.labor, x.grand) * 100)}%</span></td>
            <td class="bt-num">${cz(num(a.activity))}</td>
            <td class="bt-num">${cz(num(a.stipend))}</td>
            <td class="bt-num">${cz(num(a.equipCash))}</td>
            <td class="bt-num">${cz(num(a.material))}</td>
            <td class="bt-num">${cz(x.io)}</td>
            <td class="bt-mgr">${escHtmlSafe(p.manager || '-')}</td>
        </tr>`;
    }).join('');
    const tfoot = `<tr class="foot"><td>합계</td><td></td><td class="bt-num bt-total"><b>${won(tG)}</b></td>
        <td class="bt-num">${won(tL)} <span class="bt-pct">${Math.round(pct(tL, tG) * 100)}%</span></td>
        <td class="bt-num">${won(tAct)}</td><td class="bt-num">${won(tStip)}</td><td class="bt-num">${won(tEq)}</td><td class="bt-num">${won(tMat)}</td><td class="bt-num">${won(tI)}</td><td></td></tr>`;
    const tableHtml = `<div class="matrix-wrap bud-ov-tablewrap"><table class="bud-ov-table">
        <thead><tr><th class="bt-name">과제</th><th>재원</th><th class="bt-num">총액(원)</th><th class="bt-num">인건비(비중)</th><th class="bt-num">연구활동비</th><th class="bt-num">연구수당</th><th class="bt-num">기자재</th><th class="bt-num">재료비</th><th class="bt-num">간접·부가</th><th class="bt-mgr">담당</th></tr></thead>
        <tbody>${trows}</tbody><tfoot>${tfoot}</tfoot></table></div>`;

    const cards = byAmt.map(k => {
        const p = state.projects[k], x = compParts(p);
        const barTotal = Math.max(1, x.labor + x.directOnly + x.io);
        const seg = (v, cls) => v > 0 ? `<span class="cmp-seg ${cls}" style="width:${(v / barTotal * 100).toFixed(1)}%"></span>` : '';
        const catCls = p.category === '국가R&D' ? 'c-nat' : (p.category === '비R&D' ? 'c-non' : 'c-etc');
        return `<div class="ov-card card" data-key="${escHtmlSafe(k)}">
            <div class="ov-card-head">
                <div class="ov-card-titlewrap">
                    <div class="ov-title">${escHtmlSafe(p.name)}${isLinked(p) ? ' <i class="fas fa-link link-ic"></i>' : ''}</div>
                    <div class="ov-agency"><span class="src-dot ${catCls}"></span>${escHtmlSafe(p.category)}${p.manager ? ' · ' + escHtmlSafe(p.manager) : ''}${p.period ? ' · ' + escHtmlSafe(p.period) : ''}</div>
                </div>
                <button class="tb-btn ov-detail-btn">상세 <i class="fas fa-arrow-right"></i></button>
            </div>
            <div class="ov-total">총액 <b>${won(x.grand)}</b>원</div>
            <div class="cmp-bar">${seg(x.labor, 'cmp-labor')}${seg(x.directOnly, 'cmp-direct')}${seg(x.io, 'cmp-indirect')}</div>
            <div class="cmp-legend"><span><i class="cmp-labor"></i>인건비 ${wonShort(x.labor)}</span><span><i class="cmp-direct"></i>직접비 ${wonShort(x.directOnly)}</span><span><i class="cmp-indirect"></i>간접·부가 ${wonShort(x.io)}</span></div>
        </div>`;
    }).join('');
    overviewWrap.innerHTML = kpiHtml + execHtml
        + `<div class="ov-sec-head"><i class="fas fa-table"></i> 과제별 예산 요약 <span class="ov-sec-sub">(지정 순서)</span></div>` + tableHtml
        + `<div class="ov-sec-head"><i class="fas fa-grip"></i> 과제별 카드</div><div class="ov-grid">${cards}</div>`;
    overviewWrap.querySelectorAll('.ov-card').forEach(el => el.addEventListener('click', () => selectProject(el.dataset.key)));
    overviewWrap.querySelectorAll('.bud-ov-table tbody tr[data-key]').forEach(el => el.addEventListener('click', () => selectProject(el.dataset.key)));
}

// ---- 연구활동비 집행현황 블록 (상세) ----
function renderExecDetail(p) {
    const el = document.getElementById('execDetail'); if (!el) return;
    const s = actStat(p), pace = paceOf(p);
    const elp = (pace.el != null) ? Math.round(pace.el * 100) : null;
    el.innerHTML = `
    <div class="exec-card card">
        <div class="exec-head">
            <h2><i class="fas fa-gauge-high"></i> 연구활동비 집행현황 / 이슈</h2>
            ${state.year !== ALL ? paceBadge(pace) : ''}
        </div>
        <div class="exec-metrics">
            <div class="exec-m"><span class="exec-m-label">배정</span><span class="exec-m-val">${won(s.budget)}<small>원</small></span></div>
            <div class="exec-m"><span class="exec-m-label">집행</span><span class="exec-m-val">${won(s.spent)}<small>원</small></span></div>
            <div class="exec-m"><span class="exec-m-label">잔액</span><span class="exec-m-val${s.remain < 0 ? ' neg' : ''}">${won(s.remain)}<small>원</small></span></div>
            <div class="exec-m"><span class="exec-m-label">집행률</span><span class="exec-m-val">${Math.round(s.rate * 100)}<small>%</small></span></div>
        </div>
        ${execBarHTML(s.rate)}
        ${elp != null ? `<div class="exec-pace-note">기간 경과 <b>${elp}%</b> 대비 집행률 <b>${Math.round(s.rate * 100)}%</b></div>` : ''}
        <div class="exec-issue"><i class="fas fa-pen-to-square"></i> ${p.actNote ? escHtmlSafe(p.actNote) : '<span class="muted">집행 이슈/메모가 없습니다. ‘이 과제 수정’에서 입력하세요.</span>'}</div>
    </div>`;
}

// ---- 과제 상세 ----
function renderDetail() {
    const p = currentProject(); if (!p) return;
    const x = compParts(p), a = x.a, c = x.c, grand = x.grand;
    const laborPct = Math.round(pct(c.labor, grand) * 100);
    const chipsArr = [
        { label: '인건비', v: c.labor }, { label: '직접비(기타)', v: x.directOnly },
        { label: '간접비', v: num(a.indirect) }, { label: '부가세', v: num(a.vat) }
    ].filter(t => t.v > 0);
    const chips = chipsArr.map(t => `<div class="cat-chip">
        <span class="cat-chip-label">${t.label}</span><span class="cat-chip-num">${won(t.v)}</span>
        <span class="cat-chip-lack">${Math.round(pct(t.v, grand) * 100)}%</span></div>`).join('') || '<span class="muted">배정 항목이 없습니다.</span>';

    summaryCards.innerHTML = `
        <div class="summary-main card">
            <div class="gauge-wrap">
                <div class="gauge" style="--pct:${Math.min(100, laborPct)}" title="인건비 ÷ 예산 총액"><div class="gauge-num">${laborPct}<small>%</small></div></div>
                <div class="gauge-cap">인건비 비중</div>
            </div>
            <div class="summary-main-info">
                <div class="summary-title">${escHtmlSafe(p.name)} · 예산 총액 <b>${won(grand)}</b>원</div>
                <div class="summary-sub">인건비 <b>${won(c.labor)}</b>(인건비 비중 ${laborPct}%) · 직접비 <b>${won(x.directOnly)}</b> · 간접·부가 <b>${won(x.io)}</b></div>
                <div class="summary-agency"><i class="fas fa-building"></i> ${escHtmlSafe(p.category)}${p.manager ? ' · 담당 ' + escHtmlSafe(p.manager) : ''}${p.period ? ' · ' + escHtmlSafe(p.period) : ''}${isLinked(p) ? ' · <i class="fas fa-link link-ic"></i> 인건비 연동' : ''}</div>
                ${p.note ? `<div class="summary-agency"><i class="fas fa-tag"></i> ${escHtmlSafe(p.note)}</div>` : ''}
            </div>
        </div>
        <div class="cat-chips">${chips}</div>`;

    renderExecDetail(p);

    const sp = {}; BITEMS.forEach(it => sp[it.key] = spentOf(p, it.key));
    const cs = calc(sp);
    const execCells = (vv, sv) => {
        const remain = vv - sv, rate = pct(sv, vv);
        return `<td>${sv ? won(sv) : '<span class="muted">–</span>'}</td>
            <td class="${remain < 0 ? 'mtx-neg' : ''}">${vv ? won(remain) : '<span class="muted">–</span>'}</td>
            <td class="mtx-prog">${vv ? `<div class="exec-bar sm"><span style="width:${Math.min(100, rate * 100).toFixed(1)}%"></span></div><span class="ex-rate">${Math.round(rate * 100)}%</span>` : ''}</td>`;
    };
    const rows = LAYOUT.map(row => {
        if (row.type === 'item') {
            const it = BITEMS.find(i => i.key === row.key), v = num(a[row.key]), sv = num(sp[row.key]), linked = it.linked && isLinked(p);
            const exclTag = row.key === 'vat' ? ' <span class="mtx-inkind">총액 미포함</span>' : '';
            return `<tr${row.key === 'vat' ? ' class="mtx-inkind-row"' : ''}><td class="mtx-name">${it.label}${linked ? ' <i class="fas fa-link link-ic" title="인건비 연동"></i>' : ''}${exclTag}</td>
                <td>${v ? won(v) : '<span class="muted">–</span>'}</td>${execCells(v, sv)}</tr>`;
        }
        const val = c[row.calc], sval = cs[row.calc], cls = row.type === 'total' ? 'mtx-total' : 'mtx-sub';
        return `<tr class="${cls}"><td class="mtx-name">${row.label}</td><td>${won(val)}</td>${execCells(val, sval)}</tr>`;
    }).join('');
    matrixWrap.innerHTML = `<table class="perf-matrix bud-matrix"><thead><tr><th class="mtx-name">항목</th><th>배정 (원)</th><th>집행 (원)</th><th>잔액</th><th>진행률</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.getElementById('editProjectBtn2').style.display = state.readOnly ? 'none' : '';
    renderPeople(p);
}

function renderPeople(p) {
    const ppl = p.people || [];
    peoplePeriod.textContent = p.period || '';
    if (!ppl.length) { peopleWrap.innerHTML = '<div class="muted" style="padding:16px">인력구성 정보가 없습니다.</div>'; return; }
    const ratePct = r => r == null ? '' : (Math.round(r * 1000) / 10) + '%';
    const groups = [['internal', '내부인건비 (교수·현물/자부담)'], ['student', '학생·외부 인건비 (현금)']];
    let body = '';
    groups.forEach(([g, label]) => {
        const rows = ppl.filter(e => e.grp === g); if (!rows.length) return;
        body += `<tr class="pgrp"><td colspan="5">${label}</td></tr>`;
        let sub = 0, prev = null, pidx = -1;
        rows.forEach(e => {
            if (!e.excl) sub += num(e.amount);                      // 잔여(note)는 합계 포함 · 별도(excl)만 제외
            const isNew = e.name !== prev; if (isNew) pidx++;       // 사람이 바뀌면 구분선 + 줄무늬 토글
            prev = e.name;
            const cls = [isNew ? 'p-sep' : 'p-cont', pidx % 2 ? 'p-alt' : '', e.excl ? 'pexcl' : ''].filter(Boolean).join(' ');
            const nameCell = isNew ? escHtmlSafe(e.name) : '';      // 같은 사람 연속 줄은 이름 생략(묶여 보이게)
            const amtCell = e.excl ? `${won(e.amount)} <span class="excl-tag" title="예산 합계 미포함">별도</span>` : won(e.amount);
            if (e.note) body += `<tr class="pnote ${cls}"><td class="mtx-name">${escHtmlSafe(e.name)}</td><td colspan="3" class="pmemo">${e.memo ? escHtmlSafe(e.memo) : '<span class="muted">사유 미입력</span>'}</td><td>${won(e.amount)} <span class="excl-tag jat" title="합계 포함(잔여)">잔여</span></td></tr>`;
            else body += `<tr class="${cls}"><td class="mtx-name">${nameCell}</td><td>${ratePct(e.rate)}</td><td>${e.base ? won(e.base) : ''}</td><td>${e.months != null ? e.months : ''}</td><td>${amtCell}</td></tr>`;
        });
        body += `<tr class="mtx-sub"><td class="mtx-name">${label.split(' ')[0]} 합계</td><td></td><td></td><td></td><td>${won(sub)}</td></tr>`;
    });
    peopleWrap.innerHTML = `<table class="perf-matrix people-table"><thead><tr><th class="mtx-name">이름</th><th>참여율</th><th>급여기준(월)</th><th>기간(월)</th><th>인건비</th></tr></thead><tbody>${body}</tbody></table>`;
}

function selectProject(k) { state.currentKey = k; projectSelect.value = k; renderCurrent(); }

// 엑셀 시드를 화면으로 강제 로드 (DB에 옛 데이터가 남아 가려질 때 사용)
function loadSeedView() {
    const s = SEED[String(state.year)];
    if (!s || !s.length) { showAlert(state.year + '년 엑셀 시드 데이터가 없습니다.', 'warning'); return; }
    if (Object.keys(state.projects).length && !confirm('현재 화면을 엑셀 기준 데이터로 덮어씁니다. 계속할까요?\n(‘이 데이터로 시작’을 눌러야 서버에 저장됩니다.)')) return;
    const pr = {}; s.forEach((p, i) => pr['seed' + i] = normalizeProject(Object.assign({ order: i }, p)));
    state.projects = pr; state.isSeed = true; state.currentKey = OVERVIEW;
    renderAll();
    showAlert('엑셀값을 불러왔습니다. 확인 후 ‘이 데이터로 시작’으로 저장하세요.', 'success');
}

// ==================== 모달 편집 ====================
function modalItemsHTML(p) {
    const a = p.alloc || {}, sp = p.spent || {};
    const head = `<div class="mi-row mi-head"><span class="mi-label"></span><span class="mi-col">배정 (원)</span><span class="mi-col">집행 (원)</span></div>`;
    return head + BITEMS.map(it => {
        if (it.key === 'student' && !state.isRoot) {
            return `<div class="mi-row" data-k="student"><span class="mi-label">${it.label} <i class="fas fa-link link-ic" title="학생인건비 합계(인건비 페이지 자동 연동)"></i></span><input class="mi-input" value="${silabMoneyFmt(a.student)}" readonly><input class="mi-spent" value="${silabMoneyFmt((sp || {}).student)}" readonly placeholder="집행"></div>`;
        }
        const linked = it.linked && isLinked(p);
        const v = linked ? payrollWindowSum(p, state.year) : num(a[it.key]);
        return `<div class="mi-row" data-k="${it.key}">
            <span class="mi-label">${it.label}${linked ? ' <i class="fas fa-link link-ic"></i>' : ''}</span>
            <input type="text" inputmode="numeric" class="mi-input js-money" value="${silabMoneyFmt(v)}"${linked ? ' readonly' : ''}>
            <input type="text" inputmode="numeric" class="mi-spent js-money" value="${silabMoneyFmt(num(sp[it.key]))}" placeholder="집행"></div>`;
    }).join('');
}
// ---- 인력구성 편집 ----
function isJatEntry(e) { return !!(e && (e.note || (e.name || '').includes('잔여'))); }
function personRowHTML(e) {
    e = e || { grp: 'student' };
    const sel = g => `<option value="student"${g === 'student' ? ' selected' : ''}>학생·외부</option><option value="internal"${g === 'internal' ? ' selected' : ''}>내부(교수)</option>`;
    const jat = isJatEntry(e);
    const mid = jat
        ? `<input class="pe-memo" type="text" value="${escHtmlSafe(e.memo || '')}" placeholder="잔여 사유 (예: 연구수당 이슈로 hold)">`
        : `<input class="pe-rate" type="number" step="any" value="${e.rate != null ? (Math.round(e.rate * 1000) / 10) : ''}" placeholder="%">
           <input class="pe-base js-money" type="text" inputmode="numeric" value="${silabMoneyFmt(e.base)}" placeholder="급여기준">
           <input class="pe-months" type="number" step="any" value="${e.months != null ? e.months : ''}" placeholder="개월">`;
    return `<div class="pe-row${jat ? ' pe-jat' : ''}">
        <select class="pe-grp">${sel(e.grp)}</select>
        <input class="pe-name" type="text" value="${escHtmlSafe(e.name || '')}" placeholder="이름">
        ${mid}
        <input class="pe-amount js-money" type="text" inputmode="numeric" value="${silabMoneyFmt(e.amount)}" placeholder="인건비">
        <button type="button" class="pe-del" title="삭제"><i class="fas fa-xmark"></i></button>
    </div>`;
}
function readPersonRow(row) {
    const name = row.querySelector('.pe-name').value.trim();
    const e = { name, grp: row.querySelector('.pe-grp').value };
    const memo = row.querySelector('.pe-memo');
    const rate = row.querySelector('.pe-rate'), base = row.querySelector('.pe-base'), months = row.querySelector('.pe-months');
    if (rate && rate.value !== '') e.rate = num(rate.value) / 100;
    if (base && base.value !== '') e.base = num(base.value);
    if (months && months.value !== '') e.months = num(months.value);
    e.amount = num(row.querySelector('.pe-amount').value);
    if (name.includes('잔여')) { e.note = true; if (memo && memo.value.trim()) e.memo = memo.value.trim(); }
    return e;
}
function wirePersonRow(row) {
    row.querySelector('.pe-del').addEventListener('click', () => { row.remove(); recalcModal(); });
    row.querySelectorAll('input,select').forEach(inp => inp.addEventListener('input', recalcModal));
    const nameInp = row.querySelector('.pe-name');
    nameInp.addEventListener('input', () => {
        // 이름에 '잔여' 포함 여부가 바뀌면 행 구조(비고↔참여율)를 전환
        if (nameInp.value.includes('잔여') !== row.classList.contains('pe-jat')) {
            const cur = readPersonRow(row);
            const tmp = document.createElement('div'); tmp.innerHTML = personRowHTML(cur);
            const nr = tmp.firstElementChild; row.replaceWith(nr); wirePersonRow(nr);
            const ni = nr.querySelector('.pe-name'); ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length);
            recalcModal();
        }
    });
}
function addPersonRow(e) {
    const wrap = document.getElementById('modalPeople');
    const tmp = document.createElement('div'); tmp.innerHTML = personRowHTML(e);
    const row = tmp.firstElementChild; wrap.appendChild(row);
    wirePersonRow(row);
    return row;
}
function renderModalPeople(people) {
    const wrap = document.getElementById('modalPeople'); wrap.innerHTML = '';
    (people || []).forEach(e => addPersonRow(e));
}
function collectPeople() {
    const people = [];
    document.querySelectorAll('#modalPeople .pe-row').forEach(r => {
        const e = readPersonRow(r); if (!e.name) return; people.push(e);
    });
    return people;
}
function collectModal() {
    const g = id => document.getElementById(id);
    const alloc = {}, spent = {};
    document.querySelectorAll('#modalItems .mi-row[data-k]').forEach(r => {
        const inp = r.querySelector('.mi-input');
        if (inp) {
            if (!inp.readOnly) alloc[r.dataset.k] = num(inp.value);
            else if (r.dataset.k === 'student') alloc.student = num(inp.value);   // 연동된 학생인건비 합계를 과제에 저장(일반 관리자도 열람 가능)
        }
        const si = r.querySelector('.mi-spent'); if (si && num(si.value)) spent[r.dataset.k] = num(si.value);
    });
    return {
        name: (g('bName').value.trim()) || '(새 과제)', category: g('bCategory').value,
        manager: g('bManager').value.trim(), period: g('bPeriod').value.trim(), note: g('bNote').value.trim(),
        payrollName: state.projects[state.editKey] ? (state.projects[state.editKey].payrollName || '') : '',
        order: state.projects[state.editKey] ? state.projects[state.editKey].order : Object.keys(state.projects).length,
        actNote: g('bActNote').value.trim(),
        alloc, spent, people: collectPeople()
    };
}
function recalcModal() {
    const g = id => document.getElementById(id);
    // 같은 이름의 인건비 과제가 있으면 학생인건비 자동연동(읽기전용) — 차년도 기간 기준
    const probe = { name: g('bName').value, period: g('bPeriod').value, payrollName: (state.projects[state.editKey] ? state.projects[state.editKey].payrollName : '') };
    const linkSum = state.year !== ALL ? payrollWindowSum(probe, state.year) : null;
    const sr = document.querySelector('#modalItems .mi-row[data-k="student"]');
    if (sr && state.isRoot) {
        const inp = sr.querySelector('.mi-input'), note = sr.querySelector('.link-ic');
        if (linkSum != null) { inp.readOnly = true; inp.value = silabMoneyFmt(linkSum); if (!note) sr.querySelector('.mi-label').insertAdjacentHTML('beforeend', ' <i class="fas fa-link link-ic" title="인건비 페이지 자동연동(차년도 기간 합산)"></i>'); }
        else { inp.readOnly = false; if (note) note.remove(); }
    }
    const m = {}, sp = {};
    document.querySelectorAll('#modalItems .mi-row[data-k]').forEach(r => {
        m[r.dataset.k] = num(r.querySelector('.mi-input').value);
        const si = r.querySelector('.mi-spent'); sp[r.dataset.k] = si ? num(si.value) : 0;
    });
    const c = calc(m), cs = calc(sp);
    g('modalPreview').innerHTML = `<div class="as-text">인건비 소계 <b>${won(c.labor)}</b> · 직접비 총계 <b>${won(c.direct)}</b> · <span class="hi">총액 <b>${won(c.grand)}</b>원</span> · 집행 합계 <b>${won(cs.grand)}</b></div>`;
    // 인력 합계 vs 예산(학생·외부 인건비) 대조
    const ppl = collectPeople();
    const ps = ppl.filter(e => e.grp === 'student' && !e.note).reduce((a, e) => a + num(e.amount), 0);
    const pi = ppl.filter(e => e.grp === 'internal').reduce((a, e) => a + num(e.amount), 0);
    const budStu = num(m.external) + num(m.student) + num(m.inHouseCash);
    const sumEl = g('modalPeopleSum');
    if (sumEl) sumEl.innerHTML = ppl.length
        ? `내부(현물) 합 <b>${won(pi)}</b> · 학생·외부 합 <b>${won(ps)}</b> <span class="${ps === budStu ? 'pe-ok' : 'pe-warn'}">(예산 인건비 ${won(budStu)} ${ps === budStu ? '일치' : '불일치'})</span>`
        : '';
}
function openProjectForm(key) {
    state.editKey = key;
    const p = key ? state.projects[key] : normalizeProject({ category: '국가R&D' });
    const g = id => document.getElementById(id);
    g('projectFormTitle').textContent = key ? '과제 수정' : '새 과제 추가';
    g('bName').value = key ? p.name : '';
    g('bCategory').value = p.category; g('bManager').value = p.manager; g('bPeriod').value = p.period; g('bNote').value = p.note;
    g('bActNote').value = p.actNote || '';
    g('modalItems').innerHTML = modalItemsHTML(p);
    document.querySelectorAll('#modalItems .mi-input, #modalItems .mi-spent').forEach(inp => inp.addEventListener('input', recalcModal));
    g('bName').oninput = recalcModal; g('bPeriod').oninput = recalcModal;   // 이름/기간 바뀌면 연동 재평가
    renderModalPeople(p.people);
    recalcModal();
    openModal('projectFormModal');
}
async function saveProject(e) {
    e.preventDefault();
    const name = document.getElementById('bName').value.trim();
    if (!name) { showAlert('과제명을 입력하세요.', 'warning'); return; }
    const proj = collectModal(); proj.name = name;
    const key = state.editKey || uid();
    state.projects[key] = normalizeProject(proj);
    try { await saveAll(); closeModal('projectFormModal'); state.currentKey = key; showAlert('저장되었습니다.', 'success'); renderAll(); }
    catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}
async function deleteProject() {
    const p = currentProject(); if (!p) return;
    if (!confirm(`‘${p.name}’ 과제 예산을 삭제할까요?`)) return;
    delete state.projects[state.currentKey]; state.currentKey = OVERVIEW;
    try { await saveAll(); showAlert('삭제되었습니다.', 'success'); renderAll(); }
    catch (err) { showAlert('삭제 실패: ' + err.message, 'error'); }
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    const g = id => document.getElementById(id);
    loginBtn = g('loginBtn'); logoutBtn = g('logoutBtn'); loginModal = g('loginModal'); loginClose = g('loginClose');
    loginForm = g('loginForm'); userInfo = g('userInfo'); userName = g('userName');
    authGate = g('authGate'); budApp = g('budApp'); yearSelect = g('yearSelect'); projectSelect = g('projectSelect');
    seedBanner = g('seedBanner'); overviewWrap = g('overviewWrap'); detailWrap = g('detailWrap');
    summaryCards = g('summaryCards'); matrixWrap = g('matrixWrap');
    peopleWrap = g('peopleWrap'); peoplePeriod = g('peoplePeriod');

    yearSelect.innerHTML = `<option value="${ALL}">전체 (누계)</option>` + YEAR_NUMS.map(y => `<option value="${y}"${y === DEFAULT_YEAR ? ' selected' : ''}>${y}년</option>`).join('');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth(); database = firebase.database();
    } catch (e) { console.error('Firebase 초기화 실패', e); return; }

    auth.onAuthStateChanged(async (user) => {
        if (user && ALLOWED_USERS.includes(user.uid)) currentUser = user;
        else { currentUser = null; if (user && [ADMIN_UID, ROOT_UID].indexOf(user.uid) < 0) await auth.signOut(); }   // 외부 계정만 로그아웃
        state.isRoot = !!(currentUser && currentUser.uid === ROOT_UID);
        updateAuthUI();
        if (currentUser) { try { await loadData(); renderAll(); } catch (e) { console.error(e); showAlert('데이터 로드 실패', 'error'); } }
    });

    loginBtn && loginBtn.addEventListener('click', () => openModal('loginModal'));
    const gateBtn = authGate && authGate.querySelector('#gateLoginBtn');
    gateBtn && gateBtn.addEventListener('click', () => openModal('loginModal'));
    loginClose && loginClose.addEventListener('click', () => closeModal('loginModal'));
    loginModal && loginModal.addEventListener('click', e => { if (e.target === loginModal) closeModal('loginModal'); });
    logoutBtn && logoutBtn.addEventListener('click', async () => { await auth.signOut(); showAlert('로그아웃되었습니다.', 'success'); });
    loginForm && loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await loginUser(g('email').value.trim(), g('password').value); closeModal('loginModal'); loginForm.reset(); showAlert('로그인되었습니다.', 'success'); }
        catch (err) { showAlert(err.message || '로그인 실패', 'error'); }
    });

    yearSelect.addEventListener('change', async () => {
        // 상세 보던 중이면 같은 과제명을 새 연도에서도 유지 (없으면 개요)
        const keepName = (state.currentKey !== OVERVIEW && currentProject()) ? currentProject().name : null;
        state.year = yearSelect.value === ALL ? ALL : Number(yearSelect.value);
        try {
            await loadData();
            if (keepName) {
                const k = Object.keys(state.projects).find(kk => state.projects[kk].name === keepName);
                state.currentKey = k || OVERVIEW;
            } else state.currentKey = OVERVIEW;
            renderAll();
        } catch (e) { showAlert('데이터 로드 실패', 'error'); }
    });
    projectSelect.addEventListener('change', () => { state.currentKey = projectSelect.value; renderCurrent(); });

    g('loadSeedBtn').addEventListener('click', loadSeedView);
    g('addProjectBtn').addEventListener('click', () => openProjectForm(null));
    const editCur = () => { if (currentProject()) openProjectForm(state.currentKey); else showAlert('수정할 과제를 먼저 선택하세요.', 'warning'); };
    g('editProjectBtn').addEventListener('click', editCur);
    g('editProjectBtn2').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); editCur(); });
    g('deleteProjectBtn').addEventListener('click', deleteProject);
    g('addPersonBtn').addEventListener('click', () => { addPersonRow({ grp: 'student' }); recalcModal(); });
    g('projectForm').addEventListener('submit', saveProject);

    g('seedSaveBtn').addEventListener('click', async () => { try { await saveAll(); showAlert('초기 데이터를 저장했습니다.', 'success'); renderAll(); } catch (e) { showAlert('저장 실패: ' + e.message, 'error'); } });
    g('seedDismissBtn').addEventListener('click', () => { state.projects = {}; state.isSeed = false; state.currentKey = OVERVIEW; renderAll(); });

    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    document.querySelectorAll('.perf-modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));
});
