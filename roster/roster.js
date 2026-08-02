// roster.js - Lab 인원 기본 정보 (로그인 전용)
// 설정값은 config.js 참조 (firebaseConfig, ADMIN_UID, ROOT_UID)
//
// DB 경로: labnote/roster = { members: [...], columns: [...], updatedAt }
//   → labnote 노드의 규칙(ADMIN_UID + ROOT_UID)을 그대로 상속하므로 Firebase 규칙 추가 작업이 필요 없다.
//   → labnote.js 는 groups/bodies/calendar 만 update() 하므로 roster 를 건드리지 않는다.
//
// 구분: 한 페이지 안에서 재학 / 졸업 / 파트 탭으로 나눈다 (멤버의 group 필드).
// 입력: ① CSV 가져오기(노션 표 내보내기) ② 열 일괄 입력(엑셀·노션 열 붙여넣기) ③ 인원 추가 모달
//
// ⚠ 개인정보(전화번호·생년월일·과학기술인번호)가 들어가는 페이지다.
//   저장소는 공개(GitHub Pages)이므로 실제 데이터는 절대 코드에 넣지 않는다. Firebase 에만 둔다.

// ==================== 상수 ====================
const RS_ALLOWED = [ADMIN_UID, ROOT_UID];   // labnote 와 동일 권한
const RS_PATH = 'labnote/roster';

// 인원 구분 탭
const RS_GROUPS = [
    { key: 'current', label: '재학', ic: 'fa-user-graduate' },
    { key: 'alumni',  label: '졸업', ic: 'fa-user-check' },
    { key: 'part',    label: '파트', ic: 'fa-user-clock' }
];
const RS_GKEYS = RS_GROUPS.map(g => g.key);
function groupLabel(k) { const g = RS_GROUPS.find(x => x.key === k); return g ? g.label : k; }

// 기본 열. core:true 는 '주요 항목만' 보기에서도 보이는 열
//   csv  : CSV 가져오기에서 인식할 머리글 이름들(별칭 포함)
//   only : 해당 탭에서만 보이는 열 (파트 CSV 의 '소속!' = 파견 나간 기관)
const RS_FIELDS = [
    { key: 'name',       label: '이름',           csv: ['이름'],                                 core: true },
    { key: 'nameEn',     label: '영문이름',       csv: ['영문이름', 'English Name'] },
    { key: 'position',   label: '직위',           csv: ['직위'],                                 core: true },
    { key: 'dept',       label: '소속',           csv: ['소속'] },
    { key: 'org',        label: '소속기관',       csv: ['소속!', '소속기관', '기관'], core: true, only: 'part' },
    { key: 'advisor',    label: '지도교수',       csv: ['지도교수'],                             core: true },
    { key: 'sid',        label: '학번',           csv: ['학번'],                                 core: true },
    { key: 'email',      label: '이메일',         csv: ['이메일', 'email'],                      core: true },
    { key: 'phone',      label: '전화번호',       csv: ['전화번호', '연락처'], core: true, sensitive: true },
    { key: 'birth',      label: '생년월일',       csv: ['생일', '생년월일'],                     sensitive: true },
    { key: 'sciNo',      label: '과학기술인번호', csv: ['과학기술인번호'],                       sensitive: true },
    { key: 'period',     label: 'Lab 활동기간',   csv: ['Lab 활동기간', '활동기간'],             core: true },
    { key: 'school',     label: '최종학교/전공',  csv: ['최종학교/전공명', '최종학교/전공'] },
    { key: 'degreeYear', label: '학위취득',       csv: ['학위취득연도', '학위취득'] },
    { key: 'status',     label: '상태',           csv: ['기본개인정보', '상태', '재학여부'] }
];

// 직위 정렬 순서 + 배지 색 구분
const RS_POS_ORDER = ['교수', '박사후연구원', '박사과정', '석박사과정', '학석사과정', '석사과정', '학부과정', '연구원', '졸업'];
function posClass(p) {
    p = String(p || '');
    if (p.indexOf('박사') >= 0) return 'phd';
    if (p.indexOf('석사') >= 0) return 'ms';
    if (p.indexOf('학부') >= 0) return 'bs';
    return 'etc';
}
function posRank(p) {
    const i = RS_POS_ORDER.indexOf(String(p || '').trim());
    return i < 0 ? 900 : i;
}

// Lab 활동기간 정렬용 키 — 시작 시점을 YYYYMM 숫자로 뽑는다.
// 표기가 제각각이라(2023.06 ~ / 2024 ~ / 26.06~ / 2021 ~ 2023 / 석박사과정 (2022.3~))
// 문자열 비교로는 안 맞는다. 값이 없으면 맨 뒤로 보낸다.
function periodKey(v) {
    const m = String(v || '').match(/(\d{2,4})\s*[.\-\/년]?\s*(\d{1,2})?/);
    if (!m) return 999999;
    let y = parseInt(m[1], 10);
    if (m[1].length <= 2) y = (y >= 50 ? 1900 : 2000) + y;   // 26 → 2026
    const mo = m[2] ? Math.min(12, Math.max(1, parseInt(m[2], 10))) : 0;
    return y * 100 + mo;
}

