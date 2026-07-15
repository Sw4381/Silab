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

// 세션 만료 자동 로그아웃 — 로그인 후 1시간 경과 시 자동 로그아웃 (보안)
// 만료 1분 전에 연장 여부를 묻는 모달을 띄우고, '연장'을 누르면 1시간이 다시 시작된다.
// 세션 시작 시각을 localStorage 에 저장하므로 페이지 이동/탭 닫힘 후 재접속에도 만료가 판정된다.
function setupSessionTimeout() {
    var SESSION_MS = 60 * 60 * 1000;   // 세션 길이 1시간
    var WARN_MS = 60 * 1000;           // 만료 60초 전부터 연장 안내 모달 표시
    var SESSION_LABEL = SESSION_MS >= 60000 ? Math.round(SESSION_MS / 60000) + '분' : Math.round(SESSION_MS / 1000) + '초';
    var KEY = 'silab_session_start';
    var modal = null, msgEl = null, badge = null;

    function sessionStart() { return Number(localStorage.getItem(KEY) || 0); }
    function resetSession() { try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {} }
    function clearSession() { try { localStorage.removeItem(KEY); } catch (e) {} }

    function toast(text) {
        var d = document.createElement('div');
        d.textContent = text;
        d.style.cssText = 'position:fixed;top:20px;right:20px;z-index:4000;background:#fff3cd;color:#856404;border:1px solid #ffeaa7;padding:12px 16px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);font-size:14px;';
        document.body.appendChild(d);
        setTimeout(function () { d.remove(); }, 5000);
    }

    function doLogout(reason) {
        hideModal(); hideBadge();
        try { localStorage.setItem('silab_auth', '0'); } catch (e) {}
        clearSession();
        try { firebase.auth().signOut(); } catch (e) {}
        if (reason) toast(reason);
    }

    // 연장 안내 모달 (모든 페이지에서 쓰도록 JS 로 직접 생성)
    function showModal(remainSec) {
        if (!modal) {
            modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
            var box = document.createElement('div');
            box.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px;max-width:360px;width:90%;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.3);';
            var h = document.createElement('h3');
            h.textContent = '세션 만료 예정';
            h.style.cssText = 'margin:0 0 10px;font-size:18px;color:#333;';
            msgEl = document.createElement('p');
            msgEl.style.cssText = 'margin:0 0 20px;font-size:14px;color:#666;line-height:1.6;';
            var btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';
            var extendBtn = document.createElement('button');
            extendBtn.textContent = SESSION_LABEL + ' 연장';
            extendBtn.style.cssText = 'padding:10px 22px;border:none;border-radius:8px;background:#2c5aa0;color:#fff;font-size:14px;cursor:pointer;';
            extendBtn.addEventListener('click', function () { resetSession(); hideModal(); });
            var outBtn = document.createElement('button');
            outBtn.textContent = '로그아웃';
            outBtn.style.cssText = 'padding:10px 22px;border:1px solid #ccc;border-radius:8px;background:#fff;color:#555;font-size:14px;cursor:pointer;';
            outBtn.addEventListener('click', function () { doLogout('로그아웃되었습니다.'); });
            btnRow.appendChild(extendBtn); btnRow.appendChild(outBtn);
            box.appendChild(h); box.appendChild(msgEl); box.appendChild(btnRow);
            modal.appendChild(box);
            document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
        msgEl.textContent = remainSec + '초 후 자동 로그아웃됩니다. 세션을 연장하시겠습니까?';
    }
    function hideModal() { if (modal) modal.style.display = 'none'; }

    // 세션 남은 시간 배지 (우측 하단, 로그인 중에만 표시. 클릭하면 즉시 연장)
    function updateBadge(remainMs) {
        if (!badge) {
            badge = document.createElement('div');
            badge.title = '클릭하면 세션이 ' + SESSION_LABEL + ' 연장됩니다';
            badge.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:3900;padding:8px 14px;border-radius:20px;font-size:13px;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,0.25);user-select:none;';
            badge.addEventListener('click', function () { resetSession(); });
            document.body.appendChild(badge);
        }
        var sec = Math.max(0, Math.ceil(remainMs / 1000));
        var mm = Math.floor(sec / 60), ss = sec % 60;
        badge.textContent = '⏱ 세션 ' + (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
        var warn = remainMs <= WARN_MS * 2;   // 만료가 가까우면 경고색
        badge.style.background = warn ? '#dc3545' : 'rgba(44,90,160,0.92)';
        badge.style.color = '#fff';
        badge.style.display = '';
    }
    function hideBadge() { if (badge) badge.style.display = 'none'; }

    function check() {
        try {
            if (!firebase.apps.length || !firebase.auth().currentUser) { hideModal(); hideBadge(); return; }
        } catch (e) { return; }
        var start = sessionStart();
        if (!start) { resetSession(); return; }
        var remain = SESSION_MS - (Date.now() - start);
        if (remain <= 0) { doLogout(SESSION_LABEL + ' 세션이 만료되어 자동 로그아웃되었습니다.'); return; }
        updateBadge(remain);
        if (remain <= WARN_MS) showModal(Math.ceil(remain / 1000));
        else hideModal();   // 다른 탭에서 연장한 경우 모달 정리
    }

    // 로그인 확인 시: 저장된 세션 시작 시각이 없으면 지금을 시작으로 기록,
    // 이미 20분이 지난 상태(탭 닫아둔 채 방치 등)면 즉시 로그아웃
    firebase.auth().onAuthStateChanged(function (user) {
        if (!user) { clearSession(); hideModal(); hideBadge(); return; }
        var start = sessionStart();
        if (!start) resetSession();
        else if (Date.now() - start > SESSION_MS) doLogout(SESSION_LABEL + ' 세션이 만료되어 자동 로그아웃되었습니다.');
    });

    setInterval(check, 1000);   // 1초마다 만료/카운트다운 갱신
}

document.addEventListener('DOMContentLoaded', function () {
    // 현재 페이지 자동 활성화 (탭으로 묶인 서브페이지는 부모 메뉴를 활성화)
    var currentPage = window.location.pathname.split('/').pop() || 'index.html';
    var navAlias = { 'member-performance.html': 'performance.html', 'team-performance.html': 'performance.html', 'payroll.html': 'budget.html', 'activity.html': 'budget.html' };
    var activePage = navAlias[currentPage] || currentPage;
    document.querySelectorAll('.menu a').forEach(function (link) {
        var href = link.getAttribute('href').replace('./', '');
        link.classList.toggle('active', href === activePage);
    });
    // 업무관리 드롭다운: 하위 메뉴가 활성이면 부모 버튼도 강조
    document.querySelectorAll('.menu .nav-drop').forEach(function (drop) {
        var btn = drop.querySelector('.nav-drop-btn');
        if (btn) btn.classList.toggle('active', !!drop.querySelector('.nav-drop-menu a.active'));
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
            setupSessionTimeout();   // 로그인 1시간 후 자동 로그아웃 (만료 전 연장 선택)
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
