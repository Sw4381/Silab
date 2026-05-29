// index.js - Firebase 기반 홈페이지 관리
// 설정값은 config.js 참조

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth     = firebase.auth();
const database = firebase.database();

// ==================== 상태 ====================
let currentUser        = null;
let isEditMode         = false;
let isDeleteMode       = false;
let currentSlideIndex  = 0;
let slideInterval      = null;
let allSlidesData      = [];
let researchCardsData  = [];
let editingCardKey     = null;
let statsAnimated      = false;

const COLOR_MAP = {
    blue:  { gradient: 'linear-gradient(135deg, #005792 0%, #0077be 100%)', icon: 'fa-microscope' },
    red:   { gradient: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)', icon: 'fa-shield-alt'  },
    green: { gradient: 'linear-gradient(135deg, #166534 0%, #16a34a 100%)', icon: 'fa-chart-line'  }
};

// ==================== 인증 ====================
auth.onAuthStateChanged(user => {
    if (user && user.email === ALLOWED_EMAIL) {
        currentUser = user;
    } else {
        currentUser  = null;
        isEditMode   = false;
        isDeleteMode = false;
        if (user) auth.signOut();
    }
    updateAuthUI();
    renderResearchCardsUI();
    updateSliderDeleteOverlay();
});

function updateAuthUI() {
    const loginBtn   = document.getElementById('loginBtn');
    const logoutBtn  = document.getElementById('logoutBtn');
    const userInfo   = document.getElementById('userInfo');
    const userName   = document.getElementById('userName');
    const adminPanel = document.getElementById('homeAdminPanel');

    if (currentUser) {
        loginBtn.style.display   = 'none';
        logoutBtn.style.display  = 'inline-flex';
        userInfo.style.display   = 'flex';
        userName.textContent     = currentUser.email;
        adminPanel.style.display = 'block';
    } else {
        loginBtn.style.display   = 'inline-flex';
        logoutBtn.style.display  = 'none';
        userInfo.style.display   = 'none';
        adminPanel.style.display = 'none';
    }
}

// ==================== HERO 슬라이더 ====================
function loadAndRenderSlides() {
    const wrapper = document.getElementById('slider-wrapper');
    if (wrapper) wrapper.style.background = 'linear-gradient(135deg, #162d55, #24488c)';

    database.ref('home/slides').once('value').then(snap => {
        const dbData = snap.val();
        if (dbData) {
            allSlidesData = Object.entries(dbData)
                .map(([key, val]) => ({ key, ...val }))
                .sort((a, b) => (a.order || 0) - (b.order || 0));
        } else {
            allSlidesData = [];
        }
        renderSlider();
    });
}

function renderSlider() {
    const wrapper = document.getElementById('slider-wrapper');
    const dotsEl  = document.getElementById('slider-dots');
    if (!wrapper || !dotsEl) return;

    wrapper.innerHTML = '';
    dotsEl.innerHTML  = '';

    if (allSlidesData.length === 0) {
        wrapper.style.background = 'linear-gradient(135deg, #162d55, #24488c)';
        return;
    }
    wrapper.style.background = '';

    allSlidesData.forEach((slide, i) => {
        const img = document.createElement('img');
        img.src       = slide.url;
        img.alt       = slide.alt || '';
        img.className = 'slide' + (i === 0 ? ' active' : '');
        wrapper.appendChild(img);

        const dot = document.createElement('span');
        dot.className     = 'dot' + (i === 0 ? ' active' : '');
        dot.dataset.index = i;
        dot.addEventListener('click', () => {
            clearInterval(slideInterval);
            goToSlide(i);
            slideInterval = setInterval(nextSlide, 4000);
        });
        dotsEl.appendChild(dot);
    });

    currentSlideIndex = 0;
    clearInterval(slideInterval);
    if (allSlidesData.length > 1) {
        slideInterval = setInterval(nextSlide, 4000);
    }
    updateSliderDeleteOverlay();
}

