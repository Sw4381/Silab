// payroll.js - 학생 인건비 관리 (로그인 전용)
// 설정값은 config.js 참조 (firebaseConfig, ALLOWED_EMAIL)
// DB 경로: payroll/{year}/{projects, caps, memberOrder, meta}
// 금액 단위: 만원

// ==================== 상수 ====================
const ALLOWED_USERS = [ALLOWED_EMAIL];
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
    monthsExpanded: false, // 학생 현황표: false=분기 요약, true=12개월 펼침
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
let authGate, payApp, yearSelect, summaryCards, studentMatrix, seedBanner;
let projChips, inlineEditor, dirtyBadge;
let dashStudents, dashProjects, alertWrap;

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
        note: String(r.note || '')
    }));
    return {
        name: String(p.name || '(이름없음)'),
        category: CATEGORIES.includes(p.category) ? p.category : '국가R&D',
        status: STATUSES.includes(p.status) ? p.status : '확정',
        note: String(p.note || ''),
        order: num(p.order),
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
    order.forEach(n => map[n] = { name: n, m: Array(12).fill(0), ext: 0, total: 0 });
    Object.values(projects).forEach(p => (p.rows || []).forEach(r => {
        const t = map[r.name]; if (!t) return;
        for (let i = 0; i < 12; i++) t.m[i] += num(r.m[i]);
        t.ext += num(r.ext);
    }));
    return order.map(n => {
        const s = map[n]; s.total = s.m.reduce((a, b) => a + b, 0);
        s.cap = num(state.caps[n]); s.ratio = s.cap ? s.total / s.cap : 0;
        return s;
    });
}
function projectMonthlyTotals(p) {
    const m = Array(12).fill(0);
    (p.rows || []).forEach(r => { for (let i = 0; i < 12; i++) m[i] += num(r.m[i]); });
    return m;
}
function projectTotal(p) { return projectMonthlyTotals(p).reduce((a, b) => a + b, 0); }
function projectHeadcount(p) { return (p.rows || []).filter(r => r.m.some(x => num(x) > 0) || num(r.ext) > 0).length; }
function ratioClass(r) { return r > 1.0001 ? 'over' : (r >= 0.9 ? 'high' : (r > 0 ? 'ok' : 'zero')); }

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

// 위쪽 요약 + 대시보드 + 학생표만 다시 그림 (편집 입력 중 호출 — 에디터 DOM은 건드리지 않아 포커스 유지)
function refreshOverview() {
    const live = liveProjects();
    renderSummary(live);
    renderDashboard(live);
    renderStudents(live);
    if (dirtyBadge) dirtyBadge.style.display = state.dirty ? 'inline-flex' : 'none';
}

function renderSummary(live) {
    const studs = studentTotals(live);
    const activeStuds = studs.filter(s => s.total > 0);
    const projCount = Object.keys(state.projects).length;
    const grand = studs.reduce((a, s) => a + s.total, 0);
    const now = new Date();
    const mi = (now.getFullYear() === state.year) ? now.getMonth() : 0;   // 0-based
    const monthTotal = studs.reduce((a, s) => a + s.m[mi], 0);
    const over = studs.filter(s => s.ratio > 1.0001).length;
    const cards = [
        { ic: 'fa-user-group', label: '참여 학생', val: activeStuds.length + '명', sub: '전체 ' + studs.length + '명' },
        { ic: 'fa-folder-open', label: '과제 수', val: projCount + '개', sub: state.year + '년' },
        { ic: 'fa-won-sign', label: '연간 총 지급액', val: fmt(grand), sub: '만원' },
        { ic: 'fa-calendar-day', label: MONTHS[mi] + ' 지급액', val: fmt(monthTotal), sub: '만원' },
        { ic: 'fa-triangle-exclamation', label: '기준 초과', val: over + '명', sub: '비율 100% 초과', warn: over > 0 }
    ];
    summaryCards.innerHTML = cards.map(c => `
        <div class="summary-card${c.warn ? ' warn' : ''}">
            <div class="sc-icon"><i class="fas ${c.ic}"></i></div>
            <div class="sc-body">
                <div class="sc-label">${c.label}</div>
                <div class="sc-value">${escHtmlSafe(c.val)}</div>
                <div class="sc-sub">${escHtmlSafe(c.sub)}</div>
            </div>
        </div>`).join('');
}

