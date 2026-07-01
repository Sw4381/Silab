// common.js - 모든 페이지 공통 동작

// HTML 특수문자 이스케이프 (XSS 방지)
function escHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 금액 입력: 천 단위 콤마 표시 (class="js-money" 인 input 자동 포맷)
function silabMoneyFmt(v) {
    var r = String(v == null ? '' : v).replace(/[^\d]/g, '');
    if (!r) return '';
    var n = Number(r);
    return n ? n.toLocaleString('ko-KR') : '';
}
document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains('js-money')) return;
    var sel = t.selectionStart;
    var before = t.value.slice(0, sel).replace(/[^\d]/g, '').length;   // 커서 앞 숫자 개수
    var digits = t.value.replace(/[^\d]/g, '');
    t.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
    var pos = 0, count = 0;
    while (pos < t.value.length && count < before) { var c = t.value.charCodeAt(pos); if (c >= 48 && c <= 57) count++; pos++; }
    try { t.setSelectionRange(pos, pos); } catch (_) { }
});

// 교수님 지정 과제 순서 (학생인건비·예산 공통). 이름이 대체로 일치하면 이 순서로 정렬된다.
var SILAB_CANON = ['KISTI', 'BAS', '연구재단(개인)', '연구재단(집단)', 'K-Hero', '서교수님', '해외파견', '개인정보(용역)', 'Z3soft(용역)', '선박(용역)'];
function silabCanonNorm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s()（）_\-~,.·]/g, ''); }
var SILAB_CANON_NORM = SILAB_CANON.map(silabCanonNorm);
function silabCanonRank(name) {
    var n = silabCanonNorm(name); if (!n) return 999;
    for (var i = 0; i < SILAB_CANON_NORM.length; i++) {
        var c = SILAB_CANON_NORM[i];
        if (c === n || n.indexOf(c) >= 0 || c.indexOf(n) >= 0) return i;
    }
    return 999;
}

// 로그인 전용 메뉴(Performance) 표시 토글
function setPerfNav(show) {
    document.querySelectorAll('.nav-perf').forEach(function (a) {
        a.style.display = show ? '' : 'none';
    });
}

// 유휴(무활동) 자동 로그아웃 — 활동 없이 30분 경과 시 자동 로그아웃 (보안)
// 마지막 활동 시각을 localStorage 에 저장하고, 탭이 닫혀 있던 경우에도 재접속 시 초과분을 판정한다.
function setupIdleLogout() {
    var IDLE_MS = 30 * 60 * 1000;      // 30분
    var KEY = 'silab_last_activity';
    var lastWrite = 0;

    function mark() {
        var now = Date.now();
        if (now - lastWrite < 20000) return;   // 20초에 한 번만 기록(과도한 쓰기 방지)
        lastWrite = now;
        try { localStorage.setItem(KEY, String(now)); } catch (e) {}
    }
    function idleExceeded() {
        var last = Number(localStorage.getItem(KEY) || 0);
        return last > 0 && (Date.now() - last > IDLE_MS);
    }
    function idleToast() {
        var d = document.createElement('div');
        d.textContent = '30분간 활동이 없어 자동 로그아웃되었습니다.';
        d.style.cssText = 'position:fixed;top:20px;right:20px;z-index:4000;background:#fff3cd;color:#856404;border:1px solid #ffeaa7;padding:12px 16px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);font-size:14px;';
        document.body.appendChild(d);
        setTimeout(function () { d.remove(); }, 5000);
    }
    function logoutIdle() {
        try { localStorage.setItem('silab_auth', '0'); localStorage.removeItem(KEY); } catch (e) {}
        try { firebase.auth().signOut(); } catch (e) {}
        idleToast();
    }
    function check() {
        try {
            if (!firebase.apps.length) return;
            if (firebase.auth().currentUser && idleExceeded()) logoutIdle();
        } catch (e) {}
    }

    ['click', 'keydown', 'mousemove', 'wheel', 'scroll', 'touchstart'].forEach(function (ev) {
        window.addEventListener(ev, mark, { passive: true });
    });

    // 로그인 확인되면: 이미 30분 초과 상태면 즉시 로그아웃, 아니면 이번 방문을 활동으로 기록
    firebase.auth().onAuthStateChanged(function (user) {
        if (!user) return;
        if (idleExceeded()) logoutIdle();
        else { lastWrite = 0; mark(); }
    });

    setInterval(check, 30 * 1000);   // 30초마다 유휴 확인
}

