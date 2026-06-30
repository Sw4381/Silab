// performance.js - 과제 실적 진행상황 (로그인 전용)
// 설정값은 config.js 참조 (firebaseConfig, ALLOWED_EMAIL)

// ==================== 상수 ====================
// 실적 항목(표의 열) - 고정 6종
const CATEGORIES = [
    { key: 'scie',       label: 'SCIE' },
    { key: 'nonScie',    label: '비SCIE' },
    { key: 'techDoc',    label: '기술문서' },
    { key: 'patentApp',  label: '특허출원' },
    { key: 'patentReg',  label: '특허등록' },
    { key: 'swReg',      label: 'SW등록' }
];
const CAT_LABEL = CATEGORIES.reduce((m, c) => (m[c.key] = c.label, m), {});
const ALLOWED_USERS = [ADMIN_UID, ROOT_UID];   // UID 기준
const OVERVIEW = '__all__';   // 과제 선택 드롭다운의 '전체 개요' 값
const TRACK_KEY = '__track__'; // performance 하위의 논문/특허 트래커 노드

// 논문/특허 매트릭스의 기본 과제 열 (편집 가능)
const DEFAULT_PAPER_COLS = ['kisti', 'BAS', 'NRF(개인)', 'NRF(집단)', '개인정보(용역)', '기타'];
const DEFAULT_PATENT_COLS = ['kisti', 'BAS', '개인연구(NRF)', '개인정보', '기타'];

// 상태 정의 (color: 'blue' | 'red')
const PAPER_STATUS = [
    { v: 'submitted', label: '제출', color: 'red' },
    { v: 'revision', label: '리비전', color: 'red' },
    { v: 'published', label: '게재(완료)', color: 'blue' }
];
const PATENT_STATUS = [
    { v: 'applied', label: '출원', color: 'blue' },
    { v: 'registered', label: '등록(완료)', color: 'red' }
];
function statusDef(defs, v) { return defs.find(s => s.v === v) || defs[0]; }

// ==================== 전역 상태 ====================
let auth, database;
let currentUser = null;
const state = {
    projects: {},                   // { projectKey: {name, agency, rows, achievements} }
    currentKey: null,
    track: {},                      // { papers, patents, meta } — 논문/특허 트래커
    paperYear: null                 // 논문 섹션에서 보고 있는 연도
};

// DOM refs
let loginBtn, logoutBtn, loginModal, loginClose, loginForm, userInfo, userName;
let authGate, perfApp;
let projectSelect, summaryCards, matrixWrap, achList, overviewWrap, detailWrap, trackWrap;

// ==================== 유틸 ====================
function escHtmlSafe(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function showAlert(message, type) {
    const el = document.createElement('div');
    el.className = `perf-alert ${type || 'info'}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function uid() {
    // database push 키를 쓰므로 보조용. 충돌 방지용 임시 키.
    return 'k' + Math.abs(((performance.now() * 1000) | 0)).toString(36) + (state._seq = (state._seq || 0) + 1).toString(36);
}

// ==================== 인증 ====================
async function loginUser(email, password) {
    // 접근 권한은 로그인 후 UID(ALLOWED_USERS)로 확인 — 임의 계정 자동생성은 하지 않음
    try {
        return await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            throw new Error('등록되지 않은 계정입니다.');
        } else if (error.code === 'auth/wrong-password') {
            throw new Error('비밀번호가 틀렸습니다.');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('이메일 형식이 올바르지 않습니다.');
        }
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
    if (perfApp) perfApp.style.display = authed ? 'block' : 'none';
}

// ==================== 데이터 로드 ====================
async function loadAllProjects() {
    const snap = await database.ref('performance').once('value');
    const all = snap.val() || {};

    // 트래커 노드(__track__) 분리, 예약 키(__로 시작)는 과제 목록에서 제외
    state.track = all[TRACK_KEY] || {};
    const data = {};
    Object.keys(all).forEach(k => { if (k.indexOf('__') !== 0) data[k] = all[k]; });
    state.projects = data;

    // 드롭다운 채우기: 맨 위 '전체 개요' + 과제들
    const keys = Object.keys(data).sort((a, b) => (data[a].order || 0) - (data[b].order || 0));
    const overviewOpt = `<option value="${OVERVIEW}">📊 전체 과제 (개요)</option>`;
    projectSelect.innerHTML = overviewOpt + keys.map(k =>
        `<option value="${escHtmlSafe(k)}">${escHtmlSafe(data[k].name || '(이름없음)')}</option>`
    ).join('');

    // 기본은 전체 개요. 특정 과제가 유효하게 선택돼 있으면 유지.
    if (state.currentKey !== OVERVIEW && !data[state.currentKey]) state.currentKey = OVERVIEW;
    if (!state.currentKey) state.currentKey = OVERVIEW;
    projectSelect.value = state.currentKey;

    renderCurrent();
}

function currentProject() {
    return (state.currentKey && state.currentKey !== OVERVIEW) ? state.projects[state.currentKey] : null;
}

// 과제별 합계(목표/달성, 진척률) 계산 — 진척률은 목표 초과분 제외
function computeTotals(rows, achieved) {
    let target = 0, done = 0;
    rows.forEach(r => {
        const t = r.targets || {};
        CATEGORIES.forEach(c => {
            const tg = Number(t[c.key]) || 0;
            const dn = (achieved[r.key] && achieved[r.key][c.key]) || 0;
            target += tg;
            done += Math.min(dn, tg);
        });
    });
    return { target, done, pct: target ? Math.round((done / target) * 100) : 0 };
}

function currentYearStr() {
    return String(new Date().getFullYear());
}

function selectProject(key) {
    state.currentKey = key;
    if (projectSelect) projectSelect.value = key;
    renderCurrent();
}

// (rowKey, category) -> 실적 기여도 합 (weight 미지정 시 1로 간주)
function buildAchievedMap(project) {
    const map = {};
    const ach = project.achievements || {};
    Object.values(ach).forEach(a => {
        if (!a || !a.rowKey || !a.category) return;
        const w = (a.weight != null && !isNaN(a.weight)) ? Number(a.weight) : 1;
        map[a.rowKey] = map[a.rowKey] || {};
        map[a.rowKey][a.category] = (map[a.rowKey][a.category] || 0) + w;
    });
    return map;
}

// 같은 단계(stage) 안에서는 앞 연차의 초과 실적이 뒤 연차 목표로 이월된다.
// 예: 1차년도 목표 1인데 2건 했으면, 남은 1건이 2차년도 목표를 채운 것으로 인정.
// 반환: rowKey -> category -> '인정 달성수'(해당 연차 목표 상한으로 캡)
function buildEffectiveAchieved(project) {
    const raw = buildAchievedMap(project);
    const rows = sortedRows(project);

    // 단계별로 묶되 연차 순서(order) 유지
    const byStage = {};
    rows.forEach(r => { (byStage[r.stage] = byStage[r.stage] || []).push(r); });

    const eff = {};
    Object.values(byStage).forEach(stageRows => {
        CATEGORIES.forEach(c => {
            let carry = 0; // 앞 연차에서 넘어온 초과 실적
            stageRows.forEach(r => {
                const target = Number((r.targets || {})[c.key]) || 0;
                const rawCnt = (raw[r.key] && raw[r.key][c.key]) || 0;
                const available = carry + rawCnt;
                const allocated = target > 0 ? Math.min(available, target) : 0;
                eff[r.key] = eff[r.key] || {};
                eff[r.key][c.key] = allocated;
                carry = available - allocated; // 남은 초과분은 다음 연차로 이월
            });
        });
    });
    return eff;
}

function sortedRows(project) {
    const rows = project.rows || {};
    return Object.entries(rows)
        .map(([key, v]) => ({ key, ...v }))
        .sort((a, b) => (a.order || 0) - (b.order || 0));
}

// ==================== 렌더링 (개요 / 상세 분기) ====================
function renderCurrent() {
    const showOverview = (state.currentKey === OVERVIEW) || !currentProject();
    overviewWrap.style.display = showOverview ? '' : 'none';
    trackWrap.style.display = showOverview ? '' : 'none';
    detailWrap.style.display = showOverview ? 'none' : '';
    if (showOverview) { renderOverview(); renderTrackers(); }
    else renderDetail();
}

function renderDetail() {
    const p = currentProject();
    if (!p) return;
    const rawMap = buildAchievedMap(p);          // 셀 표시용 (사실 그대로)
    const effMap = buildEffectiveAchieved(p);    // 진척도 통계용 (단계 내 이월)
    const rows = sortedRows(p);
    renderSummary(p, rows, effMap);              // 게이지·요약은 이월 기준
    renderMatrix(p, rows, rawMap, effMap);       // 셀은 사실, 색은 이월충족 반영
    renderAchList(p, rows);
}

// 전체 개요: 과제별 진척률 + 올해 연차 부족분 + 연차별 막대
function renderOverview() {
    const keys = Object.keys(state.projects).sort((a, b) => (state.projects[a].order || 0) - (state.projects[b].order || 0));
    if (!keys.length) {
        overviewWrap.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><h3>등록된 과제가 없습니다</h3><p>상단의 '과제 추가' 버튼으로 과제를 먼저 등록하세요.</p></div>`;
        return;
    }
    const curYear = currentYearStr();

    const cards = keys.map(k => {
        const p = state.projects[k];
        const achieved = buildEffectiveAchieved(p);
        const rows = sortedRows(p);
        const { target, done, pct } = computeTotals(rows, achieved);

        // 올해 연차
        const yr = rows.find(r => String(r.year) === curYear);
        let yearHtml;
        if (yr) {
            const items = CATEGORIES.map(c => {
                const tg = Number((yr.targets || {})[c.key]) || 0;
                const dn = (achieved[yr.key] && achieved[yr.key][c.key]) || 0;
                return { label: c.label, tg, dn, lack: Math.max(0, tg - dn) };
            }).filter(x => x.tg > 0);
            const lacking = items.filter(x => x.lack > 0);
            let inner;
            if (!items.length) inner = `<span class="muted">설정된 목표 없음</span>`;
            else if (!lacking.length) inner = `<span class="ov-alldone"><i class="fas fa-check-circle"></i> 올해 목표 모두 달성</span>`;
            else inner = `<div class="ov-lacks">` + lacking.map(x =>
                `<span class="ov-lack-chip">${x.label} <b>${fmtW(x.dn)}/${fmtW(x.tg)}</b><em>−${fmtW(x.lack)}</em></span>`).join('') + `</div>`;
            yearHtml = `<div class="ov-year">
                <div class="ov-year-head"><i class="fas fa-bullseye"></i> 올해 ${curYear} · ${escHtmlSafe(yr.yearLabel || '')} 남은 실적</div>
                ${inner}
            </div>`;
        } else {
            yearHtml = `<div class="ov-year"><div class="ov-year-head"><i class="fas fa-bullseye"></i> 올해 ${curYear}</div><span class="muted">해당 연차 없음</span></div>`;
        }

        // 연차별 막대
        const yearsHtml = rows.length ? rows.map(r => {
            const tt = computeTotals([r], achieved);
            const rem = tt.target - tt.done;
            const isCur = String(r.year) === curYear;
            return `<div class="ov-yr-row ${isCur ? 'cur' : ''}">
                <span class="ov-yr-label">${escHtmlSafe(r.yearLabel || '')}${r.year ? `<small>(${escHtmlSafe(r.year)})</small>` : ''}</span>
                <span class="ov-bar"><span class="ov-bar-fill" style="width:${tt.pct}%"></span></span>
                <span class="ov-yr-pct">${tt.pct}%</span>
                <span class="ov-yr-rem">${tt.target ? (rem > 0 ? '남은 ' + fmtW(rem) : '완료') : '–'}</span>
            </div>`;
        }).join('') : `<span class="muted">차년도가 없습니다. '상세 보기 → 과제 수정'에서 추가하세요.</span>`;

        return `<div class="ov-card card" data-key="${escHtmlSafe(k)}">
            <div class="ov-card-head">
                <div class="ov-card-titlewrap">
                    <div class="ov-title">${escHtmlSafe(p.name)}</div>
                    ${p.agency ? `<div class="ov-agency"><i class="fas fa-building"></i> ${escHtmlSafe(p.agency)}</div>` : ''}
                </div>
                <button class="tb-btn ov-detail-btn">상세 <i class="fas fa-arrow-right"></i></button>
            </div>
            <div class="ov-overall">
                <span class="ov-bar big"><span class="ov-bar-fill" style="width:${pct}%"></span></span>
                <span class="ov-overall-pct">${pct}%</span>
                <span class="ov-overall-sub">달성 ${fmtW(done)} / 목표 ${fmtW(target)}</span>
            </div>
            ${yearHtml}
            <div class="ov-years">${yearsHtml}</div>
        </div>`;
    }).join('');

    overviewWrap.innerHTML = `<div class="ov-grid">${cards}</div>`;
    overviewWrap.querySelectorAll('.ov-card').forEach(el =>
        el.addEventListener('click', () => selectProject(el.dataset.key)));
}

