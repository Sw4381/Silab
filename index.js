// index.js - Firebase 기반 홈페이지 관리

// ==================== Firebase 설정 ====================
const firebaseConfig = {
    apiKey: "AIzaSyC1HQOuTGQ5IaLQiSRitcM2NsaYxtAmDQk",
    authDomain: "security-lab-projects-4d1cb.firebaseapp.com",
    databaseURL: "https://security-lab-projects-4d1cb-default-rtdb.firebaseio.com",
    projectId: "security-lab-projects-4d1cb",
    storageBucket: "security-lab-projects-4d1cb.firebasestorage.app",
    messagingSenderId: "1075416037204",
    appId: "1:1075416037204:web:89db47137971d40485bac1"
};

const CLOUDINARY_CLOUD_NAME = 'dtgwtdf3q';
const CLOUDINARY_UPLOAD_PRESET = 'jfwl9ton';
const ALLOWED_EMAIL = 'kinjecs0@gmail.com';

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const database = firebase.database();

// ==================== 상태 ====================
let currentUser = null;
let isEditMode = false;
let isDeleteMode = false;
let currentSlideIndex = 0;
let slideInterval = null;
let allSlidesData = [];
let researchCardsData = [];
let editingCardKey = null;

const COLOR_MAP = {
    blue:  { gradient: 'linear-gradient(135deg, #005792 0%, #0077be 100%)', emoji: '🔬' },
    red:   { gradient: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)', emoji: '🛡️' },
    green: { gradient: 'linear-gradient(135deg, #27ae60 0%, #2ecc71 100%)', emoji: '📋' }
};