function renderStudents(live) {
    const studs = studentTotals(live);
    if (!studs.length) { studentMatrix.innerHTML = '<div class="pay-empty">등록된 인건비가 없습니다. 아래 ‘새 과제’로 시작하세요.</div>'; return; }
    // 편집 중이면 저장본(baseline)과 비교해 바뀐 셀 강조
    const baseMap = state.editKey ? studentTotals(state.projects).reduce((m, s) => (m[s.name] = s, m), {}) : null;
    const eq = (a, b) => Math.abs(num(a) - num(b)) < 0.005;
    const groups = monthGroups();
    const compact = state.monthsExpanded ? '' : ' compact';

    const colTotals = groups.map(() => 0); let extTotal = 0, grand = 0;
    studs.forEach(s => { groups.forEach((g, gi) => colTotals[gi] += sumIdx(s.m, g.idxs)); extTotal += s.ext; grand += s.total; });

    const head = `<tr>
        <th class="sticky-l">이름</th>
        ${groups.map(g => `<th>${g.label}</th>`).join('')}
        <th class="col-ext">외부</th>
        <th class="col-total">총합</th>
        <th class="col-cap">기준</th>
        <th class="col-ratio">비율</th>
    </tr>`;

    const body = studs.map((s, si) => {
        const base = baseMap ? baseMap[s.name] : null;
        const totalChg = baseMap && (!base || !eq(s.total, base.total)) ? ' chg' : '';
        const cells = groups.map(g => {
            const v = sumIdx(s.m, g.idxs);
            const bv = base ? sumIdx(base.m, g.idxs) : 0;
            const chg = baseMap && !eq(v, bv) ? ' chg' : '';
            return `<td class="${v ? '' : 'z'}${chg}">${v ? fmt(v) : ''}</td>`;
        }).join('');
        return `
        <tr class="${si % 2 ? 's-alt' : ''}">
            <td class="sticky-l name">${escHtmlSafe(s.name)}</td>
            ${cells}
            <td class="col-ext">${s.ext ? fmt(s.ext) : ''}</td>
            <td class="col-total${totalChg}"><b>${fmt(s.total)}</b></td>
            <td class="col-cap">${s.cap ? fmt(s.cap) : '-'}</td>
            <td class="col-ratio">
                ${s.cap ? `<div class="ratio-cell ${ratioClass(s.ratio)}${totalChg}">
                    <div class="ratio-bar"><span style="width:${Math.min(100, s.ratio * 100).toFixed(0)}%"></span></div>
                    <span class="ratio-num">${(s.ratio * 100).toFixed(1)}%</span>
                </div>` : '<span class="z">-</span>'}
            </td>
        </tr>`; }).join('');

    const foot = `<tr class="foot">
        <td class="sticky-l">합계</td>
        ${colTotals.map(v => `<td>${v ? fmt(v) : ''}</td>`).join('')}
        <td class="col-ext">${extTotal ? fmt(extTotal) : ''}</td>
        <td class="col-total"><b>${fmt(grand)}</b></td>
        <td class="col-cap"></td><td class="col-ratio"></td>
    </tr>`;

    studentMatrix.innerHTML = `<table class="student-table${compact}"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

// ==================== 시각 대시보드 ====================
function renderDashboard(live) {
    const colors = projectColorMap(live);
    const keys = Object.keys(live).sort((a, b) => (live[a].order || 0) - (live[b].order || 0));
    const studs = studentTotals(live);
    const sumRow = m => m.reduce((a, b) => a + num(b), 0);

    // 학생 → {과제키: 연간합}
    const spp = {}; studs.forEach(s => spp[s.name] = {});
    keys.forEach(k => (live[k].rows || []).forEach(r => {
        if (!spp[r.name]) spp[r.name] = {};
        spp[r.name][k] = (spp[r.name][k] || 0) + sumRow(r.m);
    }));

    // --- 점검 필요: 참여율 한도 초과(>100%) / 임박(>=90%) ---
    if (alertWrap) {
        const flagged = studs.filter(s => s.cap && s.ratio >= 0.9).sort((a, b) => b.ratio - a.ratio);
        if (!flagged.length) {
            alertWrap.innerHTML = `<div class="alert-ok"><i class="fas fa-circle-check"></i> 참여율 한도 초과·임박 학생이 없습니다.</div>`;
        } else {
            const chips = flagged.map(s => {
                const over = s.ratio > 1.0001;
                return `<span class="alert-chip ${over ? 'over' : 'high'}"><b>${escHtmlSafe(s.name)}</b> ${Math.round(s.ratio * 100)}% <em>${over ? '한도 초과' : '한도 임박'}</em></span>`;
            }).join('');
            alertWrap.innerHTML = `<div class="alert-title"><i class="fas fa-triangle-exclamation"></i> 점검 필요 · 참여율(계상률) 한도</div><div class="alert-chips">${chips}</div>`;
        }
    }

    // --- 학생별 참여율 · 총 수령액 (총 수령액 높은 순) ---
    const ordered = studs.slice().sort((a, b) => (b.total - a.total) || ((b.ratio || 0) - (a.ratio || 0)));
    const gmax = Math.max(1, ...studs.map(s => Math.max(s.total, s.cap || 0)));
    dashStudents.innerHTML = ordered.map(s => {
        const segs = keys.filter(k => (spp[s.name][k] || 0) > 0).map(k =>
            `<span class="st-seg" style="width:${(spp[s.name][k] / gmax * 100).toFixed(2)}%;background:${colors[k]}" title="${escHtmlSafe(live[k].name)} · ${fmt(spp[s.name][k])}만원"></span>`).join('');
        const capPct = s.cap ? Math.min(100, s.cap / gmax * 100) : null;
        const over = s.cap && s.total > s.cap * 1.0001;
        return `<div class="st-row">
            <div class="st-name">${escHtmlSafe(s.name)}</div>
            <div class="st-track">
                <div class="st-bar">${segs}</div>
                ${capPct !== null ? `<span class="st-cap" style="left:${capPct.toFixed(2)}%"></span>` : ''}
            </div>
            <div class="st-amt">${fmt(s.total)}<small>만원</small></div>
            <div class="st-pct ${ratioClass(s.ratio)}">${s.cap ? Math.round(s.ratio * 100) + '%' : '–'}${over ? ' <i class="fas fa-triangle-exclamation"></i>' : ''}</div>
        </div>`;
    }).join('') || '<div class="pay-empty" style="padding:18px">학생 없음</div>';

    // --- 3) 과제별 예산 (색 = 재원, 클릭 시 편집) ---
    const pmax = Math.max(1, ...keys.map(k => projectTotal(live[k])));
    dashProjects.innerHTML = keys.map(k => {
        const p = live[k]; const t = projectTotal(p);
        return `<div class="dp-row${k === state.editKey ? ' active' : ''}" data-key="${escHtmlSafe(k)}" title="클릭하여 편집">
            <span class="dp-dot" style="background:${colors[k]}"></span>
            <span class="dp-name">${escHtmlSafe(p.name)}</span>
            <span class="dp-bar"><span style="width:${(t / pmax * 100).toFixed(1)}%;background:${colors[k]}"></span></span>
            <span class="dp-val">${fmt(t)}</span>
        </div>`;
    }).join('') || '<div class="pay-empty" style="padding:18px">과제 없음 — 아래에서 추가하세요</div>';
    dashProjects.querySelectorAll('.dp-row').forEach(el => el.addEventListener('click', () => selectProject(el.dataset.key)));
}

// ==================== 과제 칩 ====================
function renderChips() {
    const keys = Object.keys(state.projects).sort((a, b) => (state.projects[a].order || 0) - (state.projects[b].order || 0));
    const catDot = p => p.category === '국가R&D' ? 'cat-nat' : (p.category === '비R&D' ? 'cat-non' : 'cat-etc');
    let html = keys.map(k => {
        const p = state.projects[k];
        return `<button type="button" class="chip${k === state.editKey ? ' active' : ''}" data-key="${escHtmlSafe(k)}">
            <span class="chip-dot ${catDot(p)}"></span>
            <span class="chip-name">${escHtmlSafe(p.name)}</span>
            <span class="chip-sum">${fmt(projectTotal(p))}</span>
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
function collectEditor() {
    const rows = [];
    document.querySelectorAll('#memberRows .mg-row').forEach(tr => {
        const nm = tr.querySelector('.mg-nameinput').value.trim();
        if (!nm) return;
        const m = Array.from(tr.querySelectorAll('.mg-m')).map(inp => num(inp.value));
        rows.push({ name: nm, m, ext: num(tr.querySelector('.mg-extinput').value), note: tr.querySelector('.mg-noteinput').value.trim() });
    });
    const existing = state.projects[state.editKey];
    return {
        name: (document.getElementById('projName').value.trim()) || '(새 과제)',
        category: document.getElementById('projCategory').value,
        status: document.getElementById('projStatus').value,
        note: document.getElementById('projNote').value.trim(),
        order: existing ? existing.order : Object.keys(state.projects).length,
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
    recalcMemberGrid();
    renderChips();
    refreshOverview();
    inlineEditor.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    r = r || { name: '', m: Array(12).fill(0), ext: 0, note: '' };
    const monthInputs = Array.from({ length: 12 }, (_, i) =>
        `<td><input type="number" step="any" class="mg-m" data-mi="${i}" value="${r.m[i] || ''}"></td>`).join('');
    return `<tr class="mg-row">
        <td class="mg-name"><input type="text" class="mg-nameinput" list="knownMembers" value="${escHtmlSafe(r.name)}" placeholder="이름"></td>
        ${monthInputs}
        <td class="mg-ext"><input type="number" step="any" class="mg-extinput" value="${r.ext || ''}"></td>
        <td class="mg-sum">0</td>
        <td class="mg-note"><input type="text" class="mg-noteinput" value="${escHtmlSafe(r.note)}" placeholder="비고"></td>
        <td><button type="button" class="mg-del" title="행 삭제"><i class="fas fa-xmark"></i></button></td>
    </tr>`;
}
function recalcMemberGrid() {
    const foot = Array(12).fill(0); let extSum = 0, grand = 0;
    document.querySelectorAll('#memberRows .mg-row').forEach(tr => {
        let rowSum = 0;
        tr.querySelectorAll('.mg-m').forEach(inp => { const v = num(inp.value); rowSum += v; foot[Number(inp.dataset.mi)] += v; });
        extSum += num(tr.querySelector('.mg-extinput').value);
        tr.querySelector('.mg-sum').textContent = fmt(rowSum);
        grand += rowSum;
    });
    const footRow = document.getElementById('memberFootRow');
    footRow.innerHTML = `<td class="mg-name">월별 합계</td>${foot.map(v => `<td>${v ? fmt(v) : ''}</td>`).join('')}`
        + `<td class="mg-ext">${extSum ? fmt(extSum) : ''}</td><td class="mg-sum"><b>${fmt(grand)}</b></td><td></td><td></td>`;
}
function wireMemberRow(tr) {
    tr.querySelectorAll('input').forEach(inp => inp.addEventListener('input', onEditorInput));
    tr.querySelector('.mg-del').addEventListener('click', () => { tr.remove(); onEditorInput(); });
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
    summaryCards = document.getElementById('summaryCards');
    dashStudents = document.getElementById('dashStudents');
    dashProjects = document.getElementById('dashProjects');
    alertWrap = document.getElementById('alertWrap');
    studentMatrix = document.getElementById('studentMatrix');
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
        if (user && ALLOWED_USERS.includes(user.email)) currentUser = user;
        else { currentUser = null; if (user) await auth.signOut(); }
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
    document.getElementById('addMemberBtn').addEventListener('click', () => { addMemberRow(); onEditorInput(); });
    document.getElementById('saveProjectBtn').addEventListener('click', saveProject);
    document.getElementById('deleteProjectBtn').addEventListener('click', deleteProject);
    document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);
    document.getElementById('capsForm').addEventListener('submit', saveCaps);

    // 공통 모달 닫기
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    document.querySelectorAll('.perf-modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));
});