// ==================== 논문/특허 트래커 ====================
function trackMeta() { return (state.track && state.track.meta) || {}; }
function papersData() { return (state.track && state.track.papers) || {}; }
function patentsData() { return (state.track && state.track.patents) || {}; }
function paperCols() { const m = trackMeta(); return (m.paperColumns && m.paperColumns.length) ? m.paperColumns : DEFAULT_PAPER_COLS; }
function patentCols() { const m = trackMeta(); return (m.patentColumns && m.patentColumns.length) ? m.patentColumns : DEFAULT_PATENT_COLS; }
const fmtW = n => (Math.round(Number(n) * 100) / 100).toString();
function itemsArray(obj) {
    return Object.entries(obj || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function renderTrackers() {
    renderPaperSection();
    renderPatentSection();
}

function buildTrackMatrix(items, cols, defs, kind, headLabel) {
    if (!items.length) {
        return `<div class="empty-state small"><i class="fas fa-table"></i><p>등록된 ${headLabel}이(가) 없습니다. 위 '${kind === 'paper' ? '논문' : '특허'} 추가' 버튼으로 등록하세요.</p></div>`;
    }
    const head = `<tr><th class="tk-label">${headLabel}</th>${cols.map(c => `<th>${escHtmlSafe(c)}</th>`).join('')}</tr>`;
    const body = items.map(it => {
        const sd = statusDef(defs, it.status);
        const cc = 'tk-' + sd.color;
        const opts = defs.map(s => `<option value="${s.v}" ${s.v === it.status ? 'selected' : ''}>${s.label}</option>`).join('');
        const venueLine = it.venue
            ? `<div class="tk-venue">${escHtmlSafe(it.venue)}${it.type ? ' · ' + escHtmlSafe(it.type) : ''}</div>`
            : (it.type ? `<div class="tk-venue">${escHtmlSafe(it.type)}</div>` : '');
        const label = `<td class="tk-label">
            <div class="tk-name ${cc}">${escHtmlSafe(it.label || '')}</div>
            ${venueLine}
            <select class="tk-status ${cc}" data-status="${kind}:${it.id}">${opts}</select>
            <span class="tk-row-acts">
                <button class="mini-btn" data-edit="${kind}:${it.id}" title="수정"><i class="fas fa-pen"></i></button>
                <button class="mini-btn del" data-del="${kind}:${it.id}" title="삭제"><i class="fas fa-trash"></i></button>
            </span>
        </td>`;
        const cells = cols.map(c => {
            const ct = (it.contribs || {})[c];
            if (!ct || !(Number(ct.w))) return `<td class="tk-cell empty"></td>`;
            return `<td class="tk-cell ${cc}"><b>${fmtW(Number(ct.w))}</b>${it.date ? ` <span class="tk-date">(${escHtmlSafe(it.date)})</span>` : ''}${ct.note ? `<span class="tk-note">(${escHtmlSafe(ct.note)})</span>` : ''}</td>`;
        }).join('');
        return `<tr>${label}${cells}</tr>`;
    }).join('');
    return `<table class="perf-matrix tk-matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function bindTrackEvents(container) {
    container.querySelectorAll('[data-status]').forEach(sel => {
        sel.addEventListener('change', () => { const [kind, id] = sel.dataset.status.split(':'); changeStatus(kind, id, sel.value); });
    });
    container.querySelectorAll('[data-edit]').forEach(b => {
        b.addEventListener('click', () => { const [kind, id] = b.dataset.edit.split(':'); kind === 'paper' ? openPaperForm(id) : openPatentForm(id); });
    });
    container.querySelectorAll('[data-del]').forEach(b => {
        b.addEventListener('click', () => { const [kind, id] = b.dataset.del.split(':'); deleteItem(kind, id); });
    });
}

function renderPaperSection() {
    const cols = paperCols();
    const all = itemsArray(papersData());
    const cur = parseInt(currentYearStr(), 10);
    const years = Array.from(new Set(all.map(p => Number(p.year)).filter(Boolean)));
    if (!years.includes(cur)) years.push(cur);
    years.sort((a, b) => b - a);
    if (!state.paperYear || !years.includes(Number(state.paperYear))) state.paperYear = cur;

    const ysel = document.getElementById('paperYearSel');
    ysel.innerHTML = years.map(y => `<option value="${y}" ${y === Number(state.paperYear) ? 'selected' : ''}>${y}년</option>`).join('');
    document.getElementById('paperTitle').textContent = `${state.paperYear} 논문 실적`;

    const items = all.filter(p => Number(p.year) === Number(state.paperYear));
    const mEl = document.getElementById('paperMatrix');
    mEl.innerHTML = buildTrackMatrix(items, cols, PAPER_STATUS, 'paper', '논문');
    bindTrackEvents(mEl);
    document.getElementById('paperSummary').innerHTML = paperSummaryHtml(items, cols);
    document.getElementById('paperGoal').innerHTML = paperGoalHtml(items, cols, state.paperYear);
    renderMemo('paper');
}

function renderPatentSection() {
    const cols = patentCols();
    const items = itemsArray(patentsData());
    const mEl = document.getElementById('patentMatrix');
    mEl.innerHTML = buildTrackMatrix(items, cols, PATENT_STATUS, 'patent', '특허');
    bindTrackEvents(mEl);
    document.getElementById('patentSummary').innerHTML = patentSummaryHtml(items, cols);
    document.getElementById('patentGoal').innerHTML = patentGoalHtml(items, cols);
    renderMemo('patent');
}

function paperSummaryHtml(items, cols) {
    const agg = {}; cols.forEach(c => agg[c] = { done: 0, review: 0 });
    let tDone = 0, tReview = 0;
    items.forEach(it => {
        const done = statusDef(PAPER_STATUS, it.status).color === 'blue';
        Object.entries(it.contribs || {}).forEach(([c, ct]) => {
            const w = Number(ct.w) || 0;
            if (!agg[c]) agg[c] = { done: 0, review: 0 };
            if (done) agg[c].done += w; else agg[c].review += w;
        });
    });
    const chips = cols.map(c => {
        const a = agg[c] || { done: 0, review: 0 };
        if (!a.done && !a.review) return '';
        tDone += a.done; tReview += a.review;
        return `<span class="tk-sum-chip"><span class="col">${escHtmlSafe(c)}</span>${a.done ? `<span class="b">완료 ${fmtW(a.done)}</span>` : ''}${a.review ? `<span class="r">심사중 ${fmtW(a.review)}</span>` : ''}</span>`;
    }).join('');
    return chips + `<span class="tk-sum-total">총 완료 ${fmtW(tDone)}편 · 심사중 ${fmtW(tReview)}편</span>`;
}

function patentSummaryHtml(items, cols) {
    const agg = {}; cols.forEach(c => agg[c] = { applied: 0, registered: 0 });
    let tA = 0, tR = 0;
    items.forEach(it => {
        const reg = statusDef(PATENT_STATUS, it.status).color === 'red';
        Object.entries(it.contribs || {}).forEach(([c, ct]) => {
            const w = Number(ct.w) || 0;
            if (!agg[c]) agg[c] = { applied: 0, registered: 0 };
            if (reg) agg[c].registered += w; else agg[c].applied += w;
        });
    });
    const chips = cols.map(c => {
        const a = agg[c] || { applied: 0, registered: 0 };
        if (!a.applied && !a.registered) return '';
        tA += a.applied; tR += a.registered;
        return `<span class="tk-sum-chip"><span class="col">${escHtmlSafe(c)}</span>${a.applied ? `<span class="b">출원 ${fmtW(a.applied)}</span>` : ''}${a.registered ? `<span class="r">등록 ${fmtW(a.registered)}</span>` : ''}</span>`;
    }).join('');
    return chips + `<span class="tk-sum-total">총 출원 ${fmtW(tA)}건 · 등록 ${fmtW(tR)}건</span>`;
}

function renderMemo(kind) {
    const el = document.getElementById(kind === 'paper' ? 'paperMemo' : 'patentMemo');
    el.textContent = (trackMeta()[kind + 'Shortfall']) || '';
}

function editMemo(kind) {
    const el = document.getElementById(kind === 'paper' ? 'paperMemo' : 'patentMemo');
    if (el.querySelector('textarea')) return;
    const cur = (trackMeta()[kind + 'Shortfall']) || '';
    el.innerHTML = `<textarea class="track-memo-edit" rows="3">${escHtmlSafe(cur)}</textarea>
        <div style="margin-top:6px;display:flex;gap:6px;justify-content:flex-end;">
            <button class="tb-btn mini" id="memoCancel">취소</button>
            <button class="tb-btn mini primary" id="memoSave">저장</button>
        </div>`;
    el.querySelector('#memoCancel').addEventListener('click', () => renderMemo(kind));
    el.querySelector('#memoSave').addEventListener('click', async () => {
        const val = el.querySelector('textarea').value.trim();
        try {
            await database.ref(`performance/${TRACK_KEY}/meta/${kind}Shortfall`).set(val);
            showAlert('메모가 저장되었습니다.', 'success');
            await loadAllProjects();
        } catch (e) { showAlert('저장 실패: ' + e.message, 'error'); }
    });
}

async function changeStatus(kind, id, value) {
    const node = kind === 'paper' ? 'papers' : 'patents';
    try {
        await database.ref(`performance/${TRACK_KEY}/${node}/${id}/status`).set(value);
        showAlert('상태가 변경되었습니다.', 'success');
        await loadAllProjects();
    } catch (e) { showAlert('변경 실패: ' + e.message, 'error'); }
}

async function deleteItem(kind, id) {
    const name = kind === 'paper' ? '논문' : '특허';
    if (!confirm(`이 ${name} 기록을 삭제할까요?`)) return;
    const node = kind === 'paper' ? 'papers' : 'patents';
    try {
        await database.ref(`performance/${TRACK_KEY}/${node}/${id}`).remove();
        showAlert('삭제되었습니다.', 'success');
        await loadAllProjects();
    } catch (e) { showAlert('삭제 실패: ' + e.message, 'error'); }
}

// ----- 기여도 편집기 -----
function makeContribRow(cols, data) {
    data = data || {};
    const div = document.createElement('div');
    div.className = 'contrib-row';
    div.innerHTML = `
        <select class="cproj">${cols.map(c => `<option value="${escHtmlSafe(c)}" ${c === data.project ? 'selected' : ''}>${escHtmlSafe(c)}</option>`).join('')}</select>
        <input type="number" class="cw" step="any" min="0" max="1" placeholder="기여 0~1" value="${data.w != null ? data.w : ''}">
        <input type="text" class="cn" placeholder="비고(선택)" value="${escHtmlSafe(data.note || '')}">
        <button type="button" class="re-remove" title="삭제">&times;</button>`;
    div.querySelector('.re-remove').addEventListener('click', () => div.remove());
    return div;
}
function fillContribEditor(containerId, cols, contribs) {
    const c = document.getElementById(containerId);
    c.innerHTML = '';
    const entries = Object.entries(contribs || {});
    if (entries.length) entries.forEach(([proj, ct]) => c.appendChild(makeContribRow(cols, { project: proj, w: ct.w, note: ct.note })));
    else c.appendChild(makeContribRow(cols, {}));
}
function collectContribs(containerId) {
    const out = {};
    document.querySelectorAll(`#${containerId} .contrib-row`).forEach(row => {
        const proj = row.querySelector('.cproj').value;
        const w = parseFloat(row.querySelector('.cw').value);
        const note = row.querySelector('.cn').value.trim();
        if (proj && w > 0) { out[proj] = { w }; if (note) out[proj].note = note; }
    });
    return out;
}

