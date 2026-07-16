// worklog-attend.js - 근태 관리 (로그인 전용)
// 업무관리의 자매 페이지: 월별 항목("7월 근태관리")마다 자유 텍스트박스에 휴가·부재 등 일정을 기재.
// 저장은 worklog/attendance(+attendInit) 경로만 사용 — 업무 보드(worklog.js)는 update() 저장이라 이 경로를 건드리지 않음.
// 설정값은 config.js 참조 (firebaseConfig, ADMIN_UID, ROOT_UID)

// ==================== 상수 ====================
const AT_ALLOWED = [ADMIN_UID, ROOT_UID];   // 열람/기재 모두 관리자 두 계정 (업무 보드와 동일)
const AT_PATH = 'worklog/attendance';
const AT_PALETTE = ['#4f46e5', '#059669', '#dc2626', '#d97706', '#0891b2', '#7c3aed', '#db2777', '#65a30d'];

// 최초 1회 자동 생성 항목 (attendInit 플래그가 없고 기록도 없을 때만 — 모두 지워도 다시 채우지 않음)
const AT_SEED = [{ title: '7월 근태관리', text: '- 전예림 : 7/27~8/15 휴가' }];

// ==================== 전역 상태 ====================
let auth, database;
let currentUser = null;
let entries = [];       // [{id, title, text}] — 배열 순서 = 표시 순서 (새 항목이 맨 위)
let dirty = false;
let saveTimer = null;
let saving = false;
const editOpen = {};    // 항목 id → 편집 모드 (화면 상태, 저장 안 함)

let atApp, authGate, board;

