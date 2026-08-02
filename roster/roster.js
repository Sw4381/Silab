// roster.js - Lab 인원 기본 정보 (로그인 전용)
// 설정값은 config.js 참조 (firebaseConfig, ADMIN_UID, ROOT_UID)
//
// DB 경로: labnote/roster = { members: [...], updatedAt }
//   → labnote 노드의 규칙(ADMIN_UID + ROOT_UID)을 그대로 상속하므로 Firebase 규칙 추가 작업이 필요 없다.
//   → labnote.js 는 groups/bodies/calendar 만 update() 하므로 roster 를 건드리지 않는다.
//
// ⚠ 개인정보(전화번호·생년월일·과학기술인번호)가 들어가는 페이지다.
//   저장소는 공개(GitHub Pages)이므로 실제 데이터는 절대 코드에 넣지 않는다. Firebase 에만 둔다.

// ==================== 상수 ====================
const RS_ALLOWED = [ADMIN_UID, ROOT_UID];   // labnote 와 동일 권한
const RS_PATH = 'labnote/roster';

// 표 열 정의. csv: 가져오기 때 인식할 머리글 이름들(별칭 포함)
const RS_FIELDS = [
    { key: 'name',       label: '이름',           csv: ['이름'],                                 core: true },
    { key: 'nameEn',     label: '영문이름',       csv: ['영문이름', 'English Name'] },
    { key: 'position',   label: '직위',           csv: ['직위'],                                 core: true },
    { key: 'dept',       label: '소속',           csv: ['소속'] },
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
const RS_POS_ORDER = ['교수', '박사후연구원', '박사과정', '석사과정', '학부과정', '연구원'];
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

// ==================== 전역 상태 ====================
let auth, database, currentUser = null;
const state = {
    members: [],        // [{id, name, nameEn, position, ...}]
    updatedAt: '',
    q: '',              // 검색어
    posFilter: '',      // 직위 필터 ('' = 전체)
    sortKey: '',        // '' = 기본(직위 → 이름)
    sortAsc: true,
    masked: false,      // 민감정보 가리기
    compact: true,      // true = 주요 항목만, false = 전체 항목
    editId: null,       // 수정 중인 인원 id (null = 신규)
    parsed: null        // CSV 가져오기 미리보기 결과
};

// DOM refs
let loginBtn, logoutBtn, loginModal, loginClose, loginForm, userInfo, userName;
let authGate, rsApp, rsHead, rsBody, rsChips, rsCount, rsEmpty, rsSave, rsSearch;

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
function newId() { return 'm' + Date.now().toString(36) + (seq++).toString(36); }

function showAlert(message, type) {
    const el = document.createElement('div');
    el.className = 'perf-alert ' + (type || 'info');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('open'); }
function hhmm(d) { return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

// ---- 값 정리 ----
// 노션 내보내기는 이메일에 'mailto:' 접두어가 붙고 앞뒤 공백이 섞여 나온다.
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
// 줄바꿈·중복 공백 정리 (노션 CSV 는 셀 안에 줄바꿈이 남아 있는 경우가 있다)
function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }

// ---- 민감정보 마스킹 (화면 공유용) ----
function maskVal(key, raw, disp) {
    if (!raw) return '';
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

// ==================== CSV ====================
// 따옴표 안의 쉼표·줄바꿈까지 처리하는 CSV 파서
function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
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
function mapHeader(headerRow) {
    const map = {};   // 열 인덱스 → 필드 키
    headerRow.forEach((h, i) => {
        const t = clean(h).toLowerCase();
        if (!t) return;
        const f = RS_FIELDS.find(f => f.csv.some(c => c.toLowerCase() === t));
        if (f) map[i] = f.key;
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
        Object.keys(map).forEach(i => {
            const key = map[i];
            let v = clean(rows[r][i]);
            if (key === 'email') v = cleanEmail(v);
            else if (key === 'phone') v = cleanPhone(v);
            else if (key === 'birth' || key === 'sciNo' || key === 'sid') v = v.replace(/\s/g, '');
            o[key] = v;
        });
        if (!o.name) continue;   // 이름 없는 줄은 건너뜀
        members.push(o);
    }
    if (!members.length) return { ok: false, error: '이름이 있는 줄을 찾지 못했습니다.' };
    return { ok: true, members, cols };
}

function membersToCsv(list) {
    const head = RS_FIELDS.map(f => f.csv[0]);
    const esc1 = v => {
        const s = String(v == null ? '' : v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [head.map(esc1).join(',')];
    list.forEach(m => lines.push(RS_FIELDS.map(f => esc1(m[f.key] || '')).join(',')));
    return '\uFEFF' + lines.join('\r\n');   // BOM: 엑셀 한글 깨짐 방지
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
function normalize(list) {
    return toArr(list).map(m => {
        const o = (m && typeof m === 'object') ? m : {};
        const out = { id: o.id || newId() };
        RS_FIELDS.forEach(f => { out[f.key] = String(o[f.key] == null ? '' : o[f.key]).trim(); });
        return out;
    }).filter(m => m.name);
}

async function loadData() {
    setSaveStat('', '불러오는 중...');
    const snap = await database.ref(RS_PATH).once('value');
    const v = snap.val() || {};
    // { members:[...] } 형태가 기본. 예전 형식(배열만 저장)도 함께 읽는다.
    state.members = normalize(v.members !== undefined ? v.members : v);
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
        await database.ref(RS_PATH).set({ members: state.members, updatedAt: stamp });
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

// ==================== 표 렌더 ====================
function visibleFields() {
    return state.compact ? RS_FIELDS.filter(f => f.core) : RS_FIELDS;
}

function filtered() {
    const q = state.q.trim().toLowerCase();
    let list = state.members.filter(m => {
        if (state.posFilter && clean(m.position) !== state.posFilter) return false;
        if (!q) return true;
        return RS_FIELDS.some(f => String(m[f.key] || '').toLowerCase().indexOf(q) >= 0);
    });

    const k = state.sortKey;
    list = list.slice().sort((a, b) => {
        let r;
        if (!k) r = (posRank(a.position) - posRank(b.position)) || String(a.name).localeCompare(String(b.name), 'ko');
        else r = String(a[k] || '').localeCompare(String(b[k] || ''), 'ko', { numeric: true });
        return state.sortAsc ? r : -r;
    });
    return list;
}

function renderChips() {
    const counts = {};
    state.members.forEach(m => {
        const p = clean(m.position) || '미지정';
        counts[p] = (counts[p] || 0) + 1;
    });
    const keys = Object.keys(counts).sort((a, b) => posRank(a) - posRank(b) || a.localeCompare(b, 'ko'));

    let html = '<button class="rs-chip' + (state.posFilter ? '' : ' active') + '" data-pos="">전체<span class="n">' + state.members.length + '</span></button>';
    keys.forEach(p => {
        html += '<button class="rs-chip' + (state.posFilter === p ? ' active' : '') + '" data-pos="' + esc(p) + '">' +
                esc(p) + '<span class="n">' + counts[p] + '</span></button>';
    });
    rsChips.innerHTML = html;
    rsChips.querySelectorAll('.rs-chip').forEach(b => {
        b.addEventListener('click', () => {
            state.posFilter = b.dataset.pos;
            render();
        });
    });
}

function cellHtml(m, f) {
    const raw = String(m[f.key] || '').trim();
    if (!raw) return '<span class="rs-dim">—</span>';

    let disp = dispVal(f.key, raw);
    if (f.sensitive && state.masked) return '<span class="rs-mono rs-dim">' + esc(maskVal(f.key, raw, disp)) + '</span>';

    if (f.key === 'name') return '<span class="rs-name">' + esc(disp) + '</span>';
    if (f.key === 'nameEn') return '<span class="rs-en">' + esc(disp) + '</span>';
    if (f.key === 'position') return '<span class="rs-pos ' + posClass(disp) + '">' + esc(disp) + '</span>';
    if (f.key === 'status') {
        const off = disp.indexOf('재학') < 0;
        return '<span class="rs-st' + (off ? ' off' : '') + '">' + esc(disp) + '</span>';
    }
    if (f.key === 'email') {
        if (disp.indexOf('@') >= 0) return '<a href="mailto:' + esc(disp) + '">' + esc(disp) + '</a>';
        if (/^https?:\/\//i.test(disp)) return '<a href="' + esc(disp) + '" target="_blank" rel="noopener noreferrer">링크 <i class="fas fa-external-link-alt" style="font-size:.8em"></i></a>';
        return esc(disp);
    }
    if (f.key === 'phone' || f.key === 'birth' || f.key === 'sciNo' || f.key === 'sid') {
        return '<span class="rs-mono">' + esc(disp) + '</span>';
    }
    return esc(disp);
}

function render() {
    const fields = visibleFields();
    const list = filtered();

    // 머리글
    rsHead.innerHTML = '<tr>' + fields.map(f => {
        const on = state.sortKey === f.key;
        const ic = on ? (state.sortAsc ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort';
        return '<th class="' + (on ? 'sorted' : '') + '" data-key="' + f.key + '">' + esc(f.label) +
               '<i class="fas ' + ic + ' sort-ic"></i></th>';
    }).join('') + '<th class="th-act"></th></tr>';

    rsHead.querySelectorAll('th[data-key]').forEach(th => {
        th.addEventListener('click', () => {
            const k = th.dataset.key;
            if (state.sortKey === k) state.sortAsc = !state.sortAsc;
            else { state.sortKey = k; state.sortAsc = true; }
            render();
        });
    });

    // 본문
    if (!state.members.length) {
        rsBody.innerHTML = '';
        document.querySelector('.rs-table-wrap').style.display = 'none';
        rsChips.style.display = 'none';
        rsEmpty.style.display = 'block';
        rsCount.textContent = '';
        return;
    }
    document.querySelector('.rs-table-wrap').style.display = 'block';
    rsChips.style.display = 'flex';
    rsEmpty.style.display = 'none';

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

    rsCount.textContent = (list.length === state.members.length)
        ? '총 ' + state.members.length + '명'
        : list.length + ' / ' + state.members.length + '명';

    renderChips();
}

// ==================== 인원 추가 / 수정 모달 ====================
function openForm(id) {
    state.editId = id || null;
    const m = id ? state.members.find(x => x.id === id) : null;

    document.getElementById('rsFormTitle').innerHTML = m
        ? '<i class="fas fa-user-pen"></i> ' + esc(m.name) + ' 정보 수정'
        : '<i class="fas fa-user-plus"></i> 인원 추가';

    document.getElementById('rsFormFields').innerHTML = RS_FIELDS.map(f => {
        const wide = (f.key === 'school' || f.key === 'dept') ? ' wide' : '';
        const ph = f.key === 'birth' ? '예: 030110' : (f.key === 'period' ? '예: 2023.03 ~' : '');
        return '<div class="form-group' + wide + '">' +
               '<label for="rf_' + f.key + '">' + esc(f.label) + '</label>' +
               '<input type="text" id="rf_' + f.key + '" data-key="' + f.key + '" value="' + esc(m ? (m[f.key] || '') : '') + '"' +
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
    const vals = {};
    document.querySelectorAll('#rsFormFields input[data-key]').forEach(i => {
        let v = i.value.trim();
        const k = i.dataset.key;
        if (k === 'email') v = cleanEmail(v);
        else if (k === 'phone') v = cleanPhone(v);
        vals[k] = v;
    });
    if (!vals.name) { showAlert('이름은 반드시 입력해야 합니다.', 'warning'); return; }

    if (state.editId) {
        const m = state.members.find(x => x.id === state.editId);
        if (m) Object.assign(m, vals);
    } else {
        state.members.push(Object.assign({ id: newId() }, vals));
    }

    if (await saveData()) {
        closeModal('rsFormModal');
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

// ==================== CSV 가져오기 ====================
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
    box.className = 'rs-preview ok';
    box.innerHTML = '<i class="fas fa-circle-check"></i> <b>' + res.members.length + '명</b> 인식됨 · ' +
                    '인식된 항목: ' + esc(labels.join(' · ')) +
                    '<br>첫 번째: <b>' + esc(res.members[0].name) + '</b>' +
                    (res.members[0].position ? ' (' + esc(res.members[0].position) + ')' : '');
}

async function applyImport() {
    if (!state.parsed || !state.parsed.length) { showAlert('먼저 CSV 파일을 선택하거나 붙여넣어 주세요.', 'warning'); return; }
    const mode = (document.querySelector('input[name="rsMode"]:checked') || {}).value || 'merge';

    if (mode === 'replace') {
        if (!confirm('기존 ' + state.members.length + '명을 모두 지우고 CSV의 ' + state.parsed.length + '명으로 교체합니다. 진행할까요?')) return;
        state.members = state.parsed.map(o => Object.assign({ id: newId() }, o));
    } else {
        // 병합: 같은 이름이면 CSV 에 값이 있는 항목만 덮어쓰고, 없는 이름은 새로 추가
        let added = 0, updated = 0;
        state.parsed.forEach(o => {
            const hit = state.members.find(m => clean(m.name) === clean(o.name));
            if (hit) {
                Object.keys(o).forEach(k => { if (o[k]) hit[k] = o[k]; });
                updated++;
            } else {
                state.members.push(Object.assign({ id: newId() }, o));
                added++;
            }
        });
        showAlert('추가 ' + added + '명 · 갱신 ' + updated + '명', 'info');
    }

    // 필수 필드 채우기(정규화)
    state.members = normalize(state.members);

    if (await saveData()) {
        closeModal('rsImportModal');
        render();
        showAlert('가져오기가 완료되었습니다. (총 ' + state.members.length + '명)', 'success');
    }
}

function exportCsv() {
    if (!state.members.length) { showAlert('내보낼 데이터가 없습니다.', 'warning'); return; }
    const blob = new Blob([membersToCsv(state.members)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = 'SILAB_인원기본정보_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    rsCount = document.getElementById('rsCount');
    rsEmpty = document.getElementById('rsEmpty');
    rsSave = document.getElementById('rsSave');
    rsSearch = document.getElementById('rsSearch');

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
        if (e.key === 'Escape') { closeModal('rsFormModal'); closeModal('rsImportModal'); closeModal('loginModal'); }
    });

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
    document.getElementById('rsAddBtn').addEventListener('click', () => openForm(null));
    document.getElementById('rsExportBtn').addEventListener('click', exportCsv);
    document.getElementById('rsImportBtn').addEventListener('click', () => openImport());
    document.getElementById('rsEmptyImport').addEventListener('click', () => openImport());

    // 입력 폼
    document.getElementById('rsForm').addEventListener('submit', submitForm);
    document.getElementById('rsDeleteBtn').addEventListener('click', deleteMember);

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

function openImport() {
    document.getElementById('rsFile').value = '';
    document.getElementById('rsFileName').textContent = 'CSV 파일 선택';
    document.getElementById('rsPaste').value = '';
    document.getElementById('rsPreview').style.display = 'none';
    state.parsed = null;
    openModal('rsImportModal');
}