// ----- 논문 CRUD -----
function openPaperForm(id) {
    const f = document.getElementById('paperForm');
    f.reset();
    f.dataset.editId = id || '';
    document.getElementById('paperFormTitle').textContent = id ? '논문 수정' : '논문 추가';
    f.elements.status.innerHTML = PAPER_STATUS.map(s => `<option value="${s.v}">${s.label}</option>`).join('');
    const cols = paperCols();
    const it = id ? (papersData()[id] || {}) : {};
    f.elements.label.value = it.label || '';
    f.elements.venue.value = it.venue || '';
    f.elements.type.value = it.type || '';
    f.elements.year.value = it.year || currentYearStr();
    f.elements.date.value = it.date || '';
    f.elements.status.value = it.status || 'submitted';
    fillContribEditor('paperContribs', cols, it.contribs);
    openModal('paperFormModal');
}

async function savePaper(e) {
    e.preventDefault();
    const f = e.target;
    const label = f.elements.label.value.trim();
    if (!label) return showAlert('논문 약칭을 입력하세요.', 'error');
    const contribs = collectContribs('paperContribs');
    if (!Object.keys(contribs).length) return showAlert('과제별 기여도를 1개 이상 입력하세요.', 'error');
    const data = {
        label,
        venue: f.elements.venue.value.trim(),
        type: f.elements.type.value.trim(),
        year: parseInt(f.elements.year.value, 10) || parseInt(currentYearStr(), 10),
        date: f.elements.date.value.trim(),
        status: f.elements.status.value,
        contribs
    };
    const id = f.dataset.editId;
    try {
        if (id) {
            data.createdAt = (papersData()[id] || {}).createdAt || firebase.database.ServerValue.TIMESTAMP;
            await database.ref(`performance/${TRACK_KEY}/papers/${id}`).set(data);
        } else {
            data.createdAt = firebase.database.ServerValue.TIMESTAMP;
            await database.ref(`performance/${TRACK_KEY}/papers`).push().set(data);
        }
        state.paperYear = data.year;
        closeModal('paperFormModal');
        showAlert('저장되었습니다.', 'success');
        await loadAllProjects();
    } catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}