// ==================== 전역 상태 ====================
let auth, database, currentUser = null;
const state = {
    members: [],        // [{id, group, name, ..., ext:{추가열id: 값}}]
    columns: [],        // 사용자가 추가한 열 [{id, label}]
    updatedAt: '',
    group: 'current',   // 지금 보고 있는 탭
    q: '',              // 검색어
    posFilter: '',      // 직위 필터 ('' = 전체)
    sortKey: 'period',  // 기본 정렬: Lab 활동기간(먼저 들어온 사람이 위)
    sortAsc: true,
    masked: false,      // 민감정보 가리기
    compact: false,     // false = 전체 항목(기본), true = 주요 항목만
    editId: null,       // 수정 중인 인원 id (null = 신규)
    bulkKey: '',        // 일괄 입력 중인 열 key
    colEditId: null,    // 이름 변경 중인 추가 열 id (null = 새 열 추가)
    parsed: null        // CSV 가져오기 미리보기 결과
};

// DOM refs
let loginBtn, logoutBtn, loginModal, loginClose, loginForm, userInfo, userName;
let authGate, rsApp, rsHead, rsBody, rsChips, rsTabs, rsCount, rsEmpty, rsSave, rsSearch, rsColMenu;

// ==================== 유틸 ====================
function esc(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toArr(v) {
    if (Array.isArray(v)) return v.filter(x => x != null);
    if (v && typeof v === 'object') return Object.values(v).filter(x => x != null);   // Firebase 가 배열을 객체로 줄 때
    return [];
}
let seq = 0;
function newId(p) { return (p || 'm') + Date.now().toString(36) + (seq++).toString(36); }

function showAlert(message, type) {
    const el = document.createElement('div');
    el.className = 'perf-alert ' + (type || 'info');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3400);
}
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function hhmm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

// ---- 값 정리 ----
// 노션에서 내보내면 이메일에 'mailto:' 접두어가 붙어 오는 경우가 있다.
function cleanEmail(v) {
    let s = String(v == null ? '' : v).trim();
    if (/^mailto:/i.test(s)) s = s.slice(7).trim();
    return s;
}
function cleanPhone(v) {
    const s = String(v == null ? '' : v).trim();
    const d = s.replace(/[^0-9]/g, '');
    if (d.length === 11) return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
    if (d.length === 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return s;
}
// 생일은 YYMMDD 6자리로 들어온다 (예: 030110 → 2003-01-10)
function birthDisp(v) {
    const d = String(v == null ? '' : v).replace(/[^0-9]/g, '');
    if (d.length === 6) {
        const yy = parseInt(d.slice(0, 2), 10);
        const year = yy >= 50 ? 1900 + yy : 2000 + yy;
        return year + '-' + d.slice(2, 4) + '-' + d.slice(4, 6);
    }
    if (d.length === 8) return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
    return String(v == null ? '' : v).trim();
}
// 줄바꿈·중복 공백 정리 (붙여넣기 값에 줄바꿈·앞뒤 공백이 섞여 오는 경우가 많다)
function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

// 열 종류에 맞게 입력값을 정리
function normVal(key, v) {
    const s = clean(v);
    if (key === 'email') return cleanEmail(s);
    if (key === 'phone') return cleanPhone(s);
    if (key === 'birth' || key === 'sciNo') return s.replace(/\s/g, '');
    return s;
}

// ---- 민감정보 마스킹 (화면 공유용) ----
function maskVal(key, disp) {
    if (key === 'phone') {
        const p = String(disp).split('-');
        return p.length === 3 ? p[0] + '-••••-' + p[2] : '•••••••';
    }
    if (key === 'birth') return String(disp).slice(0, 4) + '-••-••';
    if (key === 'sciNo') return String(disp).slice(0, 3) + '•'.repeat(Math.max(0, String(disp).length - 3));
    return '••••';
}

// 화면 표시값 (마스킹 전)
function dispVal(key, raw) {
    if (key === 'birth') return birthDisp(raw);
    if (key === 'phone') return cleanPhone(raw);
    if (key === 'email') return cleanEmail(raw);
    return String(raw == null ? '' : raw).trim();
}

// ==================== 열 / 값 접근 ====================
// 지금 탭에서 쓰는 기본 열 (only 가 걸린 열은 해당 탭에서만)
function baseFields() {
    return RS_FIELDS.filter(f => !f.only || f.only === state.group);
}
// 기본 열 + 사용자가 추가한 열
function allFields() {
    return baseFields().concat(state.columns.map(c => ({ key: c.id, label: c.label, custom: true })));
}
// 지금 표에 보이는 열 ('주요 항목만' 이어도 추가한 열은 항상 보인다)
function visibleFields() {
    const base = state.compact ? baseFields().filter(f => f.core) : baseFields();
    return base.concat(state.columns.map(c => ({ key: c.id, label: c.label, custom: true })));
}
function fieldOf(key) { return allFields().find(f => f.key === key) || null; }

function getVal(m, f) {
    if (!m || !f) return '';
    return String((f.custom ? (m.ext || {})[f.key] : m[f.key]) || '');
}
function setVal(m, f, v) {
    if (!m || !f) return;
    if (f.custom) { if (!m.ext) m.ext = {}; m.ext[f.key] = v; }
    else m[f.key] = v;
}
// 빈 멤버 한 명
function blankMember(group) {
    const m = { id: newId(), group: group || state.group, ext: {} };
    RS_FIELDS.forEach(f => { m[f.key] = ''; });
    return m;
}

// ==================== 인증 ====================
async function loginUser(email, password) {
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
    if (rsApp) rsApp.style.display = authed ? 'block' : 'none';
}

// ==================== 로드 / 저장 ====================
function normalizeMembers(list) {
    return toArr(list).map(m => {
        const o = (m && typeof m === 'object') ? m : {};
        const out = { id: o.id || newId(), ext: {} };
        // group 이 없던 시절 데이터는 재학으로 본다
        out.group = RS_GKEYS.indexOf(o.group) >= 0 ? o.group : 'current';
        RS_FIELDS.forEach(f => { out[f.key] = String(o[f.key] == null ? '' : o[f.key]).trim(); });
        if (o.ext && typeof o.ext === 'object') {
            Object.keys(o.ext).forEach(k => { out.ext[k] = String(o.ext[k] == null ? '' : o.ext[k]).trim(); });
        }
        return out;
    }).filter(m => m.name);
}
function normalizeColumns(list) {
    return toArr(list)
        .map(c => (c && typeof c === 'object') ? { id: String(c.id || newId('c')), label: String(c.label || '새 열').trim() } : null)
        .filter(Boolean);
}

async function loadData() {
    setSaveStat('', '불러오는 중...');
    const snap = await database.ref(RS_PATH).once('value');
    const v = snap.val() || {};
    state.members = normalizeMembers(v.members !== undefined ? v.members : v);
    state.columns = normalizeColumns(v.columns);
    state.updatedAt = v.updatedAt || '';
    setSaveStat('ok', state.updatedAt ? '최종 수정 ' + state.updatedAt : '동기화됨');
}

async function saveData() {
    if (!currentUser) return false;
    const now = new Date();
    const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' +
                  String(now.getDate()).padStart(2, '0') + ' ' + hhmm(now);
    setSaveStat('', '저장 중...');
    try {
        await database.ref(RS_PATH).set({ members: state.members, columns: state.columns, updatedAt: stamp });
        state.updatedAt = stamp;
        setSaveStat('ok', '저장됨 ' + hhmm(now));
        return true;
    } catch (err) {
        setSaveStat('err', '저장 실패');
        showAlert('저장 실패: ' + err.message, 'error');
        return false;
    }
}

function setSaveStat(cls, text) {
    if (!rsSave) return;
    rsSave.className = 'rs-save' + (cls ? ' ' + cls : '');
    rsSave.textContent = text || '';
}

// ==================== CSV ====================
// 따옴표 안의 쉼표·줄바꿈까지 처리하는 CSV 파서
function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else inQ = false;
            } else cell += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') { row.push(cell); cell = ''; }
        else if (c === '\r') { /* CRLF 무시 */ }
        else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

