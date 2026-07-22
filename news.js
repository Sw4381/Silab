// news.js - 보안 뉴스 검색 (네이버 뉴스 검색 API, Cloudflare Worker 중계)
//
// 네이버 API 키는 이 저장소에 없다. worker/news-proxy.js(Cloudflare Worker)에만
// 비밀 변수로 저장되며, 아래 NEWS_PROXY_URL이 그 Worker 주소다. (배포: worker/README.md)

// ⚠ Worker 배포 후 발급되는 주소로 교체할 것 (예: 'https://silab-news.xxxx.workers.dev')
var NEWS_PROXY_URL = 'https://floral-river-472f.dltjs5621.workers.dev';

// Firebase(news/keywords)에서 못 읽을 때 쓰는 기본 키워드 채널 — 연구주제(LLM 보안,
// Agentic AI 레드티밍, 엔드포인트/TTP 분석, SOC 오탐 감소)에 맞춘 검색어
var DEFAULT_KEYWORDS = ['LLM 보안', 'AI 에이전트 보안', '프롬프트 인젝션', 'AI 레드팀', '보안관제', '엔드포인트 보안', '위협 인텔리전스', 'APT 공격', '침해사고'];

var PAGE_SIZE = 24;        // 한 번에 가져올 기사 수 (네이버 최대 100)
var MAX_START = 1000;      // 네이버 API가 허용하는 시작 위치 상한

// ==================== 전역 상태 ====================
var auth = null, database = null;
var currentUser = null;
var keywords = DEFAULT_KEYWORDS.slice();
var searchState = { query: '', sort: 'date', start: 1, total: 0, loading: false };

// ==================== 알림 ====================
function showAlert(message, type) {
    var alert = document.createElement('div');
    alert.textContent = message;
    alert.style.cssText = 'position:fixed;top:20px;right:20px;z-index:1002;max-width:400px;padding:15px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);';
    if (type === 'success') { alert.style.background = '#d4edda'; alert.style.color = '#155724'; alert.style.border = '1px solid #c3e6cb'; }
    else if (type === 'error') { alert.style.background = '#f8d7da'; alert.style.color = '#721c24'; alert.style.border = '1px solid #f5c6cb'; }
    else { alert.style.background = '#fff3cd'; alert.style.color = '#856404'; alert.style.border = '1px solid #ffeaa7'; }
    document.body.appendChild(alert);
    setTimeout(function () { alert.remove(); }, 3000);
}

// ==================== 렌더링 도우미 ====================
// 네이버 API는 제목/요약에 검색어 강조용 <b> 태그와 HTML 엔티티를 섞어 보낸다.
// 전부 이스케이프한 뒤 <b>만 되살려 XSS 없이 강조를 유지한다.
function sanitizeApiHtml(str) {
    // template 요소는 innerHTML을 넣어도 스크립트·이미지가 실행되지 않는 inert 파서다.
    var tpl = document.createElement('template');
    tpl.innerHTML = String(str == null ? '' : str);
    var out = '';
    tpl.content.childNodes.forEach(function (node) {
        if (node.nodeType === 1 && node.tagName === 'B') out += '<b>' + escHtml(node.textContent) + '</b>';
        else out += escHtml(node.textContent);
    });
    return out;
}

function pressName(item) {
    try {
        var host = new URL(item.originallink || item.link).hostname.replace(/^www\./, '');
        return host;
    } catch (e) { return '언론사'; }
}

function formatDate(pubDate) {
    var d = new Date(pubDate);
    if (isNaN(d)) return '';
    var diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
    var rel = '';
    if (diffMin < 60) rel = diffMin + '분 전';
    else if (diffMin < 60 * 24) rel = Math.floor(diffMin / 60) + '시간 전';
    else if (diffMin < 60 * 24 * 7) rel = Math.floor(diffMin / 60 / 24) + '일 전';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var abs = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return rel ? abs + ' (' + rel + ')' : abs;
}