// ----- 특허 CRUD -----
function openPatentForm(id) {
    const f = document.getElementById('patentForm');
    f.reset();
    f.dataset.editId = id || '';
    document.getElementById('patentFormTitle').textContent = id ? '특허 수정' : '특허 추가';
    f.elements.status.innerHTML = PATENT_STATUS.map(s => `<option value="${s.v}">${s.label}</option>`).join('');
    const cols = patentCols();
    const it = id ? (patentsData()[id] || {}) : {};
    f.elements.label.value = it.label || '';
    f.elements.date.value = it.date || '';
    f.elements.status.value = it.status || 'applied';
    fillContribEditor('patentContribs', cols, it.contribs);
    openModal('patentFormModal');
}

async function savePatent(e) {
    e.preventDefault();
    const f = e.target;
    const label = f.elements.label.value.trim();
    if (!label) return showAlert('특허 약칭을 입력하세요.', 'error');
    const contribs = collectContribs('patentContribs');
    if (!Object.keys(contribs).length) return showAlert('과제별 기여도를 1개 이상 입력하세요.', 'error');
    const data = {
        label,
        date: f.elements.date.value.trim(),
        status: f.elements.status.value,
        contribs
    };
    const id = f.dataset.editId;
    try {
        if (id) {
            data.createdAt = (patentsData()[id] || {}).createdAt || firebase.database.ServerValue.TIMESTAMP;
            await database.ref(`performance/${TRACK_KEY}/patents/${id}`).set(data);
        } else {
            data.createdAt = firebase.database.ServerValue.TIMESTAMP;
            await database.ref(`performance/${TRACK_KEY}/patents`).push().set(data);
        }
        closeModal('patentFormModal');
        showAlert('저장되었습니다.', 'success');
        await loadAllProjects();
    } catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}