function goToSlide(index) {
    document.querySelectorAll('#slider-wrapper .slide').forEach((s, i) => s.classList.toggle('active', i === index));
    document.querySelectorAll('#slider-dots .dot').forEach((d, i)     => d.classList.toggle('active', i === index));
    currentSlideIndex = index;
}

function nextSlide() {
    const count = document.querySelectorAll('#slider-wrapper .slide').length;
    if (!count) return;
    goToSlide((currentSlideIndex + 1) % count);
}

function updateSliderDeleteOverlay() {
    const heroSection = document.getElementById('heroSection');
    if (!heroSection) return;
    let overlay = heroSection.querySelector('.slide-delete-overlay');
    if (currentUser && isDeleteMode) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'slide-delete-overlay';
            overlay.style.cssText = 'position:absolute;top:70px;right:16px;z-index:20;';
            overlay.innerHTML = '<button onclick="deleteCurrentSlide()" style="background:rgba(220,53,69,0.9);color:white;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px;"><i class=\'fas fa-trash\'></i> 현재 슬라이드 삭제</button>';
            heroSection.appendChild(overlay);
        }
    } else if (overlay) {
        overlay.remove();
    }
}

window.deleteCurrentSlide = function () {
    if (!allSlidesData[currentSlideIndex]) return;
    if (!confirm('현재 슬라이드를 삭제하시겠습니까?')) return;
    const key = allSlidesData[currentSlideIndex].key;
    database.ref('home/slides/' + key).remove().then(() => {
        allSlidesData.splice(currentSlideIndex, 1);
        currentSlideIndex = Math.max(0, currentSlideIndex - 1);
        renderSlider();
    }).catch(err => alert('삭제 실패: ' + err.message));
};

// ==================== 슬라이드 순서 변경 ====================
let reorderDragSrcIndex = null;

function openSlideReorderModal() {
    const list = document.getElementById('slideReorderList');
    list.innerHTML = '';
    allSlidesData.forEach((slide, i) => {
        const li = document.createElement('li');
        li.draggable       = true;
        li.dataset.index   = i;
        li.style.cssText   = 'display:flex;align-items:center;gap:12px;padding:10px 12px;margin-bottom:8px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:grab;user-select:none;transition:background 0.15s;';
        li.innerHTML = `
            <i class="fas fa-grip-vertical" style="color:#aaa;font-size:16px;"></i>
            <img src="${slide.url}" alt="${slide.alt || ''}" style="width:80px;height:52px;object-fit:cover;border-radius:4px;flex-shrink:0;">
            <span style="font-size:0.9rem;color:#333;flex:1;">${slide.alt || '(설명 없음)'}</span>
            <span style="font-size:0.8rem;color:#aaa;">#${i + 1}</span>
        `;
        li.addEventListener('dragstart', e => {
            reorderDragSrcIndex = +li.dataset.index;
            e.dataTransfer.effectAllowed = 'move';
            li.style.opacity = '0.5';
        });
        li.addEventListener('dragend',  () => { li.style.opacity = '1'; });
        li.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            li.style.background = '#f0f4ff';
        });
        li.addEventListener('dragleave', () => { li.style.background = '#fff'; });
        li.addEventListener('drop', e => {
            e.preventDefault();
            li.style.background = '#fff';
            const targetIndex = +li.dataset.index;
            if (reorderDragSrcIndex === null || reorderDragSrcIndex === targetIndex) return;
            const moved = allSlidesData.splice(reorderDragSrcIndex, 1)[0];
            allSlidesData.splice(targetIndex, 0, moved);
            openSlideReorderModal();
        });
        list.appendChild(li);
    });
    document.getElementById('slideReorderModal').style.display = 'flex';
}