// ==================== 검색 ====================
function runSearch(query, opts) {
    opts = opts || {};
    query = String(query || '').trim();
    if (!query) return;

    var results = document.getElementById('newsResults');
    var status = document.getElementById('newsStatus');
    var moreBtn = document.getElementById('newsMoreBtn');

    if (!NEWS_PROXY_URL) {
        status.style.display = '';
        status.className = 'news-status error';
        status.textContent = '뉴스 검색 서버(NEWS_PROXY_URL)가 아직 설정되지 않았습니다. worker/README.md를 참고해 Worker를 배포한 뒤 news.js에 주소를 입력하세요.';
        return;
    }
    if (searchState.loading) return;

    var append = !!opts.append;
    if (!append) {
        searchState.query = query;
        searchState.sort = document.getElementById('newsSort').value;
        searchState.start = 1;
        searchState.total = 0;
        results.innerHTML = '<div class="news-loading"><i class="fas fa-circle-notch fa-spin"></i>뉴스를 검색하는 중...</div>';
        document.getElementById('newsQuery').value = query;
        highlightChip(query);
    }
    searchState.loading = true;
    moreBtn.disabled = true;

    var url = NEWS_PROXY_URL.replace(/\/$/, '') +
        '/?query=' + encodeURIComponent(searchState.query) +
        '&display=' + PAGE_SIZE +
        '&start=' + searchState.start +
        '&sort=' + searchState.sort;

    fetch(url)
        .then(function (r) {
            return r.json().then(function (data) {
                if (!r.ok) throw new Error(data.error || data.errorMessage || ('요청 실패 (' + r.status + ')'));
                return data;
            });
        })
        .then(function (data) {
            searchState.total = data.total || 0;
            searchState.start += PAGE_SIZE;
            if (!append) results.innerHTML = '';

            var items = data.items || [];
            if (!items.length && !append) {
                results.innerHTML = '<div class="news-empty"><i class="far fa-newspaper"></i>검색 결과가 없습니다.</div>';
            }
            items.forEach(function (item) {
                var a = document.createElement('a');
                a.className = 'news-card';
                a.href = item.originallink || item.link;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.innerHTML =
                    '<div class="news-card-title">' + sanitizeApiHtml(item.title) + '</div>' +
                    '<div class="news-card-desc">' + sanitizeApiHtml(item.description) + '</div>' +
                    '<div class="news-card-meta">' +
                        '<span class="news-card-press">' + escHtml(pressName(item)) + '</span>' +
                        '<span><i class="far fa-clock"></i> ' + escHtml(formatDate(item.pubDate)) + '</span>' +
                    '</div>';
                results.appendChild(a);
            });

            var shown = results.querySelectorAll('.news-card').length;
            status.style.display = '';
            status.className = 'news-status';
            status.innerHTML = '"<b>' + escHtml(searchState.query) + '</b>" 검색 결과 약 ' +
                '<span class="news-status-count">' + Number(searchState.total).toLocaleString('ko-KR') + '건</span>' +
                ' 중 ' + shown + '건 표시 · ' + (searchState.sort === 'date' ? '최신순' : '정확도순');

            var hasMore = items.length === PAGE_SIZE && searchState.start <= Math.min(searchState.total, MAX_START);
            moreBtn.style.display = hasMore ? '' : 'none';
        })
        .catch(function (err) {
            status.style.display = '';
            status.className = 'news-status error';
            status.textContent = '뉴스 검색 실패: ' + err.message;
            if (!append) results.innerHTML = '';
        })
        .finally(function () {
            searchState.loading = false;
            moreBtn.disabled = false;
        });
}

// ==================== 키워드 채널 ====================
function renderKeywords() {
    var wrap = document.getElementById('newsKeywords');
    wrap.innerHTML = '';
    keywords.forEach(function (kw) {
        var chip = document.createElement('span');
        chip.className = 'news-kw-chip';
        chip.textContent = kw;
        chip.addEventListener('click', function () { runSearch(kw); });
        wrap.appendChild(chip);
    });
}

function highlightChip(query) {
    document.querySelectorAll('.news-kw-chip').forEach(function (chip) {
        chip.classList.toggle('active', chip.textContent === query);
    });
}

function loadKeywords() {
    if (!database) { renderKeywords(); return; }
    database.ref('news/keywords').once('value')
        .then(function (snap) {
            var val = snap.val();
            if (Array.isArray(val) && val.length) keywords = val.filter(Boolean).map(String);
            renderKeywords();
        })
        .catch(function () { renderKeywords(); });   // 규칙 미설정 등 → 기본 키워드 사용
}