// ----- 열(과제) 편집 -----
async function editColumns(kind) {
    const cur = kind === 'paper' ? paperCols() : patentCols();
    const input = prompt(`${kind === 'paper' ? '논문' : '특허'} 매트릭스의 과제 열을 쉼표(,)로 구분해 입력하세요.\n예: kisti, BAS, NRF(개인), 개인정보, 기타`, cur.join(', '));
    if (input == null) return;
    const cols = input.split(',').map(s => s.trim().replace(/[.#$/\[\]]/g, '')).filter(Boolean);
    if (!cols.length) return showAlert('열을 1개 이상 입력하세요.', 'warning');
    try {
        await database.ref(`performance/${TRACK_KEY}/meta/${kind}Columns`).set(cols);
        showAlert('열이 저장되었습니다.', 'success');
        await loadAllProjects();
    } catch (e) { showAlert('저장 실패: ' + e.message, 'error'); }
}

// ----- 과제별 목표 대비 현황 -----
function paperTargetsFor(year) { const t = trackMeta().paperTargets || {}; return t[year] || {}; }
function patentTargetsObj() { return trackMeta().patentTargets || {}; }

function paperGoalHtml(items, cols, year) {
    const targets = paperTargetsFor(year);
    const agg = {}; cols.forEach(c => agg[c] = { done: 0, review: 0 });
    items.forEach(it => {
        const done = statusDef(PAPER_STATUS, it.status).color === 'blue';
        Object.entries(it.contribs || {}).forEach(([c, ct]) => {
            const w = Number(ct.w) || 0;
            if (!agg[c]) agg[c] = { done: 0, review: 0 };
            if (done) agg[c].done += w; else agg[c].review += w;
        });
    });
    let sT = 0, sD = 0, sR = 0;
    const rows = cols.map(c => {
        const T = Number(targets[c]) || 0;
        const a = agg[c] || { done: 0, review: 0 };
        if (!T && !a.done && !a.review) return '';
        sT += T; sD += a.done; sR += a.review;
        let state, badge;
        if (T && a.done >= T) { state = 'done'; badge = '✅ 달성'; }
        else if (T && a.done + a.review >= T) { state = 'review'; badge = '🟡 심사중 충당'; }
        else if (T) { state = 'miss'; badge = '🔴 미달 −' + fmtW(T - a.done - a.review); }
        else { state = 'extra'; badge = '목표 외'; }
        return `<div class="goal-row ${state}">
            <span class="goal-col">${escHtmlSafe(c)}</span>
            <span class="goal-target">${T ? `목표 ${fmtW(T)}편` : '목표 –'}</span>
            <span class="goal-cur">완료 ${fmtW(a.done)} · 심사중 ${fmtW(a.review)}</span>
            <span class="goal-badge">${badge}</span>
        </div>`;
    }).join('');
    if (!rows) return `<div class="goal-empty muted">설정된 목표가 없습니다. ‘목표 편집’으로 과제별 목표 편수를 입력하세요.</div>`;
    return `<div class="goal-head"><i class="fas fa-bullseye"></i> ${year}년 과제별 목표 대비 현황</div>${rows}
        <div class="goal-total">⇒ 목표 합계 ${fmtW(sT)}편 · 완료 ${fmtW(sD)} · 심사중 ${fmtW(sR)}</div>`;
}

// 특허 목표는 과제별 {a: 출원목표, r: 등록목표}. (구버전 숫자값은 등록목표로 간주)
function normPatentTarget(t) {
    if (t == null) return { a: 0, r: 0 };
    if (typeof t === 'number') return { a: 0, r: Number(t) || 0 };
    return { a: Number(t.a) || 0, r: Number(t.r) || 0 };
}

function patentGoalHtml(items, cols) {
    const targets = patentTargetsObj();
    const agg = {}; cols.forEach(c => agg[c] = { applied: 0, registered: 0 });
    items.forEach(it => {
        const reg = statusDef(PATENT_STATUS, it.status).color === 'red';
        Object.entries(it.contribs || {}).forEach(([c, ct]) => {
            const w = Number(ct.w) || 0;
            if (!agg[c]) agg[c] = { applied: 0, registered: 0 };
            if (reg) agg[c].registered += w; else agg[c].applied += w;
        });
    });
    let sTa = 0, sTr = 0, sA = 0, sR = 0;
    const rows = cols.map(c => {
        const T = normPatentTarget(targets[c]);
        const a = agg[c] || { applied: 0, registered: 0 };
        if (!T.a && !T.r && !a.applied && !a.registered) return '';
        sTa += T.a; sTr += T.r; sA += a.applied; sR += a.registered;

        const appliedProg = a.applied + a.registered; // 등록된 것도 출원은 거친 것으로 인정
        const targetParts = [];
        if (T.a) targetParts.push(`출원 ${fmtW(T.a)}`);
        if (T.r) targetParts.push(`등록 ${fmtW(T.r)}`);

        // 판정
        const badges = [];
        let unmet = 0, hasTarget = (T.a > 0 || T.r > 0);
        if (T.a) { const ok = appliedProg >= T.a; if (!ok) unmet++; badges.push(ok ? '✅출원' : `🔴출원 −${fmtW(T.a - appliedProg)}`); }
        if (T.r) { const ok = a.registered >= T.r; if (!ok) unmet++; badges.push(ok ? '✅등록' : `🔴등록 −${fmtW(T.r - a.registered)}`); }
        let stateCls;
        if (!hasTarget) { stateCls = 'extra'; badges.push('목표 외'); }
        else if (unmet === 0) stateCls = 'done';
        else if (appliedProg + a.registered > 0) stateCls = 'review';
        else stateCls = 'miss';

        return `<div class="goal-row ${stateCls}">
            <span class="goal-col">${escHtmlSafe(c)}</span>
            <span class="goal-target">${targetParts.length ? '목표 ' + targetParts.join(' · ') : '목표 –'}</span>
            <span class="goal-cur">출원 ${fmtW(a.applied)} · 등록 ${fmtW(a.registered)}</span>
            <span class="goal-badge">${badges.join(' ')}</span>
        </div>`;
    }).join('');
    if (!rows) return `<div class="goal-empty muted">설정된 목표가 없습니다. ‘목표 편집’으로 과제별 출원·등록 목표를 입력하세요.</div>`;
    return `<div class="goal-head"><i class="fas fa-bullseye"></i> 과제별 목표 대비 현황 (출원/등록 구분)</div>${rows}
        <div class="goal-total">⇒ 목표 합계 출원 ${fmtW(sTa)} · 등록 ${fmtW(sTr)} / 현재 출원 ${fmtW(sA)} · 등록 ${fmtW(sR)}</div>`;
}

function openTargetForm(kind) {
    const f = document.getElementById('targetForm');
    f.dataset.kind = kind;
    const fields = document.getElementById('targetFields');
    if (kind === 'paper') {
        const cols = paperCols();
        const cur = paperTargetsFor(state.paperYear);
        document.getElementById('targetFormTitle').textContent = `${state.paperYear}년 논문 목표 편집`;
        fields.innerHTML = `<div class="targets-grid">` + cols.map(c =>
            `<div class="form-group"><label>${escHtmlSafe(c)}</label><input type="number" min="0" step="any" data-col="${escHtmlSafe(c)}" value="${Number(cur[c]) || 0}"></div>`
        ).join('') + `</div>`;
    } else {
        const cols = patentCols();
        const cur = patentTargetsObj();
        document.getElementById('targetFormTitle').textContent = '특허 목표 편집 (출원/등록 구분)';
        fields.innerHTML = cols.map(c => {
            const t = normPatentTarget(cur[c]);
            return `<div class="target-prow">
                <span class="target-pcol">${escHtmlSafe(c)}</span>
                <label class="target-pin">출원<input type="number" min="0" step="any" data-col="${escHtmlSafe(c)}" data-type="a" value="${fmtW(t.a)}"></label>
                <label class="target-pin">등록<input type="number" min="0" step="any" data-col="${escHtmlSafe(c)}" data-type="r" value="${fmtW(t.r)}"></label>
            </div>`;
        }).join('');
    }
    openModal('targetFormModal');
}

async function saveTargets(e) {
    e.preventDefault();
    const kind = e.target.dataset.kind;
    const obj = {};
    if (kind === 'paper') {
        document.querySelectorAll('#targetFields [data-col]').forEach(inp => {
            const v = parseFloat(inp.value) || 0;
            if (v > 0) obj[inp.dataset.col] = v;
        });
    } else {
        document.querySelectorAll('#targetFields [data-col]').forEach(inp => {
            const col = inp.dataset.col, type = inp.dataset.type, v = parseFloat(inp.value) || 0;
            if (v > 0) { obj[col] = obj[col] || {}; obj[col][type] = v; }
        });
    }
    try {
        const path = kind === 'paper'
            ? `performance/${TRACK_KEY}/meta/paperTargets/${state.paperYear}`
            : `performance/${TRACK_KEY}/meta/patentTargets`;
        await database.ref(path).set(obj);
        closeModal('targetFormModal');
        showAlert('목표가 저장되었습니다.', 'success');
        await loadAllProjects();
    } catch (err) { showAlert('저장 실패: ' + err.message, 'error'); }
}

function cellClass(target, done) {
    if (!target) return 'cell--none';
    if (done >= target) return 'cell--done';
    if (done > 0) return 'cell--partial';
    return 'cell--miss';
}

// 셀 색상: 자체 raw로 달성하면 done, 이월(effective)로만 충족되면 carry
function cellClassRaw(target, rawDone, effDone) {
    if (!target) return 'cell--none';
    if (rawDone >= target) return 'cell--done';   // 자체 달성 (초과분도 green)
    if (effDone >= target) return 'cell--carry';  // 앞 연차 이월분으로 충족
    if (rawDone > 0) return 'cell--partial';
    return 'cell--miss';
}

function renderSummary(p, rows, achieved) {
    // 전체 진척률 + 항목별 목표/달성/부족
    let totalTarget = 0, totalDone = 0;
    const perCat = CATEGORIES.reduce((m, c) => (m[c.key] = { target: 0, done: 0 }, m), {});

    rows.forEach(r => {
        const t = r.targets || {};
        CATEGORIES.forEach(c => {
            const target = Number(t[c.key]) || 0;
            const done = (achieved[r.key] && achieved[r.key][c.key]) || 0;
            perCat[c.key].target += target;
            perCat[c.key].done += done;
            totalTarget += target;
            totalDone += Math.min(done, target); // 진척률은 목표 초과분 제외
        });
    });

    const pct = totalTarget ? Math.round((totalDone / totalTarget) * 100) : 0;

    const catChips = CATEGORIES.map(c => {
        const { target, done } = perCat[c.key];
        if (!target) return '';
        const lack = Math.max(0, target - done);
        const cls = done >= target ? 'done' : (done > 0 ? 'partial' : 'miss');
        return `<div class="cat-chip ${cls}">
            <span class="cat-chip-label">${c.label}</span>
            <span class="cat-chip-num">${fmtW(done)}/${target}</span>
            ${lack ? `<span class="cat-chip-lack">−${fmtW(lack)}</span>` : '<i class="fas fa-check"></i>'}
        </div>`;
    }).join('');

    summaryCards.innerHTML = `
        <div class="summary-main card">
            <div class="gauge" style="--pct:${pct}">
                <div class="gauge-num">${pct}<small>%</small></div>
            </div>
            <div class="summary-main-info">
                <div class="summary-title">${escHtmlSafe(p.name)} 전체 진척률</div>
                <div class="summary-sub">목표 합계 <b>${fmtW(totalTarget)}</b> · 달성 <b>${fmtW(totalDone)}</b> · 잔여 <b>${fmtW(Math.max(0, totalTarget - totalDone))}</b></div>
                ${p.agency ? `<div class="summary-agency"><i class="fas fa-building"></i> ${escHtmlSafe(p.agency)}</div>` : ''}
            </div>
        </div>
        <div class="cat-chips">${catChips || '<span class="muted">아직 목표가 입력되지 않았습니다.</span>'}</div>
    `;
}

function renderMatrix(p, rows, rawMap, effMap) {
    if (!rows.length) {
        matrixWrap.innerHTML = `<div class="empty-state"><i class="fas fa-table"></i><h3>차년도 행이 없습니다</h3><p>'차년도·목표 수정' 또는 '과제 수정'에서 단계·연도별 목표를 입력하세요.</p></div>`;
        return;
    }

    // 단계별로 묶어 rowspan 적용
    const head = `<tr>
        <th class="th-stage">단계</th>
        <th class="th-year">차년도</th>
        ${CATEGORIES.map(c => `<th>${c.label}</th>`).join('')}
    </tr>`;

    // 같은 stage 연속 그룹 카운트
    const stageCount = {};
    rows.forEach(r => { stageCount[r.stage] = (stageCount[r.stage] || 0) + 1; });
    const stageSeen = {};

    const body = rows.map(r => {
        const t = r.targets || {};
        let stageCell = '';
        if (!stageSeen[r.stage]) {
            stageSeen[r.stage] = true;
            stageCell = `<td class="td-stage" rowspan="${stageCount[r.stage]}">${escHtmlSafe(r.stage)}</td>`;
        }
        const yearCell = `<td class="td-year">${escHtmlSafe(r.yearLabel || '')}${r.year ? `<span class="yr">(${escHtmlSafe(r.year)})</span>` : ''}</td>`;

        const cells = CATEGORIES.map(c => {
            const target = Number(t[c.key]) || 0;
            const rawDone = (rawMap[r.key] && rawMap[r.key][c.key]) || 0;   // 사실 그대로
            const effDone = (effMap[r.key] && effMap[r.key][c.key]) || 0;   // 이월 반영
            const cls = cellClassRaw(target, rawDone, effDone);
            const carried = target && rawDone < target && effDone >= target;
            const content = target
                ? `${fmtW(rawDone)}/${target}${carried ? ' <span class="carry-badge" title="앞 연차 초과 실적이 이월되어 충족됨">이월충족</span>' : ''}`
                : '–';
            const clickable = target ? 'clickable' : '';
            return `<td class="perf-cell ${cls} ${clickable}" data-row="${escHtmlSafe(r.key)}" data-cat="${c.key}" title="${c.label} · 클릭하여 실적 추가">${content}</td>`;
        }).join('');

        return `<tr>${stageCell}${yearCell}${cells}</tr>`;
    }).join('');

    matrixWrap.innerHTML = `<table class="perf-matrix"><thead>${head}</thead><tbody>${body}</tbody></table>
        <div class="legend">
            <span><i class="box cell--done"></i> 달성</span>
            <span><span class="carry-badge">이월충족</span> 앞 연차 초과분으로 채움</span>
            <span><i class="box cell--partial"></i> 진행중</span>
            <span><i class="box cell--miss"></i> 미달</span>
            <span><i class="box cell--none"></i> 목표없음</span>
            <span class="legend-hint">셀 숫자는 실제 실적, 색은 이월 포함 충족 여부입니다.</span>
        </div>`;

    // 셀 클릭 → 실적 추가 (목표 있는 셀)
    matrixWrap.querySelectorAll('.perf-cell.clickable').forEach(td => {
        td.addEventListener('click', () => openAchForm(td.dataset.row, td.dataset.cat));
    });
}

function renderAchList(p, rows) {
    const rowInfo = {};
    rows.forEach(r => { rowInfo[r.key] = r; });

    const ach = Object.entries(p.achievements || {}).map(([key, v]) => ({ key, ...v }));
    if (!ach.length) {
        achList.innerHTML = `<div class="empty-state small"><i class="fas fa-clipboard-list"></i><p>등록된 실적이 없습니다. 매트릭스 셀을 클릭하거나 '실적 추가'로 등록하세요.</p></div>`;
        return;
    }

    // 카테고리 정렬·분류: SCI → 특허(출원·등록) → 비SCI → SW → 기술문서
    const CAT_ORDER = ['scie', 'patentApp', 'patentReg', 'nonScie', 'swReg', 'techDoc'];
    const PRIMARY = ['scie', 'patentApp', 'patentReg']; // 기본 노출 (SCI·특허)
    const catRank = c => { const i = CAT_ORDER.indexOf(c); return i < 0 ? 99 : i; };
    const isPrimary = a => PRIMARY.includes(a.category);
    const showAll = !!state.achShowAll;
    const secCount = ach.filter(a => !isPrimary(a)).length;

    // 연도별 그룹화
    const groups = {};
    ach.forEach(a => {
        const r = rowInfo[a.rowKey];
        const y = (r && r.year) ? String(r.year) : '미지정';
        (groups[y] = groups[y] || []).push(a);
    });
    const years = Object.keys(groups).sort((a, b) => {
        if (a === '미지정') return 1;
        if (b === '미지정') return -1;
        return Number(b) - Number(a); // 최근 연도부터
    });

    const itemHtml = a => {
        const r = rowInfo[a.rowKey];
        const label = r ? `${r.stage} · ${r.yearLabel || ''}` : '미지정';
        return `<div class="ach-item">
            <div class="ach-cat ${a.category}">${CAT_LABEL[a.category] || a.category}</div>
            <div class="ach-body">
                <div class="ach-title">${escHtmlSafe(a.title)}</div>
                <div class="ach-meta">
                    <span><i class="fas fa-layer-group"></i> ${escHtmlSafe(label)}</span>
                    <span><i class="fas fa-scale-balanced"></i> 기여도 ${fmtW((a.weight != null && !isNaN(a.weight)) ? Number(a.weight) : 1)}</span>
                    ${a.date ? `<span><i class="fas fa-calendar"></i> ${escHtmlSafe(a.date)}</span>` : ''}
                    ${a.link ? `<a href="${escHtmlSafe(a.link)}" target="_blank" rel="noopener"><i class="fas fa-link"></i> 근거</a>` : ''}
                </div>
                ${a.note ? `<div class="ach-note">${escHtmlSafe(a.note)}</div>` : ''}
            </div>
            <div class="ach-acts">
                <button class="mini-btn" data-edit-ach="${escHtmlSafe(a.key)}" title="실적 수정"><i class="fas fa-pen"></i></button>
                <button class="mini-btn del" data-del-ach="${escHtmlSafe(a.key)}" title="실적 삭제"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    };

    let html = years.map(y => {
        let items = groups[y].slice();
        if (!showAll) items = items.filter(isPrimary);
        if (!items.length) return '';
        // 카테고리 순 → 같은 항목은 최신순
        items.sort((a, b) => (catRank(a.category) - catRank(b.category)) || ((b.createdAt || 0) - (a.createdAt || 0)));
        return `<div class="ach-year-group">
            <div class="ach-year-label">${y === '미지정' ? '연도 미지정' : y + '년'}</div>
            ${items.map(itemHtml).join('')}
        </div>`;
    }).join('');

    if (!html) {
        html = `<div class="empty-state small"><i class="fas fa-clipboard-list"></i><p>SCI·특허 실적이 없습니다.${secCount ? " 아래 ‘더 보기’로 나머지 실적을 확인하세요." : ''}</p></div>`;
    }
    if (secCount > 0) {
        html += `<button class="tb-btn ach-toggle" id="achToggleBtn">${showAll
            ? '<i class="fas fa-chevron-up"></i> 접기 (SCI·특허만 보기)'
            : `<i class="fas fa-chevron-down"></i> 더 보기 (비SCI·SW·기술문서 ${secCount}건)`}</button>`;
    }

    achList.innerHTML = html;

    achList.querySelectorAll('[data-del-ach]').forEach(b => b.addEventListener('click', () => deleteAch(b.dataset.delAch)));
    achList.querySelectorAll('[data-edit-ach]').forEach(b => b.addEventListener('click', () => openAchForm(null, null, b.dataset.editAch)));
    const tg = document.getElementById('achToggleBtn');
    if (tg) tg.addEventListener('click', () => { state.achShowAll = !state.achShowAll; renderAchList(p, rows); });
}

// ==================== 모달 헬퍼 ====================
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ==================== 차년도 편집기 (과제 모달 내부) ====================
function targetInputsHtml(t) {
    t = t || {};
    return CATEGORIES.map(c =>
        `<label>${c.label}<input type="number" min="0" class="re-t" data-cat="${c.key}" value="${Number(t[c.key]) || 0}"></label>`
    ).join('');
}

function makeRowBlock(row) {
    row = row || {};
    const div = document.createElement('div');
    div.className = 'row-edit';
    div.dataset.key = row.key || '';
    div.innerHTML = `
        <div class="row-edit-meta">
            <input class="re-stage" placeholder="단계" value="${escHtmlSafe(row.stage || '')}">
            <input class="re-yearLabel" placeholder="차년도" value="${escHtmlSafe(row.yearLabel || '')}">
            <input class="re-year" placeholder="연도" value="${escHtmlSafe(row.year || '')}">
        </div>
        <div class="re-targets">${targetInputsHtml(row.targets)}</div>
        <button type="button" class="re-remove" title="이 행 삭제">&times;</button>`;
    div.querySelector('.re-remove').addEventListener('click', () => div.remove());
    return div;
}

function addRowBlock(row) {
    document.getElementById('rowsEditor').appendChild(makeRowBlock(row));
}

function collectEditorRows() {
    return Array.from(document.querySelectorAll('#rowsEditor .row-edit')).map((b, i) => {
        const targets = {};
        b.querySelectorAll('.re-t').forEach(inp => {
            targets[inp.dataset.cat] = Math.max(0, parseInt(inp.value, 10) || 0);
        });
        return {
            key: b.dataset.key || '',
            stage: b.querySelector('.re-stage').value.trim(),
            yearLabel: b.querySelector('.re-yearLabel').value.trim(),
            year: b.querySelector('.re-year').value.trim(),
            targets
        };
    });
}

// ==================== 과제 CRUD (메타 + 차년도/목표 통합) ====================
function openProjectForm(editKey) {
    const f = document.getElementById('projectForm');
    f.reset();
    f.dataset.editKey = editKey || '';
    document.getElementById('projectFormTitle').textContent = editKey ? '과제 수정' : '새 과제 추가';
    const editor = document.getElementById('rowsEditor');
    editor.innerHTML = '';

    if (editKey) {
        const p = state.projects[editKey];
        f.elements.name.value = p.name || '';
        f.elements.agency.value = p.agency || '';
        const rows = sortedRows(p);
        if (rows.length) rows.forEach(r => addRowBlock(r));
        else addRowBlock();
    } else {
        addRowBlock(); // 새 과제: 기본 1행 제공
    }
    openModal('projectFormModal');
}

async function saveProject(e) {
    e.preventDefault();
    const f = e.target;
    const name = f.elements.name.value.trim();
    const agency = f.elements.agency.value.trim();
    if (!name) return showAlert('과제명을 입력하세요.', 'error');

    // 차년도 행 수집: 단계·차년도 모두 빈 행은 무시, 한쪽만 입력되면 에러
    const rows = [];
    for (const r of collectEditorRows()) {
        if (!r.stage && !r.yearLabel) continue;
        if (!r.stage || !r.yearLabel) return showAlert('각 차년도 행에는 단계와 차년도를 모두 입력하세요.', 'error');
        rows.push(r);
    }

    const editKey = f.dataset.editKey;
    try {
        const projKey = editKey || database.ref('performance').push().key;
        const base = `performance/${projKey}`;
        const updates = {};
        updates[`${base}/name`] = name;
        updates[`${base}/agency`] = agency;
        if (!editKey) {
            updates[`${base}/order`] = Object.keys(state.projects).length;
            updates[`${base}/createdAt`] = firebase.database.ServerValue.TIMESTAMP;
        }

        // 행 reconcile: 기존 키는 유지(실적 연결 보존), 새 행은 새 키 발급
        const keptKeys = new Set();
        rows.forEach((r, i) => {
            const rowKey = r.key || database.ref(`${base}/rows`).push().key;
            keptKeys.add(rowKey);
            updates[`${base}/rows/${rowKey}`] = {
                stage: r.stage, yearLabel: r.yearLabel, year: r.year, order: i, targets: r.targets
            };
        });

        // 편집 시: 편집기에서 사라진 기존 행 + 거기 묶인 실적 삭제 (확인)
        if (editKey) {
            const p = state.projects[editKey] || {};
            const removed = Object.keys(p.rows || {}).filter(k => !keptKeys.has(k));
            if (removed.length) {
                const linked = Object.values(p.achievements || {}).filter(a => a && removed.includes(a.rowKey)).length;
                const msg = linked
                    ? `삭제되는 차년도 ${removed.length}개에 등록된 실적 ${linked}건도 함께 삭제됩니다. 계속할까요?`
                    : `차년도 ${removed.length}개가 삭제됩니다. 계속할까요?`;
                if (!confirm(msg)) return;
                removed.forEach(k => { updates[`${base}/rows/${k}`] = null; });
                Object.entries(p.achievements || {}).forEach(([ak, a]) => {
                    if (a && removed.includes(a.rowKey)) updates[`${base}/achievements/${ak}`] = null;
                });
            }
        }

        await database.ref().update(updates);
        if (!editKey) state.currentKey = projKey;
        closeModal('projectFormModal');
        showAlert('저장되었습니다.', 'success');
        await loadAllProjects();
    } catch (err) {
        console.error(err);
        showAlert('저장 실패: ' + err.message, 'error');
    }
}

async function deleteProject() {
    const p = currentProject();
    // 개요 모드이거나 유효한 과제가 선택되지 않았으면 중단 (전체 삭제 방지)
    if (!p || !state.currentKey || state.currentKey === OVERVIEW) {
        return showAlert('삭제할 과제를 드롭다운에서 먼저 선택하세요.', 'warning');
    }
    const key = state.currentKey;
    if (!confirm(`'${p.name}' 과제 1건과 해당 과제의 목표·실적만 삭제됩니다. (다른 과제는 유지) 계속할까요?`)) return;
    try {
        // 정확히 선택한 과제 경로만 삭제
        await database.ref(`performance/${key}`).remove();
        state.currentKey = OVERVIEW;
        showAlert('선택한 과제가 삭제되었습니다.', 'success');
        await loadAllProjects();
    } catch (err) {
        showAlert('삭제 실패: ' + err.message, 'error');
    }
}

// ==================== 실적 CRUD ====================
function openAchForm(rowKey, category, editId) {
    const p = currentProject();
    if (!p) return;
    const rows = sortedRows(p);
    if (!rows.length) return showAlert('먼저 차년도(목표)를 추가하세요.', 'warning');

    const f = document.getElementById('achForm');
    f.reset();
    f.dataset.editId = editId || '';
    document.getElementById('achFormTitle').textContent = editId ? '실적 수정' : '실적 추가';
    // 행 select 채우기
    f.elements.rowKey.innerHTML = rows.map(r =>
        `<option value="${escHtmlSafe(r.key)}">${escHtmlSafe(r.stage)} · ${escHtmlSafe(r.yearLabel || '')}${r.year ? ' (' + escHtmlSafe(r.year) + ')' : ''}</option>`
    ).join('');
    // 항목 select
    f.elements.category.innerHTML = CATEGORIES.map(c => `<option value="${c.key}">${c.label}</option>`).join('');

    if (editId) {
        const a = (p.achievements || {})[editId] || {};
        f.elements.rowKey.value = a.rowKey || (rowKey || '');
        f.elements.category.value = a.category || (category || 'scie');
        f.elements.title.value = a.title || '';
        f.elements.date.value = a.date || '';
        f.elements.link.value = a.link || '';
        f.elements.note.value = a.note || '';
        f.elements.weight.value = (a.weight != null && !isNaN(a.weight)) ? a.weight : 1;
    } else {
        if (rowKey) f.elements.rowKey.value = rowKey;
        if (category) f.elements.category.value = category;
    }
    openModal('achFormModal');
}

async function saveAch(e) {
    e.preventDefault();
    const f = e.target;
    const rowKey = f.elements.rowKey.value;
    const category = f.elements.category.value;
    const title = f.elements.title.value.trim();
    const date = f.elements.date.value.trim();
    const link = f.elements.link.value.trim();
    const note = f.elements.note.value.trim();
    const weight = parseFloat(f.elements.weight.value);
    if (!title) return showAlert('실적 제목을 입력하세요.', 'error');
    if (!(weight > 0)) return showAlert('기여도를 0보다 크게 입력하세요. (예: 0.5, 1)', 'error');

    const editId = f.dataset.editId;
    try {
        if (editId) {
            const prev = (currentProject().achievements || {})[editId] || {};
            await database.ref(`performance/${state.currentKey}/achievements/${editId}`).set({
                rowKey, category, title, date, link, note, weight,
                createdAt: prev.createdAt || firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            await database.ref(`performance/${state.currentKey}/achievements`).push().set({
                rowKey, category, title, date, link, note, weight,
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });
        }
        closeModal('achFormModal');
        showAlert(editId ? '실적이 수정되었습니다.' : '실적이 추가되었습니다.', 'success');
        await loadAllProjects();
    } catch (err) {
        showAlert('저장 실패: ' + err.message, 'error');
    }
}

async function deleteAch(achKey) {
    if (!confirm('이 실적을 삭제할까요?')) return;
    try {
        await database.ref(`performance/${state.currentKey}/achievements/${achKey}`).remove();
        showAlert('삭제되었습니다.', 'success');
        await loadAllProjects();
    } catch (err) {
        showAlert('삭제 실패: ' + err.message, 'error');
    }
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
    perfApp = document.getElementById('perfApp');
    projectSelect = document.getElementById('projectSelect');
    summaryCards = document.getElementById('summaryCards');
    matrixWrap = document.getElementById('matrixWrap');
    achList = document.getElementById('achList');
    overviewWrap = document.getElementById('overviewWrap');
    detailWrap = document.getElementById('detailWrap');
    trackWrap = document.getElementById('trackWrap');

    // Firebase
    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
    } catch (err) {
        console.error('Firebase 초기화 실패', err);
        return;
    }

    auth.onAuthStateChanged(async (user) => {
        if (user && ALLOWED_USERS.includes(user.uid)) {
            currentUser = user;
        } else {
            currentUser = null;
            // 외부(미등록) 계정만 로그아웃 — 다른 페이지 관리자는 세션 유지(이 페이지만 게이트)
            if (user && [ADMIN_UID, ROOT_UID].indexOf(user.uid) < 0) await auth.signOut();
        }
        updateAuthUI();
        if (currentUser) {
            try { await loadAllProjects(); } catch (e) { console.error(e); showAlert('데이터 로드 실패', 'error'); }
        }
    });

    // 로그인 모달
    loginBtn && loginBtn.addEventListener('click', () => loginModal.classList.add('open'));
    authGate && authGate.querySelector('#gateLoginBtn') && authGate.querySelector('#gateLoginBtn').addEventListener('click', () => loginModal.classList.add('open'));
    loginClose && loginClose.addEventListener('click', () => loginModal.classList.remove('open'));
    loginModal && loginModal.addEventListener('click', e => { if (e.target === loginModal) loginModal.classList.remove('open'); });
    logoutBtn && logoutBtn.addEventListener('click', async () => { await auth.signOut(); showAlert('로그아웃되었습니다.', 'success'); });

    loginForm && loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        try {
            await loginUser(email, password);
            loginModal.classList.remove('open');
            loginForm.reset();
            showAlert('로그인되었습니다.', 'success');
        } catch (err) {
            showAlert(err.message || '로그인 실패', 'error');
        }
    });

    // 과제 선택/관리
    projectSelect && projectSelect.addEventListener('change', () => { state.currentKey = projectSelect.value; renderCurrent(); });
    document.getElementById('addProjectBtn').addEventListener('click', () => openProjectForm());
    const editProject = () => {
        if (currentProject()) return openProjectForm(state.currentKey);
        showAlert(Object.keys(state.projects).length ? '드롭다운에서 수정할 과제를 먼저 선택하세요.' : '먼저 과제를 추가하세요.', 'warning');
    };
    document.getElementById('editProjectBtn').addEventListener('click', editProject);
    document.getElementById('editProjectBtn2').addEventListener('click', editProject);
    document.getElementById('deleteProjectBtn').addEventListener('click', deleteProject);

    // 매트릭스 관리
    document.getElementById('addAchBtn').addEventListener('click', () => openAchForm());
    // 과제 모달 내부: 차년도 행 추가
    document.getElementById('addRowBlockBtn').addEventListener('click', () => addRowBlock());

    // 논문/특허 트래커
    document.getElementById('addPaperBtn').addEventListener('click', () => openPaperForm());
    document.getElementById('addPatentBtn').addEventListener('click', () => openPatentForm());
    document.getElementById('addPaperContribBtn').addEventListener('click', () => document.getElementById('paperContribs').appendChild(makeContribRow(paperCols(), {})));
    document.getElementById('addPatentContribBtn').addEventListener('click', () => document.getElementById('patentContribs').appendChild(makeContribRow(patentCols(), {})));
    document.getElementById('paperColsBtn').addEventListener('click', () => editColumns('paper'));
    document.getElementById('patentColsBtn').addEventListener('click', () => editColumns('patent'));
    document.getElementById('paperTargetBtn').addEventListener('click', () => openTargetForm('paper'));
    document.getElementById('patentTargetBtn').addEventListener('click', () => openTargetForm('patent'));
    document.getElementById('paperMemoBtn').addEventListener('click', () => editMemo('paper'));
    document.getElementById('patentMemoBtn').addEventListener('click', () => editMemo('patent'));
    document.getElementById('paperYearSel').addEventListener('change', (e) => { state.paperYear = Number(e.target.value); renderPaperSection(); });

    // 폼 제출
    document.getElementById('projectForm').addEventListener('submit', saveProject);
    document.getElementById('achForm').addEventListener('submit', saveAch);
    document.getElementById('paperForm').addEventListener('submit', savePaper);
    document.getElementById('patentForm').addEventListener('submit', savePatent);
    document.getElementById('targetForm').addEventListener('submit', saveTargets);

    // 모달 닫기 버튼 (공통)
    document.querySelectorAll('[data-close]').forEach(b => {
        b.addEventListener('click', () => closeModal(b.dataset.close));
    });
    // 편집/입력 모달(.perf-modal)은 바깥 클릭으로 닫지 않음 (입력 중 실수 닫힘 방지) — 닫기/취소/저장 버튼으로만 닫힘
});
