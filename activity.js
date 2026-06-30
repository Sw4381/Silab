// activity.js - 연구활동비 집행 현황 (로그인 전용) · 예산 3번째 탭
// 설정값은 config.js 참조 (firebaseConfig, ADMIN_UID, ROOT_UID)
// DB 경로: activity/{year} = { projects:{key:{name,manager,updated,note,order,items:[{name,budget,spent,planned,note}]}}, summaryNote, rollupNotes }
// 금액 단위: 원 · 잔액 = 예산-집행 (집행예정 미포함) · 소진율 = 집행/예산

const ALLOWED_USERS = [ADMIN_UID, ROOT_UID];
const DEFAULT_YEAR = 2026;
const YEAR_NUMS = [2025, 2026, 2027, 2028, 2029];
// 세목 표준 순서 (전체 합계 정렬용)
const SEMOK_ORDER = ['논문 게재료', '학회등록비', '야근식대', '회의비', '여비 - 국내', '여비 - 국외', '소프트웨어', '사무용품', '기자재', '여유분(+API)'];

const SEED_ACTIVITY = {};   // 공개 저장소 보호: 실데이터는 Firebase에만 (가져오기로 입력)

let auth, database, currentUser = null;
const state = { year: DEFAULT_YEAR, data: { projects: {}, summaryNote: '', rollupNotes: {} }, isRoot: false, editKey: null };
let loginBtn, logoutBtn, loginModal, loginClose, loginForm, userInfo, userName, authGate, actApp, yearSelect;

