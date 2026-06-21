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
    // 현재 페이지 자동 활성화
    var currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.menu a').forEach(function (link) {
        var href = link.getAttribute('href').replace('./', '');
        link.classList.toggle('active', href === currentPage);
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