async function saveSlideOrder() {
    const btn = document.getElementById('slideReorderSaveBtn');
    btn.disabled    = true;
    btn.textContent = '저장 중...';
    try {
        const updates = {};
        allSlidesData.forEach((slide, i) => {
            updates[`home/slides/${slide.key}/order`] = i;
            slide.order = i;
        });
        await database.ref().update(updates);
        renderSlider();
        document.getElementById('slideReorderModal').style.display = 'none';
    } catch (err) {
        alert('저장 실패: ' + err.message);
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> 저장';
}

// ==================== 슬라이드 추가 ====================
async function addSlideSubmit(e) {
    e.preventDefault();
    const file = document.getElementById('slideFile').files[0];
    const alt  = document.getElementById('slideAlt').value.trim();
    if (!file) { alert('이미지를 선택해주세요.'); return; }

    const btn         = document.getElementById('slideAddBtn');
    const progressDiv = document.getElementById('slideUploadProgress');
    const progressBar = document.getElementById('slideProgressBar');
    btn.disabled               = true;
    progressDiv.style.display  = 'block';

    const url = await uploadToCloudinary(file, p => { progressBar.style.width = p + '%'; });
    if (!url) {
        alert('업로드 실패');
        btn.disabled              = false;
        progressDiv.style.display = 'none';
        return;
    }

    const order  = allSlidesData.length;
    const newRef = database.ref('home/slides').push();
    await newRef.set({ url, alt, order, isLocal: false });
    allSlidesData.push({ key: newRef.key, url, alt, order, isLocal: false });
    renderSlider();

    document.getElementById('slideAddModal').style.display = 'none';
    document.getElementById('slideAddForm').reset();
    progressDiv.style.display = 'none';
    progressBar.style.width   = '0%';
    btn.disabled = false;
}

// ==================== 연구분야 카드 ====================
function loadAndRenderResearchCards() {
    const grid = document.getElementById('research-grid');
    if (!grid) return;
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    grid.innerHTML = [1,2,3].map(() => `
        <div class="skeleton-card">
            <div class="skeleton skeleton-header"></div>
            <div class="skeleton skeleton-line short" style="margin:12px 16px 6px;"></div>
            <div class="skeleton skeleton-line medium" style="margin:6px 16px;"></div>
            <div class="skeleton skeleton-line full" style="margin:6px 16px;"></div>
        </div>
    `).join('');

    database.ref('home/researchCards').once('value').then(snap => {
        const dbData = snap.val();
        if (dbData) {
            researchCardsData = Object.entries(dbData)
                .map(([key, val]) => ({ key, ...val }))
                .sort((a, b) => (a.order || 0) - (b.order || 0));
        } else {
            researchCardsData = [];
        }
        renderResearchCardsUI();
    });
}

function renderResearchCardsUI() {
    const grid = document.getElementById('research-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (researchCardsData.length === 0 && !currentUser) {
        grid.style.gridTemplateColumns = '1fr';
        grid.innerHTML = `
            <div class="feed-empty">
                <i class="fas fa-flask"></i>
                <p style="margin-top:8px;">등록된 연구분야가 없습니다</p>
                <p style="font-size:0.82rem;margin-top:4px;">관리자가 로그인하여 연구분야를 추가할 수 있습니다.</p>
            </div>`;
        return;
    }

    const count = researchCardsData.length;
    grid.style.gridTemplateColumns = count <= 4 ? `repeat(${count}, 1fr)` : 'repeat(4, 1fr)';

    researchCardsData.sort((a, b) => (a.order || 0) - (b.order || 0));
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

        if (currentUser && isEditMode) {
            const editBtn = document.createElement('button');
            editBtn.innerHTML     = '<i class="fas fa-edit"></i>';
            editBtn.title         = '수정';
            editBtn.style.cssText = 'position:absolute;top:14px;right:50px;background:rgba(59,108,247,0.9);color:white;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:12px;z-index:10;display:flex;align-items:center;justify-content:center;';
            editBtn.onclick = () => openCardModal('edit', card.key);
            div.appendChild(editBtn);
        }
        if (currentUser && isDeleteMode) {
            const delBtn = document.createElement('button');
            delBtn.innerHTML      = '<i class="fas fa-trash"></i>';
            delBtn.title          = '삭제';
            delBtn.style.cssText  = 'position:absolute;top:14px;right:12px;background:rgba(220,53,69,0.9);color:white;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:12px;z-index:10;display:flex;align-items:center;justify-content:center;';
            delBtn.onclick = () => deleteResearchCard(card.key);
            div.appendChild(delBtn);
        }

        grid.appendChild(div);
    });
}

