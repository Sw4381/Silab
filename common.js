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

// 로그인 전용 메뉴(Performance) 표시 토글
function setPerfNav(show) {
    document.querySelectorAll('.nav-perf').forEach(function (a) {
        a.style.display = show ? '' : 'none';
    });
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
                var ok = !!(user && (typeof ALLOWED_EMAIL === 'undefined' || user.email === ALLOWED_EMAIL));
                localStorage.setItem('silab_auth', ok ? '1' : '0');
                setPerfNav(ok);
            });
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