// 머리글 → 필드 키 매핑. 인식 못한 열은 무시한다.
// '소속' 과 '소속!' 처럼 비슷한 이름이 같이 오므로 정확 일치로만 판정한다.
function mapHeader(headerRow) {
    const map = {};
    const used = {};
    headerRow.forEach((h, i) => {
        const t = clean(h);
        if (!t) return;
        const f = RS_FIELDS.find(f => f.csv.some(c => c.toLowerCase() === t.toLowerCase()));
        if (f && !used[f.key]) { map[i] = f.key; used[f.key] = true; }
    });
    return map;
}

// CSV 텍스트 → 인원 배열 { ok, members, cols, error }
function csvToMembers(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { ok: false, error: '내용이 없거나 머리글만 있습니다. 머리글 한 줄 + 인원 줄이 필요합니다.' };

    const map = mapHeader(rows[0]);
    const cols = Object.values(map);
    if (cols.indexOf('name') < 0) {
        return { ok: false, error: '‘이름’ 열을 찾지 못했습니다. 첫 줄이 머리글(이름 · 직위 · 이메일 …)인지 확인해 주세요.' };
    }

    const members = [];
    for (let r = 1; r < rows.length; r++) {
        const o = {};
        Object.keys(map).forEach(i => { o[map[i]] = normVal(map[i], rows[r][i]); });
        if (!o.name) continue;   // 이름 없는 줄은 건너뜀
        members.push(o);
    }
    if (!members.length) return { ok: false, error: '이름이 있는 줄을 찾지 못했습니다.' };
    return { ok: true, members, cols };
}

function openImport() {
    document.getElementById('rsFile').value = '';
    document.getElementById('rsFileName').textContent = 'CSV 파일 선택';
    document.getElementById('rsPaste').value = '';
    document.getElementById('rsPreview').style.display = 'none';
    state.parsed = null;

    // 대상 탭은 지금 보고 있는 탭이 기본값
    document.getElementById('rsImpGroup').innerHTML = RS_GROUPS.map(g =>
        '<label><input type="radio" name="rsImpG" value="' + g.key + '"' + (g.key === state.group ? ' checked' : '') + '> ' +
        esc(g.label) + '</label>').join('');

    openModal('rsImportModal');
}