function openCardModal(mode, key) {
    editingCardKey = mode === 'edit' ? key : null;
    document.getElementById('cardModalTitle').textContent = mode === 'edit' ? '연구카드 수정' : '연구카드 추가';

    if (mode === 'edit' && key) {
        const card = researchCardsData.find(c => c.key === key);
        if (card) {
            document.getElementById('cardTitle').value    = card.title || '';
            document.getElementById('cardSubtitle').value = card.subtitle || '';
            document.getElementById('cardColor').value    = card.colorScheme || 'blue';
            document.getElementById('cardItems').value    = (card.items || []).join('\n');
        }
    } else {
        document.getElementById('cardForm').reset();
    }
    document.getElementById('cardModal').style.display = 'flex';
}

function saveResearchCard(e) {
    e.preventDefault();
    const btn = document.getElementById('cardSaveBtn');
    btn.disabled = true;
    const data = {
        title:       document.getElementById('cardTitle').value.trim(),
        subtitle:    document.getElementById('cardSubtitle').value.trim(),
        colorScheme: document.getElementById('cardColor').value,
        items:       document.getElementById('cardItems').value.split('\n').filter(Boolean)
    };

    if (editingCardKey) {
        const existing = researchCardsData.find(c => c.key === editingCardKey);
        data.order = existing ? existing.order : researchCardsData.length;
        database.ref('home/researchCards/' + editingCardKey).update(data)
            .then(() => {
                const idx = researchCardsData.findIndex(c => c.key === editingCardKey);
                if (idx !== -1) researchCardsData[idx] = { ...researchCardsData[idx], ...data };
                renderResearchCardsUI();
                document.getElementById('cardModal').style.display = 'none';
                btn.disabled = false;
            })
            .catch(err => { alert('저장 실패: ' + err.message); btn.disabled = false; });
    } else {
        data.order = researchCardsData.length + 1;
        const newRef = database.ref('home/researchCards').push();
        newRef.set(data)
            .then(() => {
                researchCardsData.push({ key: newRef.key, ...data });
                renderResearchCardsUI();
                document.getElementById('cardModal').style.display = 'none';
                btn.disabled = false;
            })
            .catch(err => { alert('저장 실패: ' + err.message); btn.disabled = false; });
    }
}

function deleteResearchCard(key) {
    if (!confirm('이 연구카드를 삭제하시겠습니까?')) return;
    database.ref('home/researchCards/' + key).remove()
        .then(() => {
            researchCardsData = researchCardsData.filter(c => c.key !== key);
            renderResearchCardsUI();
        })
        .catch(err => alert('삭제 실패: ' + err.message));
}

// ==================== 동적 콘텐츠 통합 로드 (Firebase 중복 읽기 제거) ====================
function loadDynamicContent() {
    Promise.all([
        database.ref('members').once('value'),
        database.ref('publications').once('value'),
        database.ref('current projects').once('value'),
        database.ref('past projects').once('value'),
        database.ref('patents').once('value')
    ]).then(([membersSnap, pubsSnap, curSnap, pastSnap, patentsSnap]) => {
        const members  = membersSnap.val()  || {};
        const pubs     = pubsSnap.val()     || {};
        const curProj  = curSnap.val()      || null;
        const pastProj = pastSnap.val()     || {};
        const patents  = patentsSnap.val()  || {};

        renderStats(members, pubs, curProj, pastProj, patents);
        renderRecentPubs(pubs);
        renderRecentProjects(curProj);
    }).catch(err => {
        console.error('동적 콘텐츠 로드 실패:', err);
    });
}