function saveKeywords(list) {
    if (!database || !currentUser) { showAlert('로그인이 필요합니다.', 'warning'); return; }
    database.ref('news/keywords').set(list)
        .then(function () {
            keywords = list;
            renderKeywords();
            document.getElementById('keywordModal').style.display = 'none';
            showAlert('키워드 채널이 저장되었습니다.', 'success');
        })
        .catch(function (err) {
            showAlert('저장 실패: ' + err.message + ' (Firebase 규칙에 news 노드 write 허용 필요)', 'error');
        });
}

// ==================== 인증 ====================
function loginUser(email, password) {
    if (ADMIN_EMAILS.indexOf(email) < 0) {
        return Promise.reject(new Error('접근 권한이 없습니다. 연구실 멤버만 사용할 수 있습니다.'));
    }
    return auth.signInWithEmailAndPassword(email, password);
}

function updateAuthUI() {
    // 로그인 전용 페이지: 관리자 계정(일반/Root)으로 로그인해야 내용이 보인다 (worklog와 동일 기준)
    var isAdmin = !!(currentUser && (currentUser.uid === ADMIN_UID || currentUser.uid === ROOT_UID));
    var loginBtn = document.getElementById('loginBtn');
    var logoutBtn = document.getElementById('logoutBtn');
    var userInfo = document.getElementById('userInfo');
    var userName = document.getElementById('userName');
    if (currentUser) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'flex';
        userInfo.style.display = 'flex';
        userName.textContent = currentUser.email;
    } else {
        loginBtn.style.display = 'flex';
        logoutBtn.style.display = 'none';
        userInfo.style.display = 'none';
    }
    document.getElementById('newsAdminPanel').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('newsContent').style.display = isAdmin ? '' : 'none';
    document.getElementById('newsLoginNotice').style.display = isAdmin ? 'none' : '';
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
        auth.onAuthStateChanged(function (user) {
            currentUser = user;
            updateAuthUI();
        });
    } catch (e) {
        console.error('Firebase 초기화 실패:', e);
    }
    loadKeywords();

    // 검색 폼
    document.getElementById('newsSearchForm').addEventListener('submit', function (e) {
        e.preventDefault();
        runSearch(document.getElementById('newsQuery').value);
    });
    document.getElementById('newsSort').addEventListener('change', function () {
        if (searchState.query) runSearch(searchState.query);
    });
    document.getElementById('newsMoreBtn').addEventListener('click', function () {
        runSearch(searchState.query, { append: true });
    });

    // 로그인 모달
    var loginModal = document.getElementById('loginModal');
    document.getElementById('loginBtn').addEventListener('click', function () { loginModal.style.display = 'block'; });
    document.getElementById('loginClose').addEventListener('click', function () { loginModal.style.display = 'none'; });
    document.getElementById('logoutBtn').addEventListener('click', function () {
        auth.signOut().then(function () { showAlert('로그아웃되었습니다.', 'success'); });
    });
    document.getElementById('loginForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('email').value;
        var password = document.getElementById('password').value;
        loginUser(email, password)
            .then(function () {
                loginModal.style.display = 'none';
                document.getElementById('loginForm').reset();
                showAlert('로그인 성공!', 'success');
            })
            .catch(function (err) { showAlert('로그인 실패: ' + err.message, 'error'); });
    });

    // 키워드 편집 모달 (관리자)
    var keywordModal = document.getElementById('keywordModal');
    document.getElementById('editKeywordsBtn').addEventListener('click', function () {
        document.getElementById('keywordTextarea').value = keywords.join('\n');
        keywordModal.style.display = 'block';
    });
    document.getElementById('keywordModalClose').addEventListener('click', function () {
        keywordModal.style.display = 'none';
    });
    document.getElementById('keywordSaveBtn').addEventListener('click', function () {
        var list = document.getElementById('keywordTextarea').value
            .split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (!list.length) { showAlert('키워드를 1개 이상 입력하세요.', 'warning'); return; }
        saveKeywords(list);
    });
});