function previewImport(text) {
    const box = document.getElementById('rsPreview');
    if (!String(text || '').trim()) { box.style.display = 'none'; state.parsed = null; return; }

    const res = csvToMembers(text);
    box.style.display = 'block';
    if (!res.ok) {
        box.className = 'rs-preview bad';
        box.innerHTML = '<i class="fas fa-triangle-exclamation"></i> ' + esc(res.error);
        state.parsed = null;
        return;
    }
    state.parsed = res.members;
    const labels = res.cols.map(k => (RS_FIELDS.find(f => f.key === k) || {}).label).filter(Boolean);
    const heads = parseCsv(text)[0].map(clean).filter(Boolean);
    const unknown = heads.filter(h => !RS_FIELDS.some(f => f.csv.some(c => c.toLowerCase() === h.toLowerCase())));

    box.className = 'rs-preview ok';
    box.innerHTML = '<i class="fas fa-circle-check"></i> <b>' + res.members.length + '명</b> 인식됨' +
        '<br>인식된 항목: ' + esc(labels.join(' · ')) +
        (unknown.length ? '<br><span class="rs-warn">무시된 열: ' + esc(unknown.join(' · ')) + '</span>' : '') +
        '<br>첫 번째: <b>' + esc(res.members[0].name) + '</b>' +
        (res.members[0].position ? ' (' + esc(res.members[0].position) + ')' : '');
}

async function applyImport() {
    if (!state.parsed || !state.parsed.length) { showAlert('먼저 CSV 파일을 선택하거나 붙여넣어 주세요.', 'warning'); return; }
    const g = (document.querySelector('input[name="rsImpG"]:checked') || {}).value || 'current';
    const mode = (document.querySelector('input[name="rsMode"]:checked') || {}).value || 'merge';
    const inG = state.members.filter(m => m.group === g);

    let added = 0, updated = 0;
    if (mode === 'replace') {
        if (!confirm(groupLabel(g) + ' 탭의 기존 ' + inG.length + '명을 지우고 CSV의 ' + state.parsed.length + '명으로 교체합니다.\n다른 탭은 그대로 둡니다. 진행할까요?')) return;
        const others = state.members.filter(m => m.group !== g);
        const fresh = state.parsed.map(o => Object.assign(blankMember(g), o, { group: g }));
        state.members = others.concat(fresh);
        added = fresh.length;
    } else {
        // 병합: 같은 탭 안에서 이름이 같으면 값이 있는 항목만 덮어쓰고, 없으면 새로 추가
        state.parsed.forEach(o => {
            const hit = state.members.find(m => m.group === g && clean(m.name) === clean(o.name));
            if (hit) {
                Object.keys(o).forEach(k => { if (o[k]) hit[k] = o[k]; });
                updated++;
            } else {
                state.members.push(Object.assign(blankMember(g), o, { group: g }));
                added++;
            }
        });
    }

    if (await saveData()) {
        closeModal('rsImportModal');
        state.group = g;                                     // 방금 넣은 탭으로 이동
        state.q = ''; rsSearch.value = ''; state.posFilter = '';
        render();
        showAlert(groupLabel(g) + ' 탭 · 추가 ' + added + '명' + (updated ? ' · 갱신 ' + updated + '명' : ''), 'success');
    }
}

// ==================== 표 렌더 ====================
function inGroup() { return state.members.filter(m => m.group === state.group); }

function filtered() {
    const q = state.q.trim().toLowerCase();
    const fields = allFields();
    const list = inGroup().filter(m => {
        if (state.posFilter && clean(m.position) !== state.posFilter) return false;
        if (!q) return true;
        return fields.some(f => getVal(m, f).toLowerCase().indexOf(q) >= 0);
    });

    const kf = state.sortKey ? fieldOf(state.sortKey) : null;
    if (!kf) return list;

    return list.slice().sort((a, b) => {
        let r;
        if (state.sortKey === 'period') r = periodKey(a.period) - periodKey(b.period);
        else if (state.sortKey === 'position') r = posRank(a.position) - posRank(b.position);
        else r = getVal(a, kf).localeCompare(getVal(b, kf), 'ko', { numeric: true });
        // 값이 같으면 입력 순서 그대로 둔다(정렬이 안정적이라 0을 돌려주면 유지됨).
        // 이름만 붙여넣은 직후엔 활동기간이 모두 비어 동점이 되는데, 여기서 이름순으로
        // 다시 늘어놓으면 다음 열을 붙여넣을 때 값이 엉뚱한 사람에게 들어간다.
        if (r === 0) return 0;
        return state.sortAsc ? r : -r;
    });
}

function renderTabs() {
    rsTabs.innerHTML = RS_GROUPS.map(g => {
        const n = state.members.filter(m => m.group === g.key).length;
        return '<button class="rs-tab' + (state.group === g.key ? ' active' : '') + '" data-g="' + g.key + '">' +
               '<i class="fas ' + g.ic + '"></i> ' + esc(g.label) + '<span class="n">' + n + '</span></button>';
    }).join('');
    rsTabs.querySelectorAll('.rs-tab').forEach(b => {
        b.addEventListener('click', () => {
            if (state.group === b.dataset.g) return;
            state.group = b.dataset.g;
            state.posFilter = '';
            if (state.sortKey && !fieldOf(state.sortKey)) state.sortKey = 'period';   // 탭 전용 열로 정렬 중이었다면 복귀
            render();
        });
    });
}

