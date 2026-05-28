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

document.addEventListener('DOMContentLoaded', function () {
    // 현재 페이지 자동 활성화
    var currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.menu a').forEach(function (link) {
        var href = link.getAttribute('href').replace('./', '');
        link.classList.toggle('active', href === currentPage);
    });

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
