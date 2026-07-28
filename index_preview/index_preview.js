// index_preview.js - 홈 개편 프리뷰

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth     = firebase.auth();
const database = firebase.database();

let currentUser = null;
let currentSlideIndex = 0;
let slideInterval = null;
let allSlidesData = [];
let researchCardsData = [];
let statsAnimated = false;

const COLOR_MAP = {
    blue:  { gradient: 'linear-gradient(135deg, #005792 0%, #0077be 100%)', icon: 'fa-microscope' },
    red:   { gradient: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)', icon: 'fa-shield-alt'  },
    green: { gradient: 'linear-gradient(135deg, #166534 0%, #16a34a 100%)', icon: 'fa-chart-line'  }
};

// ==================== 인증 ====================
auth.onAuthStateChanged(user => {
    currentUser = (user && ADMIN_EMAILS.indexOf(user.email) >= 0) ? user : null;
    if (user && !currentUser) auth.signOut();
    updateAuthUI();
});

function updateAuthUI() {
    const loginBtn  = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo  = document.getElementById('userInfo');
    const userName  = document.getElementById('userName');
    if (currentUser) {
        loginBtn.style.display  = 'none';
        logoutBtn.style.display = 'inline-flex';
        userInfo.style.display  = 'flex';
        userName.textContent    = currentUser.email;
    } else {
        loginBtn.style.display  = 'inline-flex';
        logoutBtn.style.display = 'none';
        userInfo.style.display  = 'none';
    }
}

// ==================== HERO 슬라이더 ====================
function loadHeroSlider() {
    database.ref('home/slides').once('value').then(snap => {
        const dbData = snap.val();
        if (dbData) {
            allSlidesData = Object.entries(dbData)
                .map(([key, val]) => ({ key, ...val }))
                .sort((a, b) => (a.order || 0) - (b.order || 0));
        } else {
            allSlidesData = [];
        }
        renderHeroSlider();
    });
}

function renderHeroSlider() {
    const slider = document.getElementById('heroSlider');
    const dots   = document.getElementById('heroDots');
    if (!slider || !dots) return;

    slider.innerHTML = '';
    dots.innerHTML   = '';

    if (allSlidesData.length === 0) {
        slider.style.background = 'linear-gradient(135deg, #162d55, #24488c)';
        return;
    }

    allSlidesData.forEach((slide, i) => {
        const img = document.createElement('img');
        img.src       = slide.url;
        img.alt       = slide.alt || '';
        img.className = 'slide' + (i === 0 ? ' active' : '');
        slider.appendChild(img);

        const dot = document.createElement('span');
        dot.className     = 'dot' + (i === 0 ? ' active' : '');
        dot.dataset.index = i;
        dot.addEventListener('click', () => {
            clearInterval(slideInterval);
            goToSlide(i);
            slideInterval = setInterval(nextSlide, 4000);
        });
        dots.appendChild(dot);
    });

    currentSlideIndex = 0;
    clearInterval(slideInterval);
    if (allSlidesData.length > 1) {
        slideInterval = setInterval(nextSlide, 4000);
    }
}

function goToSlide(index) {
    document.querySelectorAll('#heroSlider .slide').forEach((s, i) => s.classList.toggle('active', i === index));
    document.querySelectorAll('#heroDots .dot').forEach((d, i)   => d.classList.toggle('active', i === index));
    currentSlideIndex = index;
}

function nextSlide() {
    const count = document.querySelectorAll('#heroSlider .slide').length;
    if (!count) return;
    goToSlide((currentSlideIndex + 1) % count);
}