function renderStats(members, pubs, curProj, pastProj, patents) {
    if (statsAnimated) return;
    statsAnimated = true;

    let ft = 0;
    ['phd', 'ms', 'bs'].forEach(g => { if (members[g]) ft += Object.keys(members[g]).length; });
    if (members.professor) ft += 1;

    const counts = {
        fulltime: ft,
        parttime: members.parttime ? Object.keys(members.parttime).length : 0,
        alumni:   members.alumni   ? Object.keys(members.alumni).length   : 0,
        sci:      pubs.sci         ? Object.keys(pubs.sci).length         : 0,
        kci:      pubs.kci         ? Object.keys(pubs.kci).length         : 0,
        conf:     pubs.other       ? Object.keys(pubs.other).length       : 0,
        projects: (curProj  ? Object.keys(curProj).length  : 0)
                + (pastProj ? Object.keys(pastProj).length : 0),
        patents:  Object.keys(patents).length
    };

    animateCount('statFulltime', counts.fulltime);
    animateCount('statParttime', counts.parttime);
    animateCount('statAlumni',   counts.alumni);
    animateCount('statSci',      counts.sci);
    animateCount('statKci',      counts.kci);
    animateCount('statConf',     counts.conf);
    animateCount('statProjects', counts.projects);
    animateCount('statPatents',  counts.patents);
}

function animateCount(elId, target) {
    const el = document.getElementById(elId);
    if (!el) return;
    const duration = 1000;
    const start    = performance.now();
    function step(now) {
        const t    = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(ease * target);
        if (t < 1) requestAnimationFrame(step);
        else el.textContent = target;
    }
    requestAnimationFrame(step);
}

function renderRecentPubs(pubs) {
    const container = document.getElementById('recentPubs');
    if (!container) return;

    const items = [];
    ['sci', 'kci', 'other'].forEach(type => {
        if (!pubs[type]) return;
        Object.values(pubs[type]).forEach(pub => items.push({ ...pub, _type: type }));
    });

    items.sort((a, b) => (b.year || 0) - (a.year || 0));
    const recent = items.slice(0, 3);

    container.innerHTML = '';
    if (recent.length === 0) {
        container.innerHTML = '<div class="feed-empty"><i class="fas fa-file-alt"></i><p style="margin-top:8px;">등록된 논문이 없습니다</p></div>';
        return;
    }

    recent.forEach(pub => {
        const badgeClass = pub._type === 'sci' ? 'sci' : pub._type === 'kci' ? 'kci' : 'other';
        const badgeLabel = pub._type === 'sci' ? 'SCI' : pub._type === 'kci' ? 'KCI' : 'Conf';
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
}

function renderRecentProjects(curProj) {
    const container = document.getElementById('recentProjects');
    if (!container) return;

    container.innerHTML = '';
    if (!curProj) {
        container.innerHTML = '<div class="feed-empty"><i class="fas fa-project-diagram"></i><p style="margin-top:8px;">진행 중인 프로젝트가 없습니다</p></div>';
        return;
    }

    const items = Object.values(curProj)
        .filter(p => p && p.name)
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    if (items.length === 0) {
        container.innerHTML = '<div class="feed-empty"><i class="fas fa-project-diagram"></i><p style="margin-top:8px;">진행 중인 프로젝트가 없습니다</p></div>';
        return;
    }

    items.forEach(proj => {
        const item = document.createElement('div');
        item.className = 'project-feed-item';
        item.innerHTML = `
            <div class="project-feed-icon"><i class="fas fa-flask"></i></div>
            <div class="project-feed-body">
                <div class="project-feed-name">${proj.name || '(제목 없음)'}</div>
                <div class="project-feed-meta">
                    ${proj.period ? `<span><i class="fas fa-calendar"></i>${proj.period}</span>` : ''}
                </div>
            </div>
            <span class="project-status">진행 중</span>
        `;
        container.appendChild(item);
    });
}

// ==================== 이미지 압축 ====================
async function compressImage(file) {
    const COMPRESS_TARGET = 8 * 1024 * 1024;
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            const MAX_PX = 4000;
            if (width > MAX_PX || height > MAX_PX) {
                const ratio = Math.min(MAX_PX / width, MAX_PX / height);
                width  = Math.round(width  * ratio);
                height = Math.round(height * ratio);
            }
            canvas.width  = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            let quality = 0.85;
            const tryCompress = () => {
                canvas.toBlob(blob => {
                    if (!blob) { resolve(file); return; }
                    if (blob.size <= COMPRESS_TARGET || quality <= 0.3) {
                        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                    } else {
                        quality -= 0.1;
                        tryCompress();
                    }
                }, 'image/jpeg', quality);
            };
            tryCompress();
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

// ==================== Cloudinary 업로드 ====================
async function uploadToCloudinary(file, onProgress) {
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) file = await compressImage(file);

    return new Promise(resolve => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
        xhr.upload.onprogress = e => {
            if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100));
        };
        xhr.onload  = () => { if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url); else resolve(null); };
        xhr.onerror = () => resolve(null);
        xhr.send(formData);
    });
}