document.addEventListener('DOMContentLoaded', function () {
    // 현재 페이지 자동 활성화 (탭으로 묶인 서브페이지는 부모 메뉴를 활성화)
    var currentPage = window.location.pathname.split('/').pop() || 'index.html';
    var navAlias = { 'member-performance.html': 'performance.html', 'team-performance.html': 'performance.html', 'payroll.html': 'budget.html' };
    var activePage = navAlias[currentPage] || currentPage;
    document.querySelectorAll('.menu a').forEach(function (link) {
        var href = link.getAttribute('href').replace('./', '');
        link.classList.toggle('active', href === activePage);
    });

    // 로그인 상태에 따라 Performance 메뉴 노출.
    // 캐시값으로 즉시 반영 후, Firebase 인증 상태로 정정한다.
    setPerfNav(localStorage.getItem('silab_auth') === '1');
    if (typeof firebase !== 'undefined' && typeof firebaseConfig !== 'undefined') {
        try {
            if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
            firebase.auth().onAuthStateChanged(function (user) {
                var ok = !!(user && ((typeof ADMIN_UID !== 'undefined' && user.uid === ADMIN_UID) || (typeof ROOT_UID !== 'undefined' && user.uid === ROOT_UID)));
                localStorage.setItem('silab_auth', ok ? '1' : '0');
                setPerfNav(ok);
            });
            setupIdleLogout();   // 30분 무활동 자동 로그아웃
        } catch (e) { /* firebase 미로드 페이지는 캐시값 유지 */ }
    }

    // 숨겨진 관리자 진입: 좌측 상단 로고를 빠르게 5번 클릭하면 로그인 모달이 열린다.
    // 주의: 이것은 보안 경계가 아니라 '로그인 버튼을 평소엔 안 보이게' 하는 수준이다.
    //       (이 코드는 공개 소스에 그대로 노출됨) 실제 보호는 Firebase 비밀번호 + DB 규칙이 담당한다.
    (function setupSecretLogin() {
        var logo = document.querySelector('.logo a') || document.querySelector('.logo');
        if (!logo) return;
        var NEED = 5, WINDOW = 1500, NAV_DELAY = 320;
        var href = (logo.getAttribute && logo.getAttribute('href')) || 'index.html';
        var clicks = [];
        var navTimer = null;
        logo.addEventListener('click', function (e) {
            e.preventDefault();
            var now = Date.now();
            clicks.push(now);
            clicks = clicks.filter(function (t) { return now - t < WINDOW; });
            if (navTimer) { clearTimeout(navTimer); navTimer = null; }
            if (clicks.length >= NEED) {
                clicks = [];
                var b = document.getElementById('loginBtn');
                if (b) b.click();      // 페이지별 모달 오픈 로직 재사용
                return;
            }
            // 평소(단일/소수 클릭)에는 원래대로 홈으로 이동 (약간의 지연 후)
            navTimer = setTimeout(function () { window.location.href = href; }, NAV_DELAY);
        });
    })();

    var hamburger = document.getElementById('hamburger');
    var menu = document.querySelector('.menu');
    if (!hamburger || !menu) return;

    hamburger.addEventListener('click', function () {
        hamburger.classList.toggle('open');
        menu.classList.toggle('open');
    });

    // 메뉴 링크 클릭 시 닫기
    menu.querySelectorAll('a').forEach(function (link) {
        link.addEventListener('click', function () {
            hamburger.classList.remove('open');
            menu.classList.remove('open');
        });
    });

    // 메뉴 바깥 클릭 시 닫기
    document.addEventListener('click', function (e) {
        if (!hamburger.contains(e.target) && !menu.contains(e.target)) {
            hamburger.classList.remove('open');
            menu.classList.remove('open');
        }
    });
});