// ==================== 유틸 ====================
function esc(s) { return (typeof escHtml === 'function') ? escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function num(v) { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : 0; }
function won(n) { return Math.round(num(n)).toLocaleString('ko-KR'); }
function pct(a, b) { return b ? a / b : 0; }
function rateCls(r) { return r >= 0.9 ? 'over' : (r >= 0.7 ? 'high' : (r > 0 ? 'ok' : 'zero')); }
function showAlert(msg, type) { const el = document.createElement('div'); el.className = `perf-alert ${type || 'info'}`; el.textContent = msg; document.body.appendChild(el); setTimeout(() => el.remove(), 3000); }
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function uid() { return 'a' + Math.abs(((performance.now() * 1000) | 0)).toString(36) + (state._seq = (state._seq || 0) + 1).toString(36); }
function sortedKeys() { const P = state.data.projects; return Object.keys(P).sort((a, b) => (P[a].order || 0) - (P[b].order || 0)); }

function normItem(it) { return { name: String(it.name || ''), budget: num(it.budget), spent: num(it.spent), planned: num(it.planned), note: String(it.note || '') }; }
function normProject(p) {
    let items = p.items; if (items && !Array.isArray(items)) items = Object.keys(items).map(k => items[k]);
    items = (items || []).filter(Boolean).map(normItem);
    return { name: String(p.name || '(이름없음)'), manager: String(p.manager || ''), updated: String(p.updated || ''), note: String(p.note || ''), order: num(p.order), items };
}
function normData(d) {
    d = d || {};
    const projects = {}; const pr = d.projects || {};
    Object.keys(pr).forEach(k => projects[k] = normProject(pr[k]));
    return { projects, summaryNote: String(d.summaryNote || ''), rollupNotes: d.rollupNotes || {} };
}

// 집계
function projTotals(p) { const t = { budget: 0, spent: 0, planned: 0 }; (p.items || []).forEach(it => { t.budget += num(it.budget); t.spent += num(it.spent); t.planned += num(it.planned); }); t.remain = t.budget - t.spent; t.rate = pct(t.spent, t.budget); return t; }

// ==================== 인증 ====================
async function loginUser(email, password) {
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
    if (actApp) actApp.style.display = a ? 'block' : 'none';
    const ptab = document.getElementById('budPayrollTab');
    if (ptab) ptab.style.display = (a && state.isRoot) ? '' : 'none';
}

// ==================== 로드/저장 ====================
async function loadData() {
    const snap = await database.ref('activity/' + state.year).once('value');
    const d = snap.val();
    if (d && d.projects) state.data = normData(d);
    else if (SEED_ACTIVITY[String(state.year)]) state.data = normData(SEED_ACTIVITY[String(state.year)]);
    else state.data = { projects: {}, summaryNote: '', rollupNotes: {} };
}
async function saveAll() {
    await database.ref('activity/' + state.year).set({
        projects: state.data.projects, summaryNote: state.data.summaryNote, rollupNotes: state.data.rollupNotes,
        meta: { updatedAt: new Date().toISOString(), updatedBy: currentUser ? currentUser.email : '' }
    });
}

// ==================== 렌더 ====================
function renderAll() {
    document.getElementById('addActProjectBtn').style.display = '';
    renderRollup();
    renderProjects();
    renderSummary();
}

function rateBar(rate) { const w = Math.min(100, Math.max(0, rate * 100)); return `<div class="exec-bar sm rb-${rateCls(rate)}"><span style="width:${w.toFixed(1)}%"></span></div>`; }

// 세목 순서: 표준 순서 우선, 그 외는 등장 순으로 뒤에
function semokOrder(names) {
    const out = SEMOK_ORDER.filter(s => names.indexOf(s) >= 0);
    names.forEach(n => { if (out.indexOf(n) < 0) out.push(n); });
    return out;
}

function renderRollup() {
    const wrap = document.getElementById('rollupWrap');
    const keys = sortedKeys();
    if (!keys.length) { wrap.innerHTML = '<div class="muted" style="padding:18px">데이터가 없습니다. 우측 상단 ‘가져오기’ 또는 ‘과제 추가’로 시작하세요.</div>'; return; }
    // 세목별 합산
    const agg = {}; const names = [];
    keys.forEach(k => state.data.projects[k].items.forEach(it => {
        if (!agg[it.name]) { agg[it.name] = { budget: 0, spent: 0, planned: 0 }; names.push(it.name); }
        agg[it.name].budget += num(it.budget); agg[it.name].spent += num(it.spent); agg[it.name].planned += num(it.planned);
    }));
    const order = semokOrder(names);
    let tB = 0, tS = 0, tP = 0;
    const rows = order.map(nm => {
        const a = agg[nm]; const remain = a.budget - a.spent, rate = pct(a.spent, a.budget);
        tB += a.budget; tS += a.spent; tP += a.planned;
        const note = (state.data.rollupNotes || {})[nm] || '';
        return `<tr>
            <td class="ac-name">${esc(nm)}</td>
            <td class="ac-num">${won(a.budget)}</td>
            <td class="ac-num">${a.spent ? won(a.spent) : '<span class="muted">-</span>'}</td>
            <td class="ac-num ac-plan">${a.planned ? won(a.planned) : '<span class="muted">-</span>'}</td>
            <td class="ac-num">${won(remain)}</td>
            <td class="ac-rate">${rateBar(rate)}<span class="rb-num">${Math.round(rate * 100)}%</span></td>
            <td class="ac-note">${esc(note)}</td>
        </tr>`;
    }).join('');
    const tRemain = tB - tS, tRate = pct(tS, tB);
    const foot = `<tr class="foot">
        <td class="ac-name">합계</td>
        <td class="ac-num"><b>${won(tB)}</b></td>
        <td class="ac-num"><b>${won(tS)}</b></td>
        <td class="ac-num ac-plan"><b>${won(tP)}</b></td>
        <td class="ac-num"><b>${won(tRemain)}</b></td>
        <td class="ac-rate">${rateBar(tRate)}<span class="rb-num">${Math.round(tRate * 100)}%</span></td>
        <td class="ac-note"></td>
    </tr>`;
    wrap.innerHTML = `<div class="matrix-wrap"><table class="ac-table"><thead><tr>
        <th class="ac-name">세목</th><th class="ac-num">예산액</th><th class="ac-num">집행액</th><th class="ac-num ac-plan">집행예정액</th><th class="ac-num">잔액</th><th class="ac-rate">소진율</th><th class="ac-note">집행 계획 / 비고</th>
        </tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

function renderProjects() {
    const wrap = document.getElementById('projectsWrap');
    const keys = sortedKeys();
    if (!keys.length) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = keys.map(k => {
        const p = state.data.projects[k]; const t = projTotals(p);
        const rows = (p.items || []).map(it => {
            const remain = num(it.budget) - num(it.spent), rate = pct(num(it.spent), num(it.budget));
            return `<tr>
                <td class="ac-name">${esc(it.name)}</td>
                <td class="ac-num">${won(it.budget)}</td>
                <td class="ac-num">${num(it.spent) ? won(it.spent) : '<span class="muted">-</span>'}</td>
                <td class="ac-num ac-plan">${num(it.planned) ? won(it.planned) : '<span class="muted">-</span>'}</td>
                <td class="ac-num">${won(remain)}</td>
                <td class="ac-rate">${rateBar(rate)}<span class="rb-num">${Math.round(rate * 100)}%</span></td>
                <td class="ac-note">${esc(it.note)}</td>
            </tr>`;
        }).join('');
        const foot = `<tr class="foot"><td class="ac-name">소계</td><td class="ac-num"><b>${won(t.budget)}</b></td><td class="ac-num"><b>${won(t.spent)}</b></td><td class="ac-num ac-plan"><b>${won(t.planned)}</b></td><td class="ac-num"><b>${won(t.remain)}</b></td><td class="ac-rate">${rateBar(t.rate)}<span class="rb-num">${Math.round(t.rate * 100)}%</span></td><td class="ac-note"></td></tr>`;
        return `<details class="ac-proj pay-collapse">
            <summary>
                <span class="cl-title"><b>${esc(p.name)}</b>${p.manager ? ` <span class="ac-mgr">· ${esc(p.manager)}</span>` : ''}${p.updated ? ` <span class="ac-updated">(${esc(p.updated)})</span>` : ''}
                    <span class="ac-sum-stat">예산 ${won(t.budget)} · 집행 <b>${won(t.spent)}</b> · 잔액 ${won(t.remain)} · 소진율 ${Math.round(t.rate * 100)}%</span>
                </span>
                <button class="tb-btn mini ac-edit" data-key="${esc(k)}"><i class="fas fa-pen"></i> 수정</button>
                <button class="tb-btn mini danger ac-del" data-key="${esc(k)}"><i class="fas fa-trash"></i> 삭제</button>
                <i class="fas fa-chevron-down cl-chevron"></i>
            </summary>
            <div class="matrix-wrap"><table class="ac-table"><thead><tr>
                <th class="ac-name">세목</th><th class="ac-num">예산액</th><th class="ac-num">집행액</th><th class="ac-num ac-plan">집행예정액</th><th class="ac-num">잔액</th><th class="ac-rate">소진율</th><th class="ac-note">집행 계획 / 비고</th>
            </tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
            ${p.note ? `<div class="ac-memo"><i class="fas fa-quote-left"></i> ${esc(p.note)}</div>` : ''}
        </details>`;
    }).join('');
    wrap.querySelectorAll('.ac-edit').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openProjectForm(b.dataset.key); }));
    wrap.querySelectorAll('.ac-del').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); removeProject(b.dataset.key); }));
}

function renderSummary() {
    const el = document.getElementById('summaryWrap');
    const note = state.data.summaryNote || '';
    el.innerHTML = `<div class="ac-summary-head"><h3><i class="fas fa-triangle-exclamation"></i> 총평 / 이슈</h3><button class="tb-btn mini" id="editSummaryBtn"><i class="fas fa-pen"></i> 수정</button></div>
        <div class="ac-summary-body">${note ? esc(note).replace(/\n/g, '<br>') : '<span class="muted">총평/이슈가 없습니다. ‘수정’으로 입력하세요.</span>'}</div>`;
    document.getElementById('editSummaryBtn').addEventListener('click', editSummary);
}

// ==================== 편집 ====================
function itemRowHTML(it) {
    it = it || { name: '', budget: '', spent: '', planned: '', note: '' };
    return `<div class="ai-row">
        <input class="ai-name" type="text" value="${esc(it.name)}" placeholder="세목">
        <input class="ai-budget js-money" type="text" inputmode="numeric" value="${silabMoneyFmt(it.budget)}" placeholder="예산">
        <input class="ai-spent js-money" type="text" inputmode="numeric" value="${silabMoneyFmt(it.spent)}" placeholder="집행">
        <input class="ai-planned js-money" type="text" inputmode="numeric" value="${silabMoneyFmt(it.planned)}" placeholder="집행예정">
        <input class="ai-note" type="text" value="${esc(it.note)}" placeholder="비고">
        <button type="button" class="ai-del" title="삭제"><i class="fas fa-xmark"></i></button>
    </div>`;
}
function addItemRow(it) {
    const wrap = document.getElementById('actItems');
    const tmp = document.createElement('div'); tmp.innerHTML = itemRowHTML(it);
    const row = tmp.firstElementChild; wrap.appendChild(row);
    row.querySelector('.ai-del').addEventListener('click', () => row.remove());
    return row;
}
function openProjectForm(key) {
    state.editKey = key;
    const p = key ? state.data.projects[key] : normProject({});
    const g = id => document.getElementById(id);
    g('actFormTitle').textContent = key ? '과제 수정' : '새 과제 추가';
    g('acName').value = key ? p.name : '';
    g('acManager').value = p.manager; g('acUpdated').value = p.updated; g('acNote').value = p.note;
    g('actItems').innerHTML = '';
    (p.items && p.items.length ? p.items : [null]).forEach(it => addItemRow(it));
    g('deleteActProjectBtn').style.display = key ? '' : 'none';
    openModal('actFormModal');
}
function collectProjectForm() {
    const g = id => document.getElementById(id);
    const items = [];
    document.querySelectorAll('#actItems .ai-row').forEach(r => {
        const name = r.querySelector('.ai-name').value.trim();
        if (!name) return;
        items.push({ name, budget: num(r.querySelector('.ai-budget').value), spent: num(r.querySelector('.ai-spent').value), planned: num(r.querySelector('.ai-planned').value), note: r.querySelector('.ai-note').value.trim() });
    });
    const ex = state.data.projects[state.editKey];
    return { name: g('acName').value.trim() || '(새 과제)', manager: g('acManager').value.trim(), updated: g('acUpdated').value.trim(), note: g('acNote').value.trim(), order: ex ? ex.order : Object.keys(state.data.projects).length, items };
}
async function saveProjectForm(e) {
    e.preventDefault();
    if (!document.getElementById('acName').value.trim()) { showAlert('과제명을 입력하세요.', 'warning'); return; }
    const key = state.editKey || uid();
    state.data.projects[key] = normProject(collectProjectForm());
    try { await saveAll(); closeModal('actFormModal'); showAlert('저장되었습니다.', 'success'); renderAll(); }
    catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}
async function removeProject(key) {
    const p = state.data.projects[key]; if (!p) return false;
    if (!confirm(`‘${p.name}’ 과제를 삭제할까요?`)) return false;
    delete state.data.projects[key];
    try { await saveAll(); showAlert('삭제되었습니다.', 'success'); renderAll(); return true; }
    catch (err) { showAlert('삭제 실패: ' + err.message, 'error'); return false; }
}
async function deleteActProject() { if (await removeProject(state.editKey)) closeModal('actFormModal'); }

// 전체 합계에 쓰이는 세목 이름들(표준 순서)
function rollupSemokNames() {
    const names = [];
    sortedKeys().forEach(k => state.data.projects[k].items.forEach(it => { if (names.indexOf(it.name) < 0) names.push(it.name); }));
    return semokOrder(names);
}
function editSummary() {
    document.getElementById('summaryText').value = state.data.summaryNote || '';
    const rn = state.data.rollupNotes || {};
    const names = rollupSemokNames();
    document.getElementById('rollupNotesFields').innerHTML = names.length
        ? names.map(n => `<div class="rn-row"><span class="rn-name">${esc(n)}</span><input type="text" data-name="${esc(n)}" value="${esc(rn[n] || '')}" placeholder="비고 (예: SCIE 2건 집행 가능)"></div>`).join('')
        : '<span class="muted">세목이 없습니다. 과제를 먼저 추가하세요.</span>';
    openModal('summaryModal');
}
async function saveSummary(e) {
    e.preventDefault();
    state.data.summaryNote = document.getElementById('summaryText').value;
    const rn = {};
    document.querySelectorAll('#rollupNotesFields input').forEach(inp => { const v = inp.value.trim(); if (v) rn[inp.dataset.name] = v; });
    state.data.rollupNotes = rn;
    try { await saveAll(); closeModal('summaryModal'); showAlert('저장되었습니다.', 'success'); renderAll(); }
    catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}

// ==================== 가져오기/내보내기 ====================
function openImport() {
    document.getElementById('importText').value = '';
    openModal('importModal');
}
async function doImport(e) {
    e.preventDefault();
    let d;
    try { d = JSON.parse(document.getElementById('importText').value); }
    catch (err) { showAlert('JSON 형식 오류: ' + err.message, 'error'); return; }
    state.data = normData(d);
    try { await saveAll(); closeModal('importModal'); showAlert('가져오기 완료 · 저장되었습니다.', 'success'); renderAll(); }
    catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}
function doExport() {
    const out = { summaryNote: state.data.summaryNote, rollupNotes: state.data.rollupNotes, projects: state.data.projects };
    document.getElementById('importText').value = JSON.stringify(out, null, 2);
    openModal('importModal');
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    const g = id => document.getElementById(id);
    loginBtn = g('loginBtn'); logoutBtn = g('logoutBtn'); loginModal = g('loginModal'); loginClose = g('loginClose');
    loginForm = g('loginForm'); userInfo = g('userInfo'); userName = g('userName');
    authGate = g('authGate'); actApp = g('actApp'); yearSelect = g('yearSelect');

    yearSelect.innerHTML = YEAR_NUMS.map(y => `<option value="${y}"${y === DEFAULT_YEAR ? ' selected' : ''}>${y}년</option>`).join('');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth(); database = firebase.database();
    } catch (e) { console.error('Firebase 초기화 실패', e); return; }

    auth.onAuthStateChanged(async (user) => {
        if (user && ALLOWED_USERS.includes(user.uid)) currentUser = user;
        else { currentUser = null; if (user && [ADMIN_UID, ROOT_UID].indexOf(user.uid) < 0) await auth.signOut(); }
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

    yearSelect.addEventListener('change', async () => { state.year = Number(yearSelect.value); try { await loadData(); renderAll(); } catch (e) { showAlert('데이터 로드 실패', 'error'); } });
    g('addActProjectBtn').addEventListener('click', () => openProjectForm(null));
    g('importBtn').addEventListener('click', openImport);
    g('exportBtn').addEventListener('click', doExport);
    g('addItemBtn').addEventListener('click', () => addItemRow());
    g('actForm').addEventListener('submit', saveProjectForm);
    g('deleteActProjectBtn').addEventListener('click', deleteActProject);
    g('summaryForm').addEventListener('submit', saveSummary);
    g('importForm').addEventListener('submit', doImport);

    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.close)));
    // 편집/입력 모달(.perf-modal)은 바깥 클릭으로 닫지 않음 (입력 중 실수 닫힘 방지) — 닫기/취소/저장 버튼으로만 닫힘
});
