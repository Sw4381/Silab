// payroll.js - 학생 인건비 관리 (로그인 전용)
// 설정값은 config.js 참조 (firebaseConfig, ALLOWED_EMAIL)
// DB 경로: payroll/{year}/{projects, caps, memberOrder, meta}
// 금액 단위: 만원

// ==================== 상수 ====================
const ALLOWED_USERS = [ROOT_UID];   // 학생인건비는 Root 계정(UID) 전용
const MONTHS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const DEFAULT_YEAR = 2026;
const YEAR_OPTIONS = [2024, 2025, 2026, 2027];
const CATEGORIES = ['국가R&D', '비R&D', '기타'];
const STATUSES = ['확정', '협의중', '종료'];

// 재원 구분별 색 램프 (쿨=국가R&D, 웜=비R&D, 중립=기타) — 과제별로 한 칸씩 배정
const COLOR_RAMP = {
    '국가R&D': ['#0b5e8a', '#1577a8', '#2a93c0', '#46aed2', '#6cc6df', '#97dbe6', '#c0e7ef'],
    '비R&D': ['#cf6a1e', '#e0892b', '#eea64e', '#f3bd73', '#f7d49b'],
    '기타': ['#6f7a8a', '#8c97a6', '#aab3c0']
};
const CAT_COLOR = { '국가R&D': '#1577a8', '비R&D': '#e0892b', '기타': '#8c97a6' };
function projectColorMap(live) {
    const keys = Object.keys(live).sort((a, b) => (live[a].order || 0) - (live[b].order || 0));
    const cnt = {}, map = {};
    keys.forEach(k => {
        const c = CATEGORIES.includes(live[k].category) ? live[k].category : '기타';
        const ramp = COLOR_RAMP[c]; const i = (cnt[c] = cnt[c] || 0);
        map[k] = ramp[i % ramp.length]; cnt[c]++;
    });
    return map;
}

// 엑셀 기준 초기 데이터 (해당 연도 DB가 비었을 때만 표시, 저장 전엔 미반영)
const SEED = { "projects": [], "caps": {}, "memberOrder": [] };  // 공개 저장소 보호: 실데이터는 Firebase에만

// ==================== 전역 상태 ====================
let auth, database, currentUser = null;
const state = {
    year: DEFAULT_YEAR,
    projects: {},      // { key: { name, category, status, note, order, rows:[{name,m[12],ext,note}] } }
    caps: {},          // { name: 연간기준(만원) }
    memberOrder: [],
    editKey: null,     // 현재 인라인 편집 중인 과제 키 (null=편집 안 함)
    isNew: false,      // 신규 과제 편집 여부
    dirty: false,      // 저장 안 된 변경 여부
    monthsExpanded: true, // 총액표: true=12개월 펼침(기본), false=분기 요약
    isSeed: false
};

// 현황표 열 묶음 (분기 / 월별)
function monthGroups() {
    if (state.monthsExpanded) return MONTHS.map((m, i) => ({ label: m, idxs: [i] }));
    return [
        { label: '1분기', idxs: [0, 1, 2] },
        { label: '2분기', idxs: [3, 4, 5] },
        { label: '3분기', idxs: [6, 7, 8] },
        { label: '4분기', idxs: [9, 10, 11] }
    ];
}
function sumIdx(arr, idxs) { return idxs.reduce((a, i) => a + num(arr[i]), 0); }

// DOM refs
let loginBtn, logoutBtn, loginModal, loginClose, loginForm, userInfo, userName;
let authGate, payApp, yearSelect, seedBanner;
let projChips, inlineEditor, dirtyBadge;
let blkAll, blkRnd, blkSvc, sumAll, sumRnd, sumSvc;