// ==================== 유틸 ====================
function esc(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let uidSeq = 0;
function newId() { return 'a' + Date.now().toString(36) + (uidSeq++).toString(36); }

function wlAlert(message, type) {
    const el = document.createElement('div');
    el.className = 'wl-alert ' + (type || 'info');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function toArr(v) {
    if (Array.isArray(v)) return v.filter(x => x != null);
    if (v && typeof v === 'object') return Object.values(v).filter(x => x != null);
    return [];
}

function findEntry(id) { return entries.find(e => e.id === id); }

// ==================== 저장 (worklog/attendance만, 자동) ====================
function setSaveStat(cls, text) {
    const dot = document.getElementById('saveDot'), t = document.getElementById('saveText');
    if (dot) dot.className = 'wl-dot' + (cls ? ' ' + cls : '');
    if (t) t.textContent = text;
}

function touch() {
    dirty = true;
    setSaveStat('dirty', '저장 중...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
}

async function saveNow() {
    if (!currentUser || saving) return;
    saving = true;
    try {
        // update(): worklog의 다른 자식(sections/people/personEvals...)을 건드리지 않음
        // 항목을 모두 지우면 배열이 빈값이라 attendance 키 자체가 삭제됨 → attendInit로 재시드 방지
        await database.ref('worklog').update({ attendance: entries, attendInit: true });
        dirty = false;
        const now = new Date();
        setSaveStat('linked', '저장됨 ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
    } catch (err) {
        setSaveStat('dirty', '저장 실패');
        wlAlert('저장 실패: ' + err.message, 'error');
    } finally {
        saving = false;
        if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
    }
}

async function loadData() {
    setSaveStat('', '불러오는 중...');
    const [es, fl] = await Promise.all([
        database.ref(AT_PATH).once('value'),
        database.ref('worklog/attendInit').once('value')
    ]);
    entries = toArr(es.val()).map(en => ({
        id: (en && en.id && /^[A-Za-z0-9_-]+$/.test(en.id)) ? en.id : newId(),
        title: String((en && en.title) || '').trim() || '(제목 없음)',
        text: String((en && en.text) || '')
    }));
    if (!fl.val() && !entries.length) {
        // 첫 진입: 기본 항목 시드 후 바로 저장 (사용자와 합의한 첫 기록 포함)
        entries = AT_SEED.map(s => ({ id: newId(), title: s.title, text: s.text }));
        touch();
    } else {
        dirty = false;
        setSaveStat('linked', '동기화됨');
    }
    render();
}

// ==================== 렌더 (월별 항목 카드) ====================
function render() {
    if (!board) return;
    if (!entries.length) {
        board.innerHTML = `<div class="ev-none">등록된 항목이 없습니다.<br>
            아래 [＋ 항목 추가]로 "8월 근태관리"처럼 월별 항목을 만들어 일정을 기재하세요.</div>`;
        return;
    }
    board.innerHTML = entries.map((en, i) => {
        const editing = !!editOpen[en.id];
        const head = editing
            ? `<input class="at-title-inp" id="ti-${en.id}" value="${esc(en.title)}"
                   onkeydown="if(event.key==='Escape')atCancel('${en.id}')">`
            : `<span class="at-title">${esc(en.title)}</span>
               <button class="eval-add-open" onclick="atEdit('${en.id}')">✏️ 편집</button>
               <button class="at-del" title="항목 삭제" onclick="atDel('${en.id}')">✕</button>`;
        const body = editing
            ? `<textarea class="at-area" id="tx-${en.id}" rows="6"
                   placeholder="- 이름 : 기간 내용&#10;예) - 전예림 : 7/27~8/15 휴가"
                   onkeydown="if(event.key==='Escape')atCancel('${en.id}')">${esc(en.text)}</textarea>
               <div class="at-actions">
                   <button class="wl-btn primary" onclick="atSave('${en.id}')"><i class="fas fa-check"></i> 저장</button>
                   <button class="wl-btn" onclick="atCancel('${en.id}')">취소</button>
               </div>`
            : `<div class="at-note${en.text ? '' : ' empty'}">${en.text ? esc(en.text) : '아직 기재된 일정이 없습니다. [✏️ 편집]을 눌러 입력하세요.'}</div>`;
        return `
        <div class="wl-section at-card" style="--sec-color:${AT_PALETTE[i % AT_PALETTE.length]}">
            <div class="at-head"><span class="at-ic">🗓️</span>${head}</div>
            <div class="at-body">${body}</div>
        </div>`;
    }).join('');
}

// ==================== 항목 편집/추가/삭제 ====================
function atEdit(id) {
    editOpen[id] = true;
    render();
    const tx = document.getElementById('tx-' + id);
    if (tx) { tx.focus(); tx.selectionStart = tx.value.length; }
}

function atSave(id) {
    const en = findEntry(id); if (!en) return;
    const ti = document.getElementById('ti-' + id);
    const tx = document.getElementById('tx-' + id);
    const t = ti ? ti.value.trim() : '';
    if (t) en.title = t;
    if (tx) en.text = tx.value.replace(/\s+$/, '');
    delete editOpen[id];
    touch(); render();
}

function atCancel(id) { delete editOpen[id]; render(); }

function atDel(id) {
    const en = findEntry(id); if (!en) return;
    if (!confirm(`"${en.title}" 항목을 삭제할까요?\n기재된 일정도 함께 삭제됩니다.`)) return;
    entries = entries.filter(e => e.id !== id);
    delete editOpen[id];
    touch(); render();
}

function addEntry() {
    const inp = document.getElementById('newEntryName');
    const n = inp.value.trim(); if (!n) return;
    const en = { id: newId(), title: n, text: '' };
    entries.unshift(en);   // 최신 항목이 맨 위
    editOpen[en.id] = true;
    inp.value = '';
    setAddForm(false);
    touch(); render();
    const tx = document.getElementById('tx-' + en.id);
    if (tx) tx.focus();
}

// 항목 추가 폼: 평소엔 버튼만 보이고, 누를 때만 입력칸 표시 (업무 보드와 동일 패턴)
function setAddForm(open) {
    const openBtn = document.getElementById('atAddOpenBtn');
    const form = document.getElementById('atAddForm');
    if (!openBtn || !form) return;
    openBtn.style.display = open ? 'none' : '';
    form.style.display = open ? 'flex' : 'none';
    if (open) document.getElementById('newEntryName').focus();
    else document.getElementById('newEntryName').value = '';
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
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    if (loginBtn) loginBtn.style.display = authed ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = authed ? 'flex' : 'none';
    if (userInfo) userInfo.style.display = authed ? 'flex' : 'none';
    if (userName && currentUser) userName.textContent = currentUser.email;
    if (authGate) authGate.style.display = authed ? 'none' : 'flex';
    if (atApp) atApp.style.display = authed ? 'block' : 'none';
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    atApp = document.getElementById('atApp');
    authGate = document.getElementById('authGate');
    board = document.getElementById('board');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
    } catch (err) {
        console.error('Firebase 초기화 실패', err);
        return;
    }

    auth.onAuthStateChanged(async (user) => {
        currentUser = (user && AT_ALLOWED.includes(user.uid)) ? user : null;
        if (user && !currentUser) { await auth.signOut(); }   // 관리자 외 계정은 로그아웃 처리
        updateAuthUI();
        if (currentUser) {
            try { await loadData(); } catch (e) { console.error(e); setSaveStat('dirty', '로드 실패'); wlAlert('데이터 로드 실패: ' + e.message, 'error'); }
        }
    });

    // 항목 추가 폼
    const openBtn = document.getElementById('atAddOpenBtn');
    const addBtn = document.getElementById('atAddBtn');
    const cancelBtn = document.getElementById('atAddCancelBtn');
    const nameInp = document.getElementById('newEntryName');
    openBtn && openBtn.addEventListener('click', () => setAddForm(true));
    addBtn && addBtn.addEventListener('click', addEntry);
    cancelBtn && cancelBtn.addEventListener('click', () => setAddForm(false));
    nameInp && nameInp.addEventListener('keydown', e => {
        if (e.key === 'Enter') addEntry();
        else if (e.key === 'Escape') setAddForm(false);
    });

    // 로그인 모달
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const gateLoginBtn = document.getElementById('gateLoginBtn');
    const loginClose = document.getElementById('loginClose');
    const logoutBtn = document.getElementById('logoutBtn');
    loginBtn && loginBtn.addEventListener('click', () => loginModal.classList.add('open'));
    gateLoginBtn && gateLoginBtn.addEventListener('click', () => loginModal.classList.add('open'));
    loginClose && loginClose.addEventListener('click', () => loginModal.classList.remove('open'));
    loginModal && loginModal.addEventListener('click', e => { if (e.target === loginModal) loginModal.classList.remove('open'); });
    logoutBtn && logoutBtn.addEventListener('click', async () => { await auth.signOut(); wlAlert('로그아웃되었습니다.', 'success'); });
    loginForm && loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await loginUser(document.getElementById('email').value.trim(), document.getElementById('password').value);
            loginModal.classList.remove('open');
            loginForm.reset();
            wlAlert('로그인되었습니다.', 'success');
        } catch (err) { wlAlert(err.message || '로그인 실패', 'error'); }
    });

    // 저장 전에 떠나면 경고
    window.addEventListener('beforeunload', e => {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
});