function renderChips() {
    const counts = {};
    inGroup().forEach(m => {
        const p = clean(m.position) || '미지정';
        counts[p] = (counts[p] || 0) + 1;
    });
    const keys = Object.keys(counts).sort((a, b) => posRank(a) - posRank(b) || a.localeCompare(b, 'ko'));
    if (keys.length < 2) { rsChips.innerHTML = ''; rsChips.style.display = 'none'; return; }

    rsChips.style.display = 'flex';
    let html = '<button class="rs-chip' + (state.posFilter ? '' : ' active') + '" data-pos="">전체<span class="n">' + inGroup().length + '</span></button>';
    keys.forEach(p => {
        html += '<button class="rs-chip' + (state.posFilter === p ? ' active' : '') + '" data-pos="' + esc(p) + '">' +
                esc(p) + '<span class="n">' + counts[p] + '</span></button>';
    });
    rsChips.innerHTML = html;
    rsChips.querySelectorAll('.rs-chip').forEach(b => {
        b.addEventListener('click', () => { state.posFilter = b.dataset.pos; render(); });
    });
}

// 이메일 칸: 'a@x / b@y' 처럼 여러 개가 들어 있는 경우가 있어 각각 링크로 만든다.
function emailHtml(disp) {
    if (/^https?:\/\//i.test(disp)) {
        return '<a href="' + esc(disp) + '" target="_blank" rel="noopener noreferrer">링크 <i class="fas fa-external-link-alt" style="font-size:.8em"></i></a>';
    }
    const parts = disp.split(/\s*\/\s*/).filter(s => s !== '');
    return parts.map(p => p.indexOf('@') >= 0 ? '<a href="mailto:' + esc(p) + '">' + esc(p) + '</a>' : esc(p))
                .join('<span class="rs-dim"> / </span>');
}

function cellHtml(m, f) {
    const raw = getVal(m, f).trim();
    if (!raw) return '<span class="rs-dim">—</span>';

    const disp = dispVal(f.key, raw);
    if (f.sensitive && state.masked) return '<span class="rs-mono rs-dim">' + esc(maskVal(f.key, disp)) + '</span>';

    if (f.key === 'name') return '<span class="rs-name">' + esc(disp) + '</span>';
    if (f.key === 'nameEn') return '<span class="rs-en">' + esc(disp) + '</span>';
    if (f.key === 'position') return '<span class="rs-pos ' + posClass(disp) + '">' + esc(disp) + '</span>';
    if (f.key === 'org') return '<span class="rs-org">' + esc(disp) + '</span>';
    if (f.key === 'status') {
        const off = disp.indexOf('재학') < 0;
        return '<span class="rs-st' + (off ? ' off' : '') + '">' + esc(disp) + '</span>';
    }
    if (f.key === 'email') return emailHtml(disp);
    if (f.key === 'phone' || f.key === 'birth' || f.key === 'sciNo' || f.key === 'sid') {
        return '<span class="rs-mono">' + esc(disp) + '</span>';
    }
    return esc(disp);
}