// ==================== DOMContentLoaded ====================
document.addEventListener('DOMContentLoaded', () => {
    loadAndRenderSlides();
    loadAndRenderResearchCards();
    loadDynamicContent();

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

    // 관리자 패널
    document.getElementById('addSlideBtn').addEventListener('click', () => {
        document.getElementById('slideAddModal').style.display = 'flex';
    });
    document.getElementById('addCardBtn').addEventListener('click', () => openCardModal('add'));
    document.getElementById('reorderSlideBtn').addEventListener('click', openSlideReorderModal);

    document.getElementById('homeEditModeBtn').addEventListener('click', () => {
        isEditMode = !isEditMode;
        if (isEditMode) isDeleteMode = false;
        document.getElementById('homeEditModeBtn').style.background  = isEditMode  ? '#f39c12' : '';
        document.getElementById('homeDeleteModeBtn').style.background = '';
        renderResearchCardsUI();
        updateSliderDeleteOverlay();
    });
    document.getElementById('homeDeleteModeBtn').addEventListener('click', () => {
        isDeleteMode = !isDeleteMode;
        if (isDeleteMode) isEditMode = false;
        document.getElementById('homeDeleteModeBtn').style.background = isDeleteMode ? '#e74c3c' : '';
        document.getElementById('homeEditModeBtn').style.background   = '';
        renderResearchCardsUI();
        updateSliderDeleteOverlay();
    });

    // 슬라이드 추가 모달
    document.getElementById('slideAddClose').addEventListener('click', () => {
        document.getElementById('slideAddModal').style.display = 'none';
    });
    document.getElementById('slideAddModal').addEventListener('click', e => {
        if (e.target === document.getElementById('slideAddModal'))
            document.getElementById('slideAddModal').style.display = 'none';
    });
    document.getElementById('slideAddForm').addEventListener('submit', addSlideSubmit);

    // 슬라이드 순서 변경 모달
    document.getElementById('slideReorderClose').addEventListener('click', () => {
        document.getElementById('slideReorderModal').style.display = 'none';
        loadAndRenderSlides();
    });
    document.getElementById('slideReorderModal').addEventListener('click', e => {
        if (e.target === document.getElementById('slideReorderModal')) {
            document.getElementById('slideReorderModal').style.display = 'none';
            loadAndRenderSlides();
        }
    });
    document.getElementById('slideReorderSaveBtn').addEventListener('click', saveSlideOrder);

    // 카드 모달
    document.getElementById('cardModalClose').addEventListener('click', () => {
        document.getElementById('cardModal').style.display = 'none';
    });
    document.getElementById('cardModal').addEventListener('click', e => {
        if (e.target === document.getElementById('cardModal'))
            document.getElementById('cardModal').style.display = 'none';
    });
    document.getElementById('cardForm').addEventListener('submit', saveResearchCard);

    // 키보드 슬라이더
    document.addEventListener('keydown', e => {
        const count = document.querySelectorAll('#slider-wrapper .slide').length;
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

    // 슬라이더 마우스 호버 시 일시정지
    const heroSlider = document.getElementById('slider-wrapper');
    if (heroSlider) {
        heroSlider.addEventListener('mouseenter', () => clearInterval(slideInterval));
        heroSlider.addEventListener('mouseleave', () => {
            if (allSlidesData.length > 1) slideInterval = setInterval(nextSlide, 4000);
        });
    }
});