// ==================== STATS ====================
function loadStats() {
    const targets = { members: 0, publications: 0, projects: 0, patents: 0 };

    // 멤버 수
    database.ref('members').once('value').then(snap => {
        const d = snap.val() || {};
        let count = 0;
        ['phd', 'ms', 'bs', 'parttime'].forEach(g => {
            if (d[g]) count += Object.keys(d[g]).length;
        });
        targets.members = count;
        document.getElementById('statMembers').dataset.target = count;
        maybeAnimateStats(targets);
    });

    // 논문 수
    database.ref('publications').once('value').then(snap => {
        const d = snap.val() || {};
        let count = 0;
        ['sci', 'kci', 'other'].forEach(g => { if (d[g]) count += Object.keys(d[g]).length; });
        targets.publications = count;
        document.getElementById('statPublications').dataset.target = count;
        maybeAnimateStats(targets);
    });

    // 프로젝트 수
    database.ref('projects').once('value').then(snap => {
        const d = snap.val() || {};
        let count = 0;
        ['current', 'past'].forEach(g => { if (d[g]) count += Object.keys(d[g]).length; });
        targets.projects = count;
        document.getElementById('statProjects').dataset.target = count;
        maybeAnimateStats(targets);
    });

    // 특허 수
    database.ref('patents').once('value').then(snap => {
        const d = snap.val() || {};
        targets.patents = Object.keys(d).length;
        document.getElementById('statPatents').dataset.target = targets.patents;
        maybeAnimateStats(targets);
    });
}

function maybeAnimateStats(targets) {
    if (statsAnimated) return;
    // stats bar가 뷰포트에 들어오면 카운트업
    const bar = document.getElementById('statsBar');
    if (!bar) return;
    const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting && !statsAnimated) {
            statsAnimated = true;
            animateCount('statMembers',      targets.members);
            animateCount('statPublications', targets.publications);
            animateCount('statProjects',     targets.projects);
            animateCount('statPatents',      targets.patents);
            observer.disconnect();
        }
    }, { threshold: 0.4 });
    observer.observe(bar);
}

function animateCount(elId, target) {
    const el = document.getElementById(elId);
    if (!el) return;
    const duration = 1200;
    const start    = performance.now();
    function step(now) {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(ease * target);
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = target;
    }
    requestAnimationFrame(step);
}

// ==================== 연구분야 카드 ====================
function loadResearchCards() {
    const grid = document.getElementById('research-grid');
    if (!grid) return;
    grid.innerHTML = [1,2,3].map(() => `
        <div class="skeleton-card">
            <div class="skeleton skeleton-header"></div>
            <div class="skeleton skeleton-line short"></div>
            <div class="skeleton skeleton-line medium"></div>
            <div class="skeleton skeleton-line full"></div>
        </div>
    `).join('');

    database.ref('home/researchCards').once('value').then(snap => {
        const dbData = snap.val();
        grid.innerHTML = '';
        if (!dbData) {
            grid.innerHTML = '<div class="feed-empty"><i class="fas fa-flask"></i><p style="margin-top:8px;">등록된 연구분야가 없습니다</p></div>';
            return;
        }
        researchCardsData = Object.entries(dbData)
            .map(([key, val]) => ({ key, ...val }))
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        const count = researchCardsData.length;
        grid.style.gridTemplateColumns = count <= 4 ? `repeat(${count}, 1fr)` : 'repeat(4, 1fr)';

        researchCardsData.forEach(card => {
            const col    = card.colorScheme || 'blue';
            const colors = COLOR_MAP[col] || COLOR_MAP.blue;
            const itemsHTML = (card.items || []).map(item => `<li>${item}</li>`).join('');
            const div = document.createElement('div');
            div.className     = 'research-card';
            div.dataset.color = col;
            div.innerHTML = `
                <div class="card-header">
                    <div class="card-icon"><i class="fas ${colors.icon}"></i></div>
                    <div class="card-title">${card.title}</div>
                    <div class="card-subtitle">${card.subtitle}</div>
                </div>
                <ul class="research-list">${itemsHTML}</ul>
            `;
            grid.appendChild(div);
        });
    });
}