// ==================== 인증 ====================
auth.onAuthStateChanged(user => {
    if (user && user.email === ALLOWED_EMAIL) {
        currentUser = user;
    } else {
        currentUser = null;
        isEditMode = false;
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

// ==================== 환영 텍스트 ====================
function loadAndRenderWelcome() {
    database.ref('home/welcomeText').once('value').then(snap => {
        const data = snap.val();
        if (data) renderWelcomeText(data);
    });
}

function renderWelcomeText(data) {
    const bulletsHTML = (data.bullets || []).map(b => `<li>${b}</li>`).join('');
    document.getElementById('main-text').innerHTML = `
        <h1>${data.title || ''} <span class="welcome-emoji"></span></h1>
        <ul class="bullet-list">${bulletsHTML}</ul>
        <h2>${data.recruitTitle || ''}</h2>
        <p>${data.recruitText || ''}</p>
    `;
}

function openWelcomeEditModal() {
    database.ref('home/welcomeText').once('value').then(snap => {
        const d = snap.val() || {};
        document.getElementById('welcomeTitle').value        = d.title || '';
        document.getElementById('welcomeBullets').value      = (d.bullets || []).join('\n');
        document.getElementById('welcomeRecruitTitle').value = d.recruitTitle || '';
        document.getElementById('welcomeRecruitText').value  = d.recruitText || '';
        document.getElementById('welcomeEditModal').style.display = 'flex';
    });
}

function saveWelcomeText(e) {
    e.preventDefault();
    const btn = document.getElementById('welcomeSaveBtn');
    btn.disabled = true;
    const data = {
        title:        document.getElementById('welcomeTitle').value.trim(),
        bullets:      document.getElementById('welcomeBullets').value.split('\n').filter(Boolean),
        recruitTitle: document.getElementById('welcomeRecruitTitle').value.trim(),
        recruitText:  document.getElementById('welcomeRecruitText').value.trim()
    };
    database.ref('home/welcomeText').set(data)
        .then(() => {
            renderWelcomeText(data);
            document.getElementById('welcomeEditModal').style.display = 'none';
            btn.disabled = false;
        })
        .catch(err => { alert('저장 실패: ' + err.message); btn.disabled = false; });
}

// ==================== 슬라이더 ====================
function loadAndRenderSlides() {
    const container = document.getElementById('slides-container');
    if (container) {
        container.innerHTML = '<div class="skeleton skeleton-image" style="width:100%;height:100%;border-radius:10px;"></div>';
    }
    database.ref('home/slides').once('value').then(snap => {
        const dbData = snap.val();
        if (dbData) {
            allSlidesData = Object.entries(dbData).map(([key, val]) => ({ key, ...val }));
            allSlidesData.sort((a, b) => (a.order || 0) - (b.order || 0));
        } else {
            allSlidesData = [];
        }
        renderSlider();
    });
}

function renderSlider() {
    const container = document.getElementById('slides-container');
    const dotsEl    = document.getElementById('slider-dots');
    if (!container || !dotsEl) return;

    container.innerHTML = '';
    dotsEl.innerHTML    = '';

    allSlidesData.forEach((slide, i) => {
        const img = document.createElement('img');
        img.src       = slide.url;
        img.alt       = slide.alt || '';
        img.className = 'slide' + (i === 0 ? ' active' : '');
        container.appendChild(img);

        const dot = document.createElement('span');
        dot.className     = 'dot' + (i === 0 ? ' active' : '');
        dot.dataset.index = i;
        dot.addEventListener('click', () => {
            clearInterval(slideInterval);
            goToSlide(i);
            slideInterval = setInterval(nextSlide, 2500);
        });
        dotsEl.appendChild(dot);
    });

    currentSlideIndex = 0;
    clearInterval(slideInterval);
    if (allSlidesData.length > 1) {
        slideInterval = setInterval(nextSlide, 2500);
    }
    updateSliderDeleteOverlay();
}

function goToSlide(index) {
    const slideEls = document.querySelectorAll('#slides-container .slide');
    const dotEls   = document.querySelectorAll('#slider-dots .dot');
    slideEls.forEach((s, i) => s.classList.toggle('active', i === index));
    dotEls.forEach((d, i)   => d.classList.toggle('active', i === index));
    currentSlideIndex = index;
}

function nextSlide() {
    const count = document.querySelectorAll('#slides-container .slide').length;
    if (!count) return;
    goToSlide((currentSlideIndex + 1) % count);
}

function updateSliderDeleteOverlay() {
    const wrapper = document.getElementById('slider-wrapper');
    if (!wrapper) return;
    let overlay = wrapper.querySelector('.slide-delete-overlay');
    if (currentUser && isDeleteMode) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'slide-delete-overlay';
            overlay.style.cssText = 'position:absolute;top:8px;right:8px;z-index:20;';
            overlay.innerHTML = '<button onclick="deleteCurrentSlide()" style="background:rgba(220,53,69,0.9);color:white;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px;"><i class=\'fas fa-trash\'></i> 현재 슬라이드 삭제</button>';
            wrapper.appendChild(overlay);
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

async function addSlideSubmit(e) {
    e.preventDefault();
    const file = document.getElementById('slideFile').files[0];
    const alt  = document.getElementById('slideAlt').value.trim();
    if (!file) { alert('이미지를 선택해주세요.'); return; }

    const btn         = document.getElementById('slideAddBtn');
    const progressDiv = document.getElementById('slideUploadProgress');
    const progressBar = document.getElementById('slideProgressBar');
    btn.disabled      = true;
    progressDiv.style.display = 'block';

    const url = await uploadToCloudinary(file, p => { progressBar.style.width = p + '%'; });
    if (!url) {
        alert('업로드 실패');
        btn.disabled = false;
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
function showGridLoading() {
    const grid = document.getElementById('research-grid');
    if (!grid) return;
    grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
    grid.innerHTML = [1,2,3].map(() => `
        <div class="skeleton-card">
            <div class="skeleton skeleton-line short" style="margin-bottom:16px;height:28px;border-radius:8px;"></div>
            <div class="skeleton skeleton-line medium"></div>
            <div class="skeleton skeleton-line full"></div>
            <div class="skeleton skeleton-line medium" style="width:55%;"></div>
        </div>
    `).join('');
}

function loadAndRenderResearchCards() {
    showGridLoading();
    database.ref('home/researchCards').once('value').then(snap => {
        const dbData = snap.val();
        if (dbData) {
            researchCardsData = Object.entries(dbData).map(([key, val]) => ({ key, ...val }));
            researchCardsData.sort((a, b) => (a.order || 0) - (b.order || 0));
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
            <div class="empty-state">
                <i class="fas fa-flask"></i>
                <h3>등록된 연구분야가 없습니다</h3>
                <p>관리자가 로그인하여 연구분야를 추가할 수 있습니다.</p>
            </div>`;
        return;
    }

    const count = researchCardsData.length;
    grid.style.gridTemplateColumns = count <= 4
        ? `repeat(${count}, 1fr)`
        : 'repeat(4, 1fr)';

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
                <div class="card-title" style="background:${colors.gradient}">${card.title}</div>
                <div class="card-subtitle">${card.subtitle}</div>
            </div>
            <ul class="research-list">${itemsHTML}</ul>
        `;

        if (currentUser && isEditMode) {
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '<i class="fas fa-edit"></i>';
            editBtn.title     = '수정';
            editBtn.style.cssText = 'position:absolute;top:14px;right:50px;background:rgba(59,108,247,0.9);color:white;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:12px;z-index:10;display:flex;align-items:center;justify-content:center;';
            editBtn.onclick = () => openCardModal('edit', card.key);
            div.appendChild(editBtn);
        }
        if (currentUser && isDeleteMode) {
            const delBtn = document.createElement('button');
            delBtn.innerHTML = '<i class="fas fa-trash"></i>';
            delBtn.title     = '삭제';
            delBtn.style.cssText = 'position:absolute;top:14px;right:12px;background:rgba(220,53,69,0.9);color:white;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:12px;z-index:10;display:flex;align-items:center;justify-content:center;';
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

// ==================== 이미지 압축 ====================
async function compressImage(file) {
    const COMPRESS_TARGET = 8 * 1024 * 1024;
    return new Promise((resolve) => {
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
        xhr.onload = () => {
            if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url);
            else resolve(null);
        };
        xhr.onerror = () => resolve(null);
        xhr.send(formData);
    });
}

// ==================== DOMContentLoaded ====================
document.addEventListener('DOMContentLoaded', () => {
    loadAndRenderWelcome();
    loadAndRenderSlides();
    loadAndRenderResearchCards();

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
    document.getElementById('editWelcomeBtn').addEventListener('click', openWelcomeEditModal);
    document.getElementById('addSlideBtn').addEventListener('click', () => {
        document.getElementById('slideAddModal').style.display = 'flex';
    });
    document.getElementById('addCardBtn').addEventListener('click', () => openCardModal('add'));

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

    // 환영 텍스트 모달
    document.getElementById('welcomeModalClose').addEventListener('click', () => {
        document.getElementById('welcomeEditModal').style.display = 'none';
    });
    document.getElementById('welcomeEditModal').addEventListener('click', e => {
        if (e.target === document.getElementById('welcomeEditModal'))
            document.getElementById('welcomeEditModal').style.display = 'none';
    });
    document.getElementById('welcomeForm').addEventListener('submit', saveWelcomeText);

    // 슬라이드 모달
    document.getElementById('slideAddClose').addEventListener('click', () => {
        document.getElementById('slideAddModal').style.display = 'none';
    });
    document.getElementById('slideAddModal').addEventListener('click', e => {
        if (e.target === document.getElementById('slideAddModal'))
            document.getElementById('slideAddModal').style.display = 'none';
    });
    document.getElementById('slideAddForm').addEventListener('submit', addSlideSubmit);

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
        const count = document.querySelectorAll('#slides-container .slide').length;
        if (!count) return;
        if (e.key === 'ArrowLeft') {
            clearInterval(slideInterval);
            goToSlide((currentSlideIndex - 1 + count) % count);
            slideInterval = setInterval(nextSlide, 5000);
        } else if (e.key === 'ArrowRight') {
            clearInterval(slideInterval);
            goToSlide((currentSlideIndex + 1) % count);
            slideInterval = setInterval(nextSlide, 5000);
        }
    });

    // 마우스 호버 시 슬라이드 일시정지
    const sliderEl = document.querySelector('.slider');
    if (sliderEl) {
        sliderEl.addEventListener('mouseenter', () => clearInterval(slideInterval));
        sliderEl.addEventListener('mouseleave', () => {
            if (allSlidesData.length > 1) slideInterval = setInterval(nextSlide, 5000);
        });
    }
});
