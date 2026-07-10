// worklog-eval.js - 인원별 평가 (로그인 전용)
// 업무관리의 자매 페이지: 담당자 명단(worklog/people)의 인원마다 잘함/보완 피드백을 이유와 함께 로그로 기록.
// 저장은 worklog/personEvals 경로만 사용 — 업무 보드(worklog.js)는 update() 저장이라 이 경로를 건드리지 않음.
// 설정값은 config.js 참조 (firebaseConfig, ADMIN_UID, ROOT_UID)

// ==================== 상수 ====================
const EV_ALLOWED = [ROOT_UID];              // 인원별 평가는 Root(admin_kinjecs0) 계정 전용
const WL_SITE_UIDS = [ADMIN_UID, ROOT_UID]; // 사이트 관리자 목록 (여기 없는 계정은 로그아웃 처리)
const EV_PATH = 'worklog/personEvals';
const PEOPLE_PATH = 'worklog/people';
const EV_PALETTE = ['#4f46e5', '#059669', '#dc2626', '#d97706', '#0891b2', '#7c3aed', '#db2777', '#65a30d'];

// ==================== 전역 상태 ====================
let auth, database;
let currentUser = null;   // Root 계정으로 로그인한 경우만 세팅
let headerUser = null;    // 헤더 표시용 (Root가 아니어도 사이트 관리자면 로그인 상태 유지)
let people = [];      // 담당자 명단 (업무 보드에서 관리, 여기서는 읽기만)
let leaders = [];     // 팀장(복수) — worklog/leaders, 업무 보드의 명단 모달에서 지정
let evals = [];       // [{id, name, kind: 'good'|'bad', text, date}]
let personList = [];  // 렌더 순서 고정용 (명단 + 명단 외 기록 보유자)
let dirty = false;
let saveTimer = null;
let saving = false;
const formOpen = {};  // 인원 index → 입력 폼 열림 (화면 상태, 저장 안 함)
const kindSel = {};   // 인원 index → 'good'|'bad'

let evApp, authGate, board;