// ==================== 유틸 ====================
function escHtmlSafe(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function fmt(n) {
    n = Math.round((num(n) + Number.EPSILON) * 100) / 100;
    return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}
function uid() { return 'p' + Math.abs(((performance.now() * 1000) | 0)).toString(36) + (state._seq = (state._seq || 0) + 1).toString(36); }

function showAlert(message, type) {
    const el = document.createElement('div');
    el.className = `perf-alert ${type || 'info'}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }

// 12개월 배열 보정
function fix12(arr) {
    const out = Array(12).fill(0);
    if (Array.isArray(arr)) for (let i = 0; i < 12; i++) out[i] = num(arr[i]);
    else if (arr && typeof arr === 'object') for (let i = 0; i < 12; i++) out[i] = num(arr[i]);
    return out;
}
function normalizeProject(p) {
    let rows = p.rows;
    if (rows && !Array.isArray(rows)) rows = Object.keys(rows).map(k => rows[k]); // RTDB object → array
    rows = (rows || []).filter(Boolean).map(r => ({
        name: String(r.name || '').trim(),
        m: fix12(r.m),
        ext: num(r.ext),
        lump: num(r.lump),   // 여유분 등 월별 없는 단일 금액
        note: String(r.note || '')
    }));
    return {
        name: String(p.name || '(이름없음)'),
        category: CATEGORIES.includes(p.category) ? p.category : '국가R&D',
        status: STATUSES.includes(p.status) ? p.status : '확정',
        note: String(p.note || ''),
        order: num(p.order),
        nyMonths: Array.isArray(p.nyMonths) ? p.nyMonths.map(Number).filter(i => i >= 0 && i < 12) : [],   // 차기연도(내년)로 표시한 월 인덱스
        rows
    };
}
function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// 멤버 순서: memberOrder 우선 → caps → 과제 등장 순
function memberOrderResolved() {
    const seen = new Set(), out = [];
    const push = n => { n = (n || '').trim(); if (n && !seen.has(n)) { seen.add(n); out.push(n); } };
    (state.memberOrder || []).forEach(push);
    Object.keys(state.caps || {}).forEach(push);
    Object.values(state.projects).forEach(p => (p.rows || []).forEach(r => push(r.name)));
    return out;
}

// 현재 저장본 + 편집 중 초안을 합친 '라이브' 과제맵 (미리보기용)
function liveProjects() {
    if (!state.editKey) return state.projects;
    const merged = Object.assign({}, state.projects);
    merged[state.editKey] = collectEditor();
    return merged;
}

// ==================== 집계 ====================
function studentTotals(projects) {
    projects = projects || liveProjects();
    const seen = new Set(), order = [];
    const push = n => { n = (n || '').trim(); if (n && !seen.has(n)) { seen.add(n); order.push(n); } };
    (state.memberOrder || []).forEach(push);
    Object.keys(state.caps || {}).forEach(push);
    Object.values(projects).forEach(p => (p.rows || []).forEach(r => push(r.name)));
    const map = {};
    order.forEach(n => map[n] = { name: n, m: Array(12).fill(0), nyM: Array(12).fill(0), ext: 0, lump: 0, ny: 0, total: 0 });
    Object.values(projects).forEach(p => {
        const nySet = new Set((p.nyMonths || []).map(Number));   // 이 과제에서 내년(차기연도)로 표시한 월
        (p.rows || []).forEach(r => {
            const t = map[r.name]; if (!t) return;
            for (let i = 0; i < 12; i++) { const v = num(r.m[i]); t.m[i] += v; if (nySet.has(i)) t.nyM[i] += v; }
            t.ext += num(r.ext);
            t.lump += num(r.lump);
        });
    });
    return order.map(n => {
        const s = map[n];
        s.ny = s.nyM.reduce((a, b) => a + b, 0);                                                    // 내년 분(올해 총합 제외)
        s.total = s.m.reduce((a, b) => a + b, 0) - s.ny + num(s.lump) + num(s.ext);                 // 올해분(월별−내년) + 여유분 + 외부
        s.cap = num(state.caps[n]); s.ratio = s.cap ? s.total / s.cap : 0;
        return s;
    });
}
function projectMonthlyTotals(p) {
    const m = Array(12).fill(0);
    (p.rows || []).forEach(r => { for (let i = 0; i < 12; i++) m[i] += num(r.m[i]); });
    return m;
}
function projectTotal(p) {   // 학생 인건비 탭 기준: 내년(차기연도) 월 제외
    const ny = new Set((p.nyMonths || []).map(Number));
    let s = 0;
    (p.rows || []).forEach(r => { for (let i = 0; i < 12; i++) if (!ny.has(i)) s += num(r.m[i]); s += num(r.lump) + num(r.ext); });
    return s;
}
function projectHeadcount(p) { return (p.rows || []).filter(r => r.m.some(x => num(x) > 0) || num(r.ext) > 0).length; }
function ratioClass(r) { return r > 1.0001 ? 'over' : (r >= 0.9 ? 'high' : (r > 0 ? 'ok' : 'zero')); }

// ==================== 인증 ====================
async function loginUser(email, password) {
    // 접근 권한은 로그인 후 UID(ALLOWED_USERS)로 확인 — 임의 계정 자동생성은 하지 않음
    try {
        return await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (error.code === 'auth/user-not-found') throw new Error('등록되지 않은 계정입니다.');
        if (error.code === 'auth/wrong-password') throw new Error('비밀번호가 틀렸습니다.');
        if (error.code === 'auth/invalid-email') throw new Error('이메일 형식이 올바르지 않습니다.');
        throw error;
    }
}
function updateAuthUI() {
    const authed = !!currentUser;
    if (loginBtn) loginBtn.style.display = authed ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = authed ? 'flex' : 'none';
    if (userInfo) userInfo.style.display = authed ? 'flex' : 'none';
    if (userName && currentUser) userName.textContent = currentUser.email;
    if (authGate) authGate.style.display = authed ? 'none' : 'flex';
    if (payApp) payApp.style.display = authed ? 'block' : 'none';
}

// ==================== 데이터 로드/저장 ====================
async function loadYear(year) {
    state.year = year;
    const snap = await database.ref('payroll/' + year).once('value');
    const data = snap.val();
    if (data && data.projects) {
        const projects = {};
        Object.keys(data.projects).forEach(k => { projects[k] = normalizeProject(data.projects[k]); });
        state.projects = projects;
        state.caps = data.caps || {};
        state.memberOrder = data.memberOrder || [];
        state.isSeed = false;
    } else if (year === DEFAULT_YEAR) {
        loadSeedIntoState();
        state.isSeed = true;
    } else {
        state.projects = {}; state.caps = {}; state.memberOrder = []; state.isSeed = false;
    }
}
function loadSeedIntoState() {
    const projects = {};
    SEED.projects.forEach((p, i) => { projects['seed' + i] = normalizeProject(Object.assign({ order: i }, p)); });
    state.projects = projects;
    state.caps = deepClone(SEED.caps);
    state.memberOrder = deepClone(SEED.memberOrder);
}
async function saveAll() {
    const payload = {
        projects: state.projects,
        caps: state.caps,
        memberOrder: memberOrderResolved(),
        meta: { updatedAt: new Date().toISOString(), updatedBy: currentUser ? currentUser.email : '' }
    };
    await database.ref('payroll/' + state.year).set(payload);
    state.isSeed = false;
}

// ==================== 렌더 ====================
function renderAll() {
    if (seedBanner) seedBanner.style.display = state.isSeed ? 'flex' : 'none';
    // 편집 대상이 사라졌으면 편집 종료
    if (state.editKey && !state.isNew && !state.projects[state.editKey]) { state.editKey = null; state.isNew = false; state.dirty = false; }
    if (!state.editKey) inlineEditor.style.display = 'none';
    refreshOverview();
    renderChips();
}

// 위쪽 3개 총액표만 다시 그림 (편집 입력 중 호출 — 에디터 DOM은 건드리지 않아 포커스 유지)
function refreshOverview() {
    const live = liveProjects();
    const rd = filterProjectMap(live, isRnd);
    const svc = filterProjectMap(live, p => !isRnd(p));
    if (blkAll) blkAll.innerHTML = totalsTableHTML(live, true);   // 전체 총액에만 비율(%) 표시
    if (blkRnd) blkRnd.innerHTML = totalsTableHTML(rd);
    if (blkSvc) blkSvc.innerHTML = totalsTableHTML(svc);
    setBlockSum(sumAll, live);
    setBlockSum(sumRnd, rd);
    setBlockSum(sumSvc, svc);
    if (dirtyBadge) dirtyBadge.style.display = state.dirty ? 'inline-flex' : 'none';
}

// 재원 구분: 국가R&D = R&D, 그 외(비R&D·기타) = 용역
function isRnd(p) { return p.category === '국가R&D'; }
function filterProjectMap(live, pred) {
    const out = {};
    Object.keys(live).forEach(k => { if (pred(live[k])) out[k] = live[k]; });
    return out;
}
function blockStat(projects) {
    const studs = studentTotals(projects);
    return { grand: studs.reduce((a, s) => a + s.total, 0), n: studs.filter(s => s.total > 0).length };
}
function setBlockSum(el, projects) {
    if (!el) return;
    const { grand, n } = blockStat(projects);
    el.innerHTML = `<b>${fmt(grand)}</b> 만원 <span class="bs-n">· ${n}명</span>`;
}

// 학생별 월별 총액표 (이름 · 월/분기 · 개인 총액). projects 부분집합으로 전체/R&D/용역을 동일 형식으로 렌더.
function totalsTableHTML(projects, withRatio) {
    const studs = studentTotals(projects).filter(s => s.total > 0 || s.ny > 0);
    if (!studs.length) return '<div class="pay-empty">해당 항목 인건비가 없습니다.</div>';
    const groups = monthGroups();
    const compact = state.monthsExpanded ? '' : ' compact';
    const colTotals = groups.map(() => 0); let grand = 0, extTotal = 0, nyTotal = 0;
    studs.forEach(s => { groups.forEach((g, gi) => colTotals[gi] += sumIdx(s.m, g.idxs)); grand += s.total; extTotal += num(s.ext); nyTotal += num(s.ny); });
    const hasExt = extTotal > 0;   // 외부인건비 있을 때만 외부 칼럼 표시
    const hasNy = nyTotal > 0;     // 내년(차기연도) 분 있을 때만 내년 칼럼 표시

    const head = `<tr>
        <th class="sticky-l">이름</th>
        ${groups.map(g => `<th>${g.label}</th>`).join('')}
        ${hasNy ? '<th class="col-ny" title="내년(차기연도) 분 — 올해 총합 제외">내년</th>' : ''}
        ${hasExt ? '<th class="col-ext">외부</th>' : ''}
        <th class="col-total">총액</th>
        ${withRatio ? '<th class="col-ratio">비율</th>' : ''}
    </tr>`;
    const body = studs.map((s, si) => {
        const cells = groups.map(g => {
            const v = sumIdx(s.m, g.idxs), nyv = sumIdx(s.nyM, g.idxs);
            const cls = v ? (nyv >= v ? 'ny-cell' : (nyv > 0 ? 'ny-part' : '')) : 'z';
            return `<td class="${cls}">${v ? fmt(v) : ''}</td>`;
        }).join('');
        const nyCell = hasNy ? `<td class="col-ny">${num(s.ny) ? fmt(s.ny) : ''}</td>` : '';
        const extCell = hasExt ? `<td class="col-ext">${num(s.ext) ? fmt(s.ext) : ''}</td>` : '';
        const ratioCell = withRatio
            ? `<td class="col-ratio">${s.cap ? `<span class="rt rt-${ratioClass(s.ratio)}">${(s.ratio * 100).toFixed(1)}%</span>` : '<span class="z">–</span>'}</td>`
            : '';
        return `<tr class="${si % 2 ? 's-alt' : ''}">
            <td class="sticky-l name">${escHtmlSafe(s.name)}</td>
            ${cells}
            ${nyCell}
            ${extCell}
            <td class="col-total"><b>${fmt(s.total)}</b></td>
            ${ratioCell}
        </tr>`;
    }).join('');
    const foot = `<tr class="foot">
        <td class="sticky-l">합계</td>
        ${colTotals.map(v => `<td>${v ? fmt(v) : ''}</td>`).join('')}
        ${hasNy ? `<td class="col-ny">${nyTotal ? fmt(nyTotal) : ''}</td>` : ''}
        ${hasExt ? `<td class="col-ext">${extTotal ? fmt(extTotal) : ''}</td>` : ''}
        <td class="col-total"><b>${fmt(grand)}</b></td>
        ${withRatio ? '<td class="col-ratio"></td>' : ''}
    </tr>`;
    const nyNote = hasNy ? `<div class="ny-note"><i class="fas fa-circle-info"></i> ‘내년(차기연도)’ 분 ${fmt(nyTotal)}만원은 <b>올해 총액에서 제외</b>되었습니다 (과제 세부 인건비에는 포함). 회색 칸이 내년 분입니다.</div>` : '';
    return nyNote + `<table class="student-table${compact}"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

// ==================== 과제 칩 ====================
function renderChips() {
    // 교수님 지정 순서(과제명 매칭) 우선 → 그 외 order
    const keys = Object.keys(state.projects).sort((a, b) => {
        const ca = silabCanonRank(state.projects[a].name), cb = silabCanonRank(state.projects[b].name);
        return (ca - cb) || ((state.projects[a].order || 0) - (state.projects[b].order || 0));
    });
    const catDot = p => p.category === '국가R&D' ? 'cat-nat' : (p.category === '비R&D' ? 'cat-non' : 'cat-etc');
    let html = keys.map(k => {
        const p = state.projects[k];
        return `<button type="button" class="chip${k === state.editKey ? ' active' : ''}" data-key="${escHtmlSafe(k)}">
            <span class="chip-dot ${catDot(p)}"></span>
            <span class="chip-name">${escHtmlSafe(p.name)}</span>
        </button>`;
    }).join('');
    if (state.isNew && state.editKey) {
        html += `<button type="button" class="chip active" data-key="${escHtmlSafe(state.editKey)}">
            <span class="chip-dot cat-etc"></span><span class="chip-name">새 과제…</span></button>`;
    }
    html += `<button type="button" class="chip add" id="newChip"><i class="fas fa-plus"></i> 새 과제</button>`;
    projChips.innerHTML = html;
    projChips.querySelectorAll('.chip[data-key]').forEach(c => c.addEventListener('click', () => selectProject(c.dataset.key)));
    const nc = document.getElementById('newChip');
    if (nc) nc.addEventListener('click', newProject);
}

// ==================== 인라인 과제 편집 ====================
// 월 머리글의 내년(차기연도) 표시 적용/수집
function setNyHeaders(nyMonths) {
    const set = new Set((nyMonths || []).map(Number));
    document.querySelectorAll('.member-grid th.mg-mhead').forEach(th => th.classList.toggle('ny', set.has(Number(th.dataset.mi))));
}
function collectNyMonths() {
    const out = [];
    document.querySelectorAll('.member-grid th.mg-mhead.ny').forEach(th => out.push(Number(th.dataset.mi)));
    return out.sort((a, b) => a - b);
}
function toggleNyHeader(th) {
    if (!state.editing) return;
    th.classList.toggle('ny');
    onEditorInput();
    recalcMemberGrid();
}
function collectEditor() {
    const rows = [];
    document.querySelectorAll('#memberRows .mg-row').forEach(tr => {
        const nm = tr.querySelector('.mg-nameinput').value.trim();
        if (!nm) return;
        const lumpInp = tr.querySelector('.mg-lump');
        if (lumpInp) {   // 여유분 행
            rows.push({ name: nm, m: Array(12).fill(0), ext: 0, lump: num(lumpInp.value), note: tr.querySelector('.mg-noteinput').value.trim() });
            return;
        }
        const m = Array.from(tr.querySelectorAll('.mg-m')).map(inp => num(inp.value));
        rows.push({ name: nm, m, ext: num(tr.querySelector('.mg-extinput').value), lump: 0, note: tr.querySelector('.mg-noteinput').value.trim() });
    });
    const existing = state.projects[state.editKey];
    return {
        name: (document.getElementById('projName').value.trim()) || '(새 과제)',
        category: document.getElementById('projCategory').value,
        status: document.getElementById('projStatus').value,
        note: document.getElementById('projNote').value.trim(),
        order: existing ? existing.order : Object.keys(state.projects).length,
        nyMonths: collectNyMonths(),
        rows
    };
}
function confirmDiscard() {
    return !state.dirty || confirm('저장하지 않은 변경이 있습니다. 버리고 이동할까요?');
}
function selectProject(k) {
    if (k === state.editKey) return;          // 이미 열려 있는 과제
    if (!confirmDiscard()) return;
    openEditor(k, false);
}
function newProject() {
    if (!confirmDiscard()) return;
    openEditor(uid(), true);
}
function onEditorInput() {
    state.dirty = true;
    recalcMemberGrid();
    refreshOverview();
}
function openEditor(key, isNew) {
    state.editKey = key; state.isNew = isNew; state.dirty = false;
    const p = isNew ? null : state.projects[key];
    inlineEditor.style.display = '';
    document.getElementById('projName').value = p ? p.name : '';
    document.getElementById('projCategory').value = p ? p.category : '국가R&D';
    document.getElementById('projStatus').value = p ? p.status : '확정';
    document.getElementById('projNote').value = p ? p.note : '';
    document.getElementById('deleteProjectBtn').style.display = isNew ? 'none' : '';
    document.getElementById('knownMembers').innerHTML = memberOrderResolved().map(n => `<option value="${escHtmlSafe(n)}">`).join('');
    ['projName', 'projCategory', 'projStatus', 'projNote'].forEach(id => {
        const el = document.getElementById(id); el.oninput = onEditorInput; el.onchange = onEditorInput;
    });
    const tbody = document.getElementById('memberRows');
    tbody.innerHTML = '';
    if (p && p.rows.length) p.rows.forEach(r => addMemberRow(deepClone(r)));
    if (!tbody.children.length) addMemberRow();
    setNyHeaders(p ? p.nyMonths : []);
    recalcMemberGrid();
    setEditorMode(!!isNew);   // 신규는 편집, 기존 선택은 읽기전용(보기) 모드
    renderChips();
    refreshOverview();
    inlineEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
// 보기 모드 ↔ 편집 모드 전환 (편집 모드에서만 입력/버튼 활성)
function setEditorMode(editing) {
    state.editing = editing;
    inlineEditor.querySelectorAll('input, textarea, select').forEach(el => { el.disabled = !editing; });
    inlineEditor.classList.toggle('view-mode', !editing);
    const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
    show('enterEditBtn', !editing && !state.isNew);
    show('saveProjectBtn', editing);
    show('cancelEditBtn', editing);
    show('addMemberBtn', editing);
    show('addReserveBtn', editing);
    show('pasteBtn', editing);
    show('deleteProjectBtn', editing && !state.isNew);
}
function cancelEdit() {
    if (state.isNew) { state.editKey = null; state.isNew = false; state.dirty = false; renderAll(); }
    else openEditor(state.editKey, false);
}
async function saveProject() {
    const name = document.getElementById('projName').value.trim();
    if (!name) { showAlert('과제명을 입력하세요.', 'warning'); return; }
    const proj = collectEditor(); proj.name = name;
    state.projects[state.editKey] = normalizeProject(proj);
    try {
        await saveAll();
        state.isNew = false; state.dirty = false;
        showAlert('저장되었습니다.', 'success');
        renderAll();
        if (state.editKey && state.projects[state.editKey]) setEditorMode(false);   // 저장 후 보기 모드로
    } catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}
async function deleteProject() {
    if (state.isNew) { state.editKey = null; state.isNew = false; state.dirty = false; renderAll(); return; }
    const p = state.projects[state.editKey]; if (!p) return;
    if (!confirm(`‘${p.name}’ 과제를 삭제할까요?`)) return;
    delete state.projects[state.editKey];
    state.editKey = null; state.isNew = false; state.dirty = false;
    try { await saveAll(); showAlert('삭제되었습니다.', 'success'); renderAll(); }
    catch (err) { showAlert('삭제 실패: ' + err.message, 'error'); }
}

function memberRowHTML(r) {
    r = r || { name: '', m: Array(12).fill(0), ext: 0, lump: 0, note: '' };
    const reserve = /여유|잔여/.test(r.name || '') || num(r.lump) > 0;
    if (reserve) {
        // 여유분: 월별 없이 금액 1칸 + 비고
        return `<tr class="mg-row mg-reserve">
            <td class="mg-name"><input type="text" class="mg-nameinput" value="${escHtmlSafe(r.name || '여유분')}" placeholder="여유분"></td>
            <td colspan="13" class="mg-lumpcell"><input type="number" step="any" class="mg-lump" value="${r.lump || ''}" placeholder="금액 (만원)"></td>
            <td class="mg-sum">0</td>
            <td class="mg-note"><textarea class="mg-noteinput" rows="1" placeholder="비고 (사유)">${escHtmlSafe(r.note)}</textarea></td>
            <td><button type="button" class="mg-del" title="행 삭제"><i class="fas fa-xmark"></i></button></td>
        </tr>`;
    }
    const monthInputs = Array.from({ length: 12 }, (_, i) =>
        `<td><input type="number" step="any" class="mg-m" data-mi="${i}" value="${r.m[i] || ''}"></td>`).join('');
    return `<tr class="mg-row">
        <td class="mg-name"><input type="text" class="mg-nameinput" list="knownMembers" value="${escHtmlSafe(r.name)}" placeholder="이름"></td>
        ${monthInputs}
        <td class="mg-ext"><input type="number" step="any" class="mg-extinput" value="${r.ext || ''}"></td>
        <td class="mg-sum">0</td>
        <td class="mg-note"><textarea class="mg-noteinput" rows="1" placeholder="비고">${escHtmlSafe(r.note)}</textarea></td>
        <td><button type="button" class="mg-del" title="행 삭제"><i class="fas fa-xmark"></i></button></td>
    </tr>`;
}
function recalcMemberGrid() {
    const nySet = new Set(collectNyMonths());
    const foot = Array(12).fill(0); let extSum = 0, grand = 0, nySum = 0;
    document.querySelectorAll('#memberRows .mg-row').forEach(tr => {
        let rowSum = 0;
        const lumpInp = tr.querySelector('.mg-lump');
        if (lumpInp) { rowSum = num(lumpInp.value); }   // 여유분: 월별 합산 없음
        else {
            tr.querySelectorAll('.mg-m').forEach(inp => {
                const v = num(inp.value), mi = Number(inp.dataset.mi);
                rowSum += v; foot[mi] += v;
                if (nySet.has(mi)) nySum += v;
                if (inp.parentElement) inp.parentElement.classList.toggle('ny-cell', nySet.has(mi));   // 내년 칸 음영
            });
            const ext = tr.querySelector('.mg-extinput'); if (ext) { const ev = num(ext.value); extSum += ev; rowSum += ev; }   // 외부도 개인 합계에 포함
        }
        tr.querySelector('.mg-sum').textContent = fmt(rowSum);
        grand += rowSum;
    });
    const footRow = document.getElementById('memberFootRow');
    footRow.innerHTML = `<td class="mg-name">월별 합계</td>${foot.map((v, i) => `<td class="${nySet.has(i) ? 'ny-cell' : ''}">${v ? fmt(v) : ''}</td>`).join('')}`
        + `<td class="mg-ext">${extSum ? fmt(extSum) : ''}</td><td class="mg-sum"><b>${fmt(grand)}</b></td><td></td><td></td>`;
    const note = document.getElementById('mgNyNote');
    if (note) note.textContent = nySum ? `내년(차기연도) ${fmt(nySum)}만원 포함 — 올해 탭 총합에는 ${fmt(grand - nySum)}만원만 반영(과제 세부 인건비는 전체 ${fmt(grand)}만원).` : '';
}
function wireMemberRow(tr) {
    tr.querySelectorAll('input, textarea').forEach(inp => inp.addEventListener('input', onEditorInput));
    tr.querySelector('.mg-del').addEventListener('click', () => { tr.remove(); onEditorInput(); });
    const note = tr.querySelector('.mg-noteinput');
    if (note && note.tagName === 'TEXTAREA') {
        const grow = () => { note.style.height = 'auto'; note.style.height = (note.scrollHeight + 2) + 'px'; };
        note.addEventListener('input', grow); setTimeout(grow, 0);
    }
    const nm = tr.querySelector('.mg-nameinput');
    if (nm) nm.addEventListener('input', () => {
        const wantReserve = /여유|잔여/.test(nm.value);
        const isReserve = !!tr.querySelector('.mg-lump');
        if (wantReserve === isReserve) return;   // 레이아웃 전환 필요 없음
        const note = (tr.querySelector('.mg-noteinput') || {}).value || '';
        const cur = { name: nm.value, note, lump: 0, m: Array(12).fill(0), ext: 0 };
        const tmp = document.createElement('tbody'); tmp.innerHTML = memberRowHTML(cur);
        const nr = tmp.firstElementChild; tr.replaceWith(nr); wireMemberRow(nr); onEditorInput();
        const ni = nr.querySelector('.mg-nameinput'); ni.focus(); ni.setSelectionRange(ni.value.length, ni.value.length);
    });
}
// 엑셀/CSV 붙여넣기 → 행 일괄 추가
function openPasteModal() {
    const t = document.getElementById('pasteText'); if (t) t.value = '';
    openModal('pasteModal');
}
function applyPaste() {
    const txt = document.getElementById('pasteText').value || '';
    const lines = txt.split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) { showAlert('붙여넣을 내용이 없습니다.', 'warning'); return; }
    let added = 0;
    lines.forEach(line => {
        let cells = (line.indexOf('\t') >= 0 ? line.split('\t') : line.split(',')).map(c => c.trim());
        const name = cells[0]; if (!name) return;
        const nums = cells.slice(1).map(c => num(c));
        if (/여유|잔여/.test(name)) {
            addMemberRow({ name, m: Array(12).fill(0), ext: 0, lump: nums.reduce((a, b) => a + b, 0), note: '' });
        } else {
            const m = Array.from({ length: 12 }, (_, i) => num(nums[i] || 0));
            addMemberRow({ name, m, ext: num(nums[12] || 0), lump: 0, note: '' });
        }
        added++;
    });
    // 이름 없는 빈 기본행 제거
    document.querySelectorAll('#memberRows .mg-row').forEach(tr => {
        const nm = tr.querySelector('.mg-nameinput'); if (nm && !nm.value.trim()) tr.remove();
    });
    onEditorInput();
    closeModal('pasteModal');
    showAlert(added + '행을 붙여넣었습니다.', 'success');
}
function addMemberRow(r) {
    const tbody = document.getElementById('memberRows');
    const tmp = document.createElement('tbody');
    tmp.innerHTML = memberRowHTML(r);
    const tr = tmp.firstElementChild;
    tbody.appendChild(tr);
    wireMemberRow(tr);
    return tr;
}

// ==================== 기준(100%) 편집 ====================
function openCapsForm() {
    const members = memberOrderResolved();
    document.getElementById('capsFields').innerHTML = members.map(n => `
        <div class="cap-row">
            <span class="cap-name">${escHtmlSafe(n)}</span>
            <input type="number" step="any" data-name="${escHtmlSafe(n)}" value="${state.caps[n] != null ? state.caps[n] : ''}" placeholder="연간 기준(만원)">
        </div>`).join('') || '<p class="target-hint">학생이 없습니다.</p>';
    openModal('capsFormModal');
}
async function saveCaps(e) {
    e.preventDefault();
    const caps = {};
    document.querySelectorAll('#capsFields input').forEach(inp => {
        const v = inp.value.trim();
        if (v !== '') caps[inp.dataset.name] = num(v);
    });
    state.caps = caps;
    try {
        await saveAll();
        closeModal('capsFormModal');
        showAlert('기준이 저장되었습니다.', 'success');
        renderAll();
    } catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    loginBtn = document.getElementById('loginBtn');
    logoutBtn = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal');
    loginClose = document.getElementById('loginClose');
    loginForm = document.getElementById('loginForm');
    userInfo = document.getElementById('userInfo');
    userName = document.getElementById('userName');
    authGate = document.getElementById('authGate');
    payApp = document.getElementById('payApp');
    yearSelect = document.getElementById('yearSelect');
    blkAll = document.getElementById('blkAll');
    blkRnd = document.getElementById('blkRnd');
    blkSvc = document.getElementById('blkSvc');
    sumAll = document.getElementById('sumAll');
    sumRnd = document.getElementById('sumRnd');
    sumSvc = document.getElementById('sumSvc');
    projChips = document.getElementById('projChips');
    inlineEditor = document.getElementById('inlineEditor');
    dirtyBadge = document.getElementById('dirtyBadge');
    seedBanner = document.getElementById('seedBanner');

    yearSelect.innerHTML = YEAR_OPTIONS.map(y => `<option value="${y}"${y === DEFAULT_YEAR ? ' selected' : ''}>${y}년</option>`).join('');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
    } catch (err) { console.error('Firebase 초기화 실패', err); return; }

    auth.onAuthStateChanged(async (user) => {
        if (user && ALLOWED_USERS.includes(user.uid)) currentUser = user;
        else { currentUser = null; if (user && [ADMIN_UID, ROOT_UID].indexOf(user.uid) < 0) await auth.signOut(); }   // 외부 계정만 로그아웃, 일반 관리자는 세션 유지
        updateAuthUI();
        if (currentUser) {
            try { await loadYear(Number(yearSelect.value)); renderAll(); }
            catch (e) { console.error(e); showAlert('데이터 로드 실패', 'error'); }
        }
    });

    // 로그인 모달
    loginBtn && loginBtn.addEventListener('click', () => openModal('loginModal'));
    const gateBtn = authGate && authGate.querySelector('#gateLoginBtn');
    gateBtn && gateBtn.addEventListener('click', () => openModal('loginModal'));
    loginClose && loginClose.addEventListener('click', () => closeModal('loginModal'));
    loginModal && loginModal.addEventListener('click', e => { if (e.target === loginModal) closeModal('loginModal'); });
    logoutBtn && logoutBtn.addEventListener('click', async () => { await auth.signOut(); showAlert('로그아웃되었습니다.', 'success'); });
    loginForm && loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await loginUser(document.getElementById('email').value.trim(), document.getElementById('password').value);
            closeModal('loginModal'); loginForm.reset(); showAlert('로그인되었습니다.', 'success');
        } catch (err) { showAlert(err.message || '로그인 실패', 'error'); }
    });

    // 연도 변경
    yearSelect.addEventListener('change', async () => {
        if (!confirmDiscard()) { yearSelect.value = state.year; return; }
        state.editKey = null; state.isNew = false; state.dirty = false;
        try { await loadYear(Number(yearSelect.value)); renderAll(); }
        catch (e) { showAlert('데이터 로드 실패', 'error'); }
    });

    // 툴바 버튼
    document.getElementById('addProjectBtn').addEventListener('click', newProject);
    document.getElementById('editCapsBtn').addEventListener('click', openCapsForm);

    // 분기/월별 토글
    document.getElementById('toggleMonths').addEventListener('click', () => {
        state.monthsExpanded = !state.monthsExpanded;
        const btn = document.getElementById('toggleMonths');
        btn.innerHTML = state.monthsExpanded
            ? '<i class="fas fa-down-left-and-up-right-to-center"></i> 분기로 접기'
            : '<i class="fas fa-up-right-and-down-left-from-center"></i> 월별 펼치기';
        refreshOverview();
    });

    // 시드 배너
    document.getElementById('seedSaveBtn').addEventListener('click', async () => {
        try { await saveAll(); showAlert('초기 데이터를 저장했습니다.', 'success'); renderAll(); }
        catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
    });
    document.getElementById('seedDismissBtn').addEventListener('click', () => {
        state.projects = {}; state.caps = {}; state.memberOrder = []; state.isSeed = false;
        state.editKey = null; state.isNew = false; state.dirty = false; renderAll();
    });

    // 인라인 편집기
    document.querySelectorAll('.member-grid th.mg-mhead').forEach(th => th.addEventListener('click', () => toggleNyHeader(th)));
    document.getElementById('addMemberBtn').addEventListener('click', () => { addMemberRow(); onEditorInput(); });
    document.getElementById('addReserveBtn').addEventListener('click', () => { const tr = addMemberRow({ name: '여유분', m: Array(12).fill(0), ext: 0, note: '' }); onEditorInput(); const n = tr.querySelector('.mg-noteinput'); if (n) n.focus(); });
    document.getElementById('saveProjectBtn').addEventListener('click', saveProject);
    document.getElementById('deleteProjectBtn').addEventListener('click', deleteProject);
    document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
    document.getElementById('enterEditBtn').addEventListener('click', () => setEditorMode(true));
    document.getElementById('pasteBtn').addEventListener('click', openPasteModal);
    document.getElementById('applyPasteBtn').addEventListener('click', applyPaste);
    document.getElementById('capsForm').addEventListener('submit', saveCaps);

    // 공통 모달 닫기
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    document.querySelectorAll('.perf-modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));
});