function render() {
    const fields = visibleFields();
    const list = filtered();
    const total = inGroup().length;

    renderTabs();

    // 머리글 (클릭=정렬, ⋯=열 메뉴)
    rsHead.innerHTML = '<tr>' + fields.map(f => {
        const on = state.sortKey === f.key;
        const ic = on ? (state.sortAsc ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort';
        return '<th class="' + (on ? 'sorted' : '') + (f.custom ? ' th-custom' : '') + '" data-key="' + esc(f.key) + '">' +
               '<span class="rs-th-in">' +
                 '<span class="rs-th-label">' + esc(f.label) + '</span>' +
                 '<i class="fas ' + ic + ' sort-ic"></i>' +
                 '<button class="rs-th-menu" data-menu="' + esc(f.key) + '" title="열 메뉴"><i class="fas fa-ellipsis-vertical"></i></button>' +
               '</span></th>';
    }).join('') + '<th class="th-act"></th></tr>';

    rsHead.querySelectorAll('th[data-key]').forEach(th => {
        th.addEventListener('click', () => {
            const k = th.dataset.key;
            if (state.sortKey === k) state.sortAsc = !state.sortAsc;
            else { state.sortKey = k; state.sortAsc = true; }
            render();
        });
    });
    rsHead.querySelectorAll('.rs-th-menu').forEach(b => {
        b.addEventListener('click', e => { e.stopPropagation(); openColMenu(b, b.dataset.menu); });
    });

    // 본문
    rsEmpty.style.display = total ? 'none' : 'block';
    document.getElementById('rsEmptyTab').textContent = groupLabel(state.group);
    if (!total) {
        rsChips.innerHTML = ''; rsChips.style.display = 'none';
        rsBody.innerHTML = '<tr class="rs-none"><td colspan="' + (fields.length + 1) + '">' +
            esc(groupLabel(state.group)) + ' 탭에 등록된 인원이 없습니다.</td></tr>';
        rsCount.textContent = '';
        return;
    }

    if (!list.length) {
        rsBody.innerHTML = '<tr class="rs-none"><td colspan="' + (fields.length + 1) + '">조건에 맞는 인원이 없습니다.</td></tr>';
    } else {
        rsBody.innerHTML = list.map(m =>
            '<tr>' + fields.map(f => '<td>' + cellHtml(m, f) + '</td>').join('') +
            '<td><button class="rs-edit" data-id="' + esc(m.id) + '" title="수정"><i class="fas fa-pen"></i></button></td></tr>'
        ).join('');
        rsBody.querySelectorAll('.rs-edit').forEach(b => {
            b.addEventListener('click', () => openForm(b.dataset.id));
        });
    }

    rsCount.textContent = (list.length === total)
        ? groupLabel(state.group) + ' ' + total + '명'
        : list.length + ' / ' + total + '명';

    renderChips();
}

// ==================== 열 머리글 ⋯ 메뉴 ====================
function closeColMenu() { if (rsColMenu) rsColMenu.style.display = 'none'; }

function openColMenu(btn, key) {
    const f = fieldOf(key);
    if (!f) return;

    const items = [{ ic: 'fa-paste', text: '열 일괄 입력', fn: () => openBulk(key) }];
    if (f.custom) {
        items.push({ ic: 'fa-pen', text: '열 이름 변경', fn: () => openColForm(key) });
        items.push({ ic: 'fa-trash', text: '열 삭제', danger: true, fn: () => deleteColumn(key) });
    }

    rsColMenu.innerHTML = items.map((it, i) =>
        '<button class="rs-cm-item' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' +
        '<i class="fas ' + it.ic + '"></i> ' + esc(it.text) + '</button>'
    ).join('');

    const r = btn.getBoundingClientRect();
    rsColMenu.style.display = 'block';
    const w = rsColMenu.offsetWidth || 170;
    rsColMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
    rsColMenu.style.top = (r.bottom + 4) + 'px';

    rsColMenu.querySelectorAll('.rs-cm-item').forEach(b => {
        b.addEventListener('click', () => { closeColMenu(); items[+b.dataset.i].fn(); });
    });
}

// ==================== 열 추가 / 이름변경 / 삭제 ====================
function openColForm(colId) {
    state.colEditId = colId || null;
    const c = colId ? state.columns.find(x => x.id === colId) : null;
    document.getElementById('rsColTitle').textContent = c ? '열 이름 변경' : '열 추가';
    const input = document.getElementById('rsColName');
    input.value = c ? c.label : '';
    openModal('rsColModal');
    setTimeout(() => input.focus(), 50);
}

async function submitColForm(e) {
    e.preventDefault();
    const label = document.getElementById('rsColName').value.trim();
    if (!label) { showAlert('열 이름을 입력해 주세요.', 'warning'); return; }

    const dup = RS_FIELDS.concat(state.columns.map(c => ({ key: c.id, label: c.label })))
        .some(f => f.label === label && f.key !== state.colEditId);
    if (dup) { showAlert('같은 이름의 열이 이미 있습니다.', 'warning'); return; }

    if (state.colEditId) {
        const c = state.columns.find(x => x.id === state.colEditId);
        if (c) c.label = label;
    } else {
        state.columns.push({ id: newId('c'), label });
    }

    if (await saveData()) {
        closeModal('rsColModal');
        showAlert(state.colEditId ? '열 이름을 바꿨습니다.' : '‘' + label + '’ 열을 추가했습니다.', 'success');
        render();
    }
}

async function deleteColumn(colId) {
    const c = state.columns.find(x => x.id === colId);
    if (!c) return;
    const filled = state.members.filter(m => (m.ext || {})[colId]).length;
    const msg = '‘' + c.label + '’ 열을 삭제할까요?' + (filled ? '\n입력된 값 ' + filled + '건도 함께 지워집니다.' : '');
    if (!confirm(msg)) return;

    state.columns = state.columns.filter(x => x.id !== colId);
    state.members.forEach(m => { if (m.ext) delete m.ext[colId]; });
    if (state.sortKey === colId) state.sortKey = 'period';

    if (await saveData()) { showAlert('열을 삭제했습니다.', 'success'); render(); }
}

// ==================== 열 일괄 입력 ====================
// 붙여넣은 텍스트 → 줄 배열 (끝쪽 빈 줄만 제거)
function splitLines(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    return lines;
}

function openBulk(key) {
    const f = fieldOf(key);
    if (!f) return;
    state.bulkKey = key;

    const rows = filtered();
    const isName = (key === 'name');
    const narrowed = (state.q.trim() || state.posFilter);

    document.getElementById('rsBulkTitle').textContent = f.label + ' 열 일괄 입력';
    document.getElementById('rsBulkHint').innerHTML =
        '<b>' + esc(groupLabel(state.group)) + '</b> 탭에 적용됩니다. ' +
        '엑셀·노션에서 <b>' + esc(f.label) + '</b> 열을 복사해 그대로 붙여넣으세요. ' +
        '<b>한 줄에 한 명</b>씩, 지금 표에 보이는 <b>위에서 아래 순서</b>대로 채워집니다.' +
        (isName
            ? '<br>줄이 현재 인원보다 많으면 <b>그만큼 인원이 새로 만들어집니다.</b> (빈 줄은 건너뜁니다)'
            : '<br>줄이 현재 인원보다 많으면 넘치는 줄은 무시됩니다. 빈 줄은 그 칸을 비웁니다.') +
        '<br>탭이 포함된 <b>여러 열</b>을 한꺼번에 붙여넣으면 이 열부터 오른쪽으로 차례대로 채웁니다.' +
        (state.sortKey ? '<br>지금 표는 <b>' + esc((fieldOf(state.sortKey) || {}).label || '') +
            '</b> 순서입니다. 아래 <b>적용 미리보기</b>로 누구에게 어떤 값이 들어가는지 확인하세요.' : '') +
        (narrowed ? '<br><b class="rs-warn">지금 검색·필터가 걸려 있어 보이는 ' + rows.length + '명에만 적용됩니다.</b>' : '');

    document.getElementById('rsBulkText').value = rows.map(m => getVal(m, f)).join('\n');
    updateBulkStat();
    openModal('rsBulkModal');
    setTimeout(() => document.getElementById('rsBulkText').focus(), 50);
}

function updateBulkStat() {
    const lines = splitLines(document.getElementById('rsBulkText').value);
    const rows = filtered();
    const isName = (state.bulkKey === 'name');
    const nonEmpty = lines.filter(l => l.trim() !== '').length;

    let msg = '붙여넣은 줄 <b>' + lines.length + '</b> · 현재 표 <b>' + rows.length + '</b>행';
    if (isName && lines.length > rows.length) {
        msg += ' · <b style="color:#1e6b31">인원 ' + Math.max(0, nonEmpty - rows.length) + '명 새로 추가</b>';
    } else if (!isName && lines.length > rows.length) {
        msg += ' · <b class="rs-warn">넘치는 ' + (lines.length - rows.length) + '줄 무시</b>';
    }
    const cols = lines.reduce((mx, l) => Math.max(mx, l.split('\t').length), 1);
    if (cols > 1) {
        const vis = visibleFields();
        const st = vis.findIndex(f => f.key === state.bulkKey);
        const names = vis.slice(st, st + cols).map(f => f.label);
        msg += '<br>탭 감지: <b>' + names.join(' · ') + '</b> 열을 함께 채웁니다.';
    }

    // 어느 줄이 누구에게 들어가는지 미리 보여준다 (붙여넣기 순서 어긋남 방지)
    if (rows.length) {
        const pairs = rows.slice(0, 4).map((m, i) => {
            const v = clean((lines[i] || '').split('\t')[0]);
            return esc(m.name) + ' ← ' + (v ? '<b>' + esc(v) + '</b>' : '<span class="rs-dim">(비움)</span>');
        });
        msg += '<br>적용 미리보기: ' + pairs.join(' · ') + (rows.length > 4 ? ' …' : '');
    }
    document.getElementById('rsBulkStat').innerHTML = msg;
}

async function applyBulk() {
    const f = fieldOf(state.bulkKey);
    if (!f) return;

    const lines = splitLines(document.getElementById('rsBulkText').value);
    const rows = filtered();
    const vis = visibleFields();
    const startIdx = vis.findIndex(x => x.key === state.bulkKey);
    const isName = (state.bulkKey === 'name');

    if (!isName && !rows.length) { showAlert('먼저 이름 열로 인원을 만들어 주세요.', 'warning'); return; }

    let added = 0, ignored = 0;
    lines.forEach((line, i) => {
        const cells = line.split('\t');
        let m = rows[i];

        if (!m) {
            // 줄이 남는 경우: 이름 열일 때만 새 인원을 만든다
            if (!isName || clean(cells[0]) === '') { ignored++; return; }
            m = blankMember(state.group);
            state.members.push(m);
            added++;
        }

        cells.forEach((cv, ci) => {
            const tf = vis[startIdx + ci];
            if (!tf) return;
            const v = normVal(tf.key, cv);
            if (tf.key === 'name' && v === '') return;   // 이름은 비우지 않는다
            setVal(m, tf, v);
        });
    });

    if (await saveData()) {
        closeModal('rsBulkModal');
        render();
        let msg = f.label + ' 열을 채웠습니다.';
        if (added) msg += ' (인원 ' + added + '명 추가)';
        if (ignored) msg += ' · ' + ignored + '줄 무시';
        showAlert(msg, 'success');
    }
}

// ==================== 인원 추가 / 수정 모달 ====================
function openForm(id) {
    state.editId = id || null;
    const m = id ? state.members.find(x => x.id === id) : null;

    document.getElementById('rsFormTitle').innerHTML = m
        ? '<i class="fas fa-user-pen"></i> ' + esc(m.name) + ' 정보 수정'
        : '<i class="fas fa-user-plus"></i> ' + esc(groupLabel(state.group)) + ' 인원 추가';

    // 구분(탭) 선택 + 나머지 항목
    const gSel = '<div class="form-group"><label for="rf_group">구분</label>' +
        '<select id="rf_group">' + RS_GROUPS.map(g =>
            '<option value="' + g.key + '"' + ((m ? m.group : state.group) === g.key ? ' selected' : '') + '>' + esc(g.label) + '</option>'
        ).join('') + '</select></div>';

    document.getElementById('rsFormFields').innerHTML = gSel + allFields().map(f => {
        const wide = (f.key === 'school' || f.key === 'dept') ? ' wide' : '';
        const ph = f.key === 'birth' ? '예: 030110' : (f.key === 'period' ? '예: 2023.03 ~' : '');
        return '<div class="form-group' + wide + '">' +
               '<label for="rf_' + esc(f.key) + '">' + esc(f.label) + '</label>' +
               '<input type="text" id="rf_' + esc(f.key) + '" data-key="' + esc(f.key) + '" value="' + esc(m ? getVal(m, f) : '') + '"' +
               (ph ? ' placeholder="' + esc(ph) + '"' : '') + (f.key === 'name' ? ' required' : '') + '>' +
               '</div>';
    }).join('');

    document.getElementById('rsDeleteBtn').style.display = m ? 'inline-flex' : 'none';
    openModal('rsFormModal');
    const first = document.getElementById('rf_name');
    if (first) setTimeout(() => first.focus(), 50);
}

async function submitForm(e) {
    e.preventDefault();
    const nameInput = document.getElementById('rf_name');
    if (!nameInput.value.trim()) { showAlert('이름은 반드시 입력해야 합니다.', 'warning'); return; }

    const target = state.editId ? state.members.find(x => x.id === state.editId) : blankMember(state.group);
    if (!target) return;

    document.querySelectorAll('#rsFormFields input[data-key]').forEach(i => {
        const f = fieldOf(i.dataset.key);
        if (f) setVal(target, f, normVal(f.key, i.value));
    });
    const gv = document.getElementById('rf_group').value;
    if (RS_GKEYS.indexOf(gv) >= 0) target.group = gv;

    if (!state.editId) state.members.push(target);

    if (await saveData()) {
        closeModal('rsFormModal');
        if (target.group !== state.group) state.group = target.group;   // 다른 탭으로 옮겼으면 따라간다
        showAlert(state.editId ? '수정되었습니다.' : '추가되었습니다.', 'success');
        render();
    }
}

async function deleteMember() {
    const m = state.members.find(x => x.id === state.editId);
    if (!m) return;
    if (!confirm(m.name + ' 님의 정보를 삭제할까요? 되돌릴 수 없습니다.')) return;
    state.members = state.members.filter(x => x.id !== state.editId);
    if (await saveData()) {
        closeModal('rsFormModal');
        showAlert('삭제되었습니다.', 'success');
        render();
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
    rsApp = document.getElementById('rsApp');
    rsHead = document.getElementById('rsHead');
    rsBody = document.getElementById('rsBody');
    rsChips = document.getElementById('rsChips');
    rsTabs = document.getElementById('rsTabs');
    rsCount = document.getElementById('rsCount');
    rsEmpty = document.getElementById('rsEmpty');
    rsSave = document.getElementById('rsSave');
    rsSearch = document.getElementById('rsSearch');
    rsColMenu = document.getElementById('rsColMenu');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
    } catch (err) { console.error('Firebase 초기화 실패', err); return; }

    auth.onAuthStateChanged(async (user) => {
        currentUser = (user && RS_ALLOWED.includes(user.uid)) ? user : null;
        updateAuthUI();
        if (currentUser) {
            try { await loadData(); render(); }
            catch (e) { console.error(e); showAlert('데이터 로드 실패: ' + e.message, 'error'); }
        }
    });

    // 로그인 모달
    loginBtn && loginBtn.addEventListener('click', () => openModal('loginModal'));
    const gateBtn = document.getElementById('gateLoginBtn');
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

    // 모달 닫기 (공통)
    document.querySelectorAll('[data-close]').forEach(b => {
        b.addEventListener('click', () => closeModal(b.dataset.close));
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeColMenu();
            ['rsFormModal', 'rsBulkModal', 'rsColModal', 'rsImportModal', 'loginModal'].forEach(closeModal);
        }
    });
    document.addEventListener('click', e => {
        if (rsColMenu && !rsColMenu.contains(e.target)) closeColMenu();
    });
    window.addEventListener('resize', closeColMenu);
    window.addEventListener('scroll', closeColMenu, true);

    // 검색
    rsSearch.addEventListener('input', () => { state.q = rsSearch.value; render(); });

    // 툴바
    document.getElementById('rsMaskBtn').addEventListener('click', function () {
        state.masked = !state.masked;
        this.classList.toggle('on', state.masked);
        this.innerHTML = state.masked
            ? '<i class="fas fa-eye"></i> 민감정보 표시'
            : '<i class="fas fa-eye-slash"></i> 민감정보 가리기';
        render();
    });
    document.getElementById('rsColBtn').addEventListener('click', function () {
        state.compact = !state.compact;
        this.classList.toggle('on', !state.compact);
        this.innerHTML = state.compact
            ? '<i class="fas fa-table-columns"></i> 전체 항목'
            : '<i class="fas fa-table-columns"></i> 주요 항목만';
        render();
    });
    document.getElementById('rsAddColBtn').addEventListener('click', () => openColForm(null));
    document.getElementById('rsAddBtn').addEventListener('click', () => openForm(null));
    document.getElementById('rsImportBtn').addEventListener('click', openImport);
    document.getElementById('rsEmptyImport').addEventListener('click', openImport);
    document.getElementById('rsEmptyFill').addEventListener('click', () => openBulk('name'));

    // 인원 입력 폼
    document.getElementById('rsForm').addEventListener('submit', submitForm);
    document.getElementById('rsDeleteBtn').addEventListener('click', deleteMember);

    // 열 이름 폼
    document.getElementById('rsColForm').addEventListener('submit', submitColForm);

    // 열 일괄 입력
    document.getElementById('rsBulkText').addEventListener('input', updateBulkStat);
    document.getElementById('rsBulkApply').addEventListener('click', applyBulk);

    // CSV 가져오기
    document.getElementById('rsFile').addEventListener('change', function () {
        const f = this.files && this.files[0];
        if (!f) return;
        document.getElementById('rsFileName').textContent = f.name;
        const reader = new FileReader();
        reader.onload = () => {
            document.getElementById('rsPaste').value = reader.result;
            previewImport(reader.result);
        };
        reader.onerror = () => showAlert('파일을 읽지 못했습니다.', 'error');
        reader.readAsText(f, 'utf-8');
    });
    document.getElementById('rsPaste').addEventListener('input', function () { previewImport(this.value); });
    document.getElementById('rsApplyImport').addEventListener('click', applyImport);
});