// ==================== 유틸 ====================
function esc(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let uidSeq = 0;
function newId() { return 'e' + Date.now().toString(36) + (uidSeq++).toString(36); }

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

function todayStr() {
    const n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

// ==================== 저장 (worklog/personEvals만, 자동) ====================
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
        await database.ref(EV_PATH).set(evals);
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
    const [ps, es, ls, lsOld] = await Promise.all([
        database.ref(PEOPLE_PATH).once('value'),
        database.ref(EV_PATH).once('value'),
        database.ref('worklog/leaders').once('value'),
        database.ref('worklog/leader').once('value')   // 구버전 단일 팀장 (이관 전 호환)
    ]);
    people = toArr(ps.val()).map(String).filter(Boolean);
    leaders = toArr(ls.val()).map(String).filter(n => people.includes(n));
    if (!leaders.length && typeof lsOld.val() === 'string' && people.includes(lsOld.val())) leaders = [lsOld.val()];
    evals = toArr(es.val()).map(ev => ({
        id: (ev && ev.id && /^[A-Za-z0-9_-]+$/.test(ev.id)) ? ev.id : newId(),
        name: String((ev && ev.name) || ''),
        kind: (ev && ev.kind) === 'bad' ? 'bad' : 'good',
        text: String((ev && ev.text) || ''),
        date: String((ev && ev.date) || '')
    })).filter(ev => ev.name && ev.text);
    dirty = false;
    setSaveStat('linked', '동기화됨');
    render();
}

// ==================== 렌더 (인원별 카드) ====================
function render() {
    if (!board) return;
    // 명단 순서대로 + 명단에서 빠졌지만 기록이 남아있는 이름도 뒤에 표시 (기록 유실 방지)
    const names = people.filter(p => p !== '모두');
    evals.forEach(ev => { if (!names.includes(ev.name)) names.push(ev.name); });
    personList = names;

    if (!names.length) {
        board.innerHTML = `<div class="ev-none">등록된 인원이 없습니다.<br>
            <a href="worklog.html">업무 보드</a>의 [담당자 명단]에서 인원을 등록하면 여기에 카드가 생깁니다.</div>`;
        return;
    }

    board.innerHTML = names.map((name, i) => {
        const list = evals.filter(ev => ev.name === name);
        const g = list.filter(ev => ev.kind === 'good').length;
        const b = list.length - g;
        const isOpen = !!formOpen[i];
        const k = kindSel[i] === 'bad' ? 'bad' : 'good';
        const rows = list.slice().reverse().map(ev => `
            <div class="eval-item ${ev.kind}">
                <span class="ev-ic">${ev.kind === 'good' ? '👍' : '👎'}</span>
                <span class="ev-date">${esc(ev.date)}</span>
                <span class="ev-txt">${esc(ev.text)}</span>
                <button class="ev-del" title="이 기록 삭제" onclick="evDel('${ev.id}')">✕</button>
            </div>`).join('');
        const formHtml = isOpen ? `
            <div class="eval-add">
                <button class="ev-kind good${k === 'good' ? ' on' : ''}" onclick="evSetKind(${i},'good')">👍 잘함</button>
                <button class="ev-kind bad${k === 'bad' ? ' on' : ''}" onclick="evSetKind(${i},'bad')">👎 보완</button>
                <input type="text" placeholder="이유 입력 후 Enter (예: 발표 준비가 꼼꼼했음)"
                    onkeydown="if(event.key==='Enter')evAdd(${i},this);else if(event.key==='Escape')evToggleForm(${i})">
                <button class="ev-add-btn" onclick="evAdd(${i},this.previousElementSibling)">기록</button>
            </div>` : '';
        return `
        <div class="wl-section eval-card" data-pi="${i}" style="--sec-color:${EV_PALETTE[i % EV_PALETTE.length]}">
            <div class="eval-person-head">
                <span class="ep-ic">👤</span>
                <span class="ep-name">${esc(name)}${leaders.includes(name) ? ' <span class="ep-leader"><i class="fas fa-user-tie"></i> 팀장</span>' : ''}</span>
                ${people.includes(name) ? '' : '<span class="ep-out" title="담당자 명단에는 없지만 기록이 남아있는 인원">명단 외</span>'}
                <span class="ep-cnt${list.length ? '' : ' none'}">👍 ${g} · 👎 ${b}</span>
                <button class="eval-add-open${isOpen ? ' on' : ''}" onclick="evToggleForm(${i})">${isOpen ? '✕ 닫기' : '＋ 기록'}</button>
            </div>
            <div class="eval-person-body">
                ${formHtml}
                <div class="eval-list">${rows || (isOpen ? '' : '<div class="eval-empty">아직 기록이 없습니다. [＋ 기록]으로 잘한 점 / 보완할 점을 남겨보세요.</div>')}</div>
            </div>
        </div>`;
    }).join('');
}

// ==================== 기록 (잘함/보완 + 이유) ====================
function evToggleForm(i) {
    if (formOpen[i]) delete formOpen[i];
    else formOpen[i] = true;
    render();
    if (formOpen[i]) {
        const inp = board.querySelector(`.eval-card[data-pi="${i}"] .eval-add input`);
        if (inp) inp.focus();
    }
}

function evSetKind(i, kind) {
    kindSel[i] = kind;
    render();
    const inp = board.querySelector(`.eval-card[data-pi="${i}"] .eval-add input`);
    if (inp) inp.focus();
}

function evAdd(i, inp) {
    const v = inp.value.trim(); if (!v) return;
    evals.push({
        id: newId(),
        name: personList[i],
        kind: kindSel[i] === 'bad' ? 'bad' : 'good',
        text: v,
        date: todayStr()
    });
    delete formOpen[i];   // 기록 후 폼 닫기 (평소엔 로그만 보이게)
    touch(); render();
}

function evDel(id) {
    const ev = evals.find(x => x.id === id);
    if (!confirm(`이 기록을 삭제할까요?\n"${ev ? ev.text : ''}"`)) return;
    evals = evals.filter(x => x.id !== id);
    touch(); render();
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
    // 헤더는 로그인 여부(headerUser), 본문 게이트는 Root 여부(currentUser)로 판단
    const signedIn = !!headerUser;
    const authed = !!currentUser;
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    if (loginBtn) loginBtn.style.display = signedIn ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = signedIn ? 'flex' : 'none';
    if (userInfo) userInfo.style.display = signedIn ? 'flex' : 'none';
    if (userName && headerUser) userName.textContent = headerUser.email;
    if (authGate) authGate.style.display = authed ? 'none' : 'flex';
    if (evApp) evApp.style.display = authed ? 'block' : 'none';
    const gateMsg = document.getElementById('gateMsg');
    if (gateMsg) gateMsg.textContent = signedIn && !authed
        ? '현재 계정으로는 볼 수 없습니다. 이 페이지는 Root 관리자 계정 전용입니다.'
        : '이 페이지는 Root 관리자 계정으로 로그인해야 볼 수 있습니다.';
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    evApp = document.getElementById('evApp');
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
        headerUser = user || null;
        currentUser = (user && EV_ALLOWED.includes(user.uid)) ? user : null;
        // 사이트 관리자가 아닌 계정만 로그아웃 처리 (일반 관리자는 다른 페이지를 쓸 수 있으므로 유지)
        if (user && WL_SITE_UIDS.indexOf(user.uid) < 0) { headerUser = null; await auth.signOut(); }
        updateAuthUI();
        if (currentUser) {
            try { await loadData(); } catch (e) { console.error(e); setSaveStat('dirty', '로드 실패'); wlAlert('데이터 로드 실패: ' + e.message, 'error'); }
        }
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