// ==================== 최근 논문 ====================
function loadRecentPublications() {
    const container = document.getElementById('recentPubs');
    if (!container) return;

    database.ref('publications').once('value').then(snap => {
        const data  = snap.val() || {};
        const items = [];

        ['sci', 'kci', 'other'].forEach(type => {
            if (!data[type]) return;
            Object.values(data[type]).forEach(pub => {
                items.push({ ...pub, _type: type });
            });
        });

        // 연도 내림차순 정렬 후 최신 3개
        items.sort((a, b) => (b.year || 0) - (a.year || 0));
        const recent = items.slice(0, 3);

        container.innerHTML = '';

        if (recent.length === 0) {
            container.innerHTML = '<div class="feed-empty"><i class="fas fa-file-alt"></i><p style="margin-top:8px;">등록된 논문이 없습니다</p></div>';
            return;
        }

        recent.forEach(pub => {
            const badgeClass = pub._type === 'sci' ? 'sci' : pub._type === 'kci' ? 'kci' : 'other';
            const badgeLabel = pub._type === 'sci' ? 'SCI' : pub._type === 'kci' ? 'KCI' : 'Other';
            const card = document.createElement('div');
            card.className = 'pub-card';
            card.innerHTML = `
                <span class="pub-badge ${badgeClass}">${badgeLabel}</span>
                <div class="pub-title">${pub.title || '(제목 없음)'}</div>
                <div class="pub-meta">
                    <span>${pub.authors || ''}</span>
                    ${pub.year ? `<span>${pub.year}</span>` : ''}
                    ${pub.journal || pub.conference ? `<span>${pub.journal || pub.conference}</span>` : ''}
                </div>
            `;
            container.appendChild(card);
        });
    });
}

// ==================== 진행 중인 프로젝트 ====================
function loadRecentProjects() {
    const container = document.getElementById('recentProjects');
    if (!container) return;

    database.ref('projects/current').once('value').then(snap => {
        const data = snap.val();
        container.innerHTML = '';

        if (!data) {
            container.innerHTML = '<div class="feed-empty"><i class="fas fa-project-diagram"></i><p style="margin-top:8px;">진행 중인 프로젝트가 없습니다</p></div>';
            return;
        }

        const items = Object.values(data);
        // 최신 3개 (start_year 내림차순)
        items.sort((a, b) => (b.start_year || 0) - (a.start_year || 0));
        const recent = items.slice(0, 3);

        recent.forEach(proj => {
            const period = [proj.start_year, proj.end_year].filter(Boolean).join(' – ');
            const item = document.createElement('div');
            item.className = 'project-feed-item';
            item.innerHTML = `
                <div class="project-feed-icon"><i class="fas fa-flask"></i></div>
                <div class="project-feed-body">
                    <div class="project-feed-name">${proj.title || proj.name || '(제목 없음)'}</div>
                    <div class="project-feed-meta">
                        ${period ? `<span><i class="fas fa-calendar"></i>${period}</span>` : ''}
                        ${proj.agency || proj.organization ? `<span><i class="fas fa-building"></i>${proj.agency || proj.organization}</span>` : ''}
                    </div>
                </div>
                <span class="project-status">진행 중</span>
            `;
            container.appendChild(item);
        });
    });
}

// ==================== DOMContentLoaded ====================
document.addEventListener('DOMContentLoaded', () => {
    loadHeroSlider();
    loadStats();
    loadResearchCards();
    loadRecentPublications();
    loadRecentProjects();

    // 로그인/로그아웃
    document.getElementById('loginBtn').addEventListener('click', () => {
        document.getElementById('loginModal').style.display = 'flex';
    });
    document.getElementById('loginClose').addEventListener('click', () => {
        document.getElementById('loginModal').style.display = 'none';
    });
    document.getElementById('loginModal').addEventListener('click', e => {
        if (e.target === document.getElementById('loginModal'))
            document.getElementById('loginModal').style.display = 'none';
    });
    document.getElementById('loginForm').addEventListener('submit', e => {
        e.preventDefault();
        auth.signInWithEmailAndPassword(
            document.getElementById('email').value,
            document.getElementById('password').value
        ).then(() => {
            document.getElementById('loginModal').style.display = 'none';
            document.getElementById('loginForm').reset();
        }).catch(err => alert('로그인 실패: ' + err.message));
    });
    document.getElementById('logoutBtn').addEventListener('click', () => auth.signOut());

    // 키보드 슬라이더
    document.addEventListener('keydown', e => {
        const count = document.querySelectorAll('#heroSlider .slide').length;
        if (!count) return;
        if (e.key === 'ArrowLeft') {
            clearInterval(slideInterval);
            goToSlide((currentSlideIndex - 1 + count) % count);
            slideInterval = setInterval(nextSlide, 4000);
        } else if (e.key === 'ArrowRight') {
            clearInterval(slideInterval);
            goToSlide((currentSlideIndex + 1) % count);
            slideInterval = setInterval(nextSlide, 4000);
        }
    });
});
