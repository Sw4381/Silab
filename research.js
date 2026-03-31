// research.js - Firebase Realtime Database 기반 연구 관리

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

// ==================== Cloudinary 설정 ====================
const CLOUDINARY_CLOUD_NAME = 'dtgwtdf3q';
const CLOUDINARY_UPLOAD_PRESET = 'jfwl9ton';

// ==================== 허용된 사용자 ====================
const ALLOWED_EMAIL = 'kinjecs0@gmail.com';

// ==================== 전역 변수 ====================
let auth, database;
let currentUser = null;
let editMode = false;
let deleteMode = false;
let editingResearchKey = null;
let currentImageUrl = '';

// ==================== DOM 요소 ====================
let loginBtn, logoutBtn, loginModal, loginClose;
let userInfo, userName, adminPanel;
let addResearchBtn, researchEditModeBtn, researchDeleteModeBtn;
let researchModal2, researchForm, researchModalClose;

// ==================== showAlert ====================
function showAlert(message, type) {
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.textContent = message;
    alert.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 3000; max-width: 400px;
        padding: 15px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        animation: slideInRight 0.3s ease;
    `;
    if (type === 'success') {
        alert.style.background = '#d4edda';
        alert.style.color = '#155724';
        alert.style.border = '1px solid #c3e6cb';
    } else if (type === 'error') {
        alert.style.background = '#f8d7da';
        alert.style.color = '#721c24';
        alert.style.border = '1px solid #f5c6cb';
    } else if (type === 'warning') {
        alert.style.background = '#fff3cd';
        alert.style.color = '#856404';
        alert.style.border = '1px solid #ffeaa7';
    }
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
}

// ==================== Cloudinary 업로드 ====================
async function uploadResearchImage(file, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };
        }

        xhr.onload = () => {
            if (xhr.status === 200) {
                resolve(JSON.parse(xhr.responseText).secure_url);
            } else {
                reject(new Error('업로드 실패'));
            }
        };
        xhr.onerror = () => reject(new Error('네트워크 오류'));
        xhr.send(formData);
    });
}

// ==================== 인증 관련 ====================
async function loginUser(email, password) {
    if (email !== ALLOWED_EMAIL) {
        throw new Error('접근 권한이 없습니다. 연구실 관리자만 사용할 수 있습니다.');
    }
    try {
        const result = await auth.signInWithEmailAndPassword(email, password);
        return result;
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            return await auth.createUserWithEmailAndPassword(email, password);
        } else if (error.code === 'auth/wrong-password') {
            throw new Error('비밀번호가 틀렸습니다.');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('이메일 형식이 올바르지 않습니다.');
        }
        throw error;
    }
}

async function logoutUser() {
    await auth.signOut();
    currentUser = null;
    updateAuthUI();
    showAlert('로그아웃되었습니다.', 'success');
}

function updateAuthUI() {
    if (currentUser) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'flex';
        if (userInfo) userInfo.style.display = 'flex';
        if (userName) userName.textContent = currentUser.email;
        if (adminPanel) adminPanel.style.display = 'block';
    } else {
        if (loginBtn) loginBtn.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (userInfo) userInfo.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'none';
        editMode = false;
        deleteMode = false;
        if (researchEditModeBtn) researchEditModeBtn.classList.remove('active');
        if (researchDeleteModeBtn) researchDeleteModeBtn.classList.remove('active');
    }
}

// ==================== 데이터 로드 및 렌더링 ====================
async function loadAndRenderResearch() {
    if (!database) return;
    try {
        const snapshot = await database.ref('research').once('value');
        const data = snapshot.val();
        if (data) {
            renderResearchCards(data);
        }
        // DB가 비어있으면 빈 컨테이너 표시
    } catch (error) {
        console.error('연구 데이터 로드 실패:', error);
        showAlert('연구 데이터 로드 실패: ' + error.message, 'error');
    }
}

function renderResearchCards(data) {
    const container = document.querySelector('.research-container');
    if (!container) return;
    container.innerHTML = '';

    const sorted = Object.entries(data)
        .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

    sorted.forEach(([key, item]) => {
        container.appendChild(createResearchCard(key, item));
    });
}

function createResearchCard(key, item) {
    const div = document.createElement('div');
    div.className = 'research-slide';
    div.setAttribute('data-key', key);
    div.style.position = 'relative';
    div.setAttribute('onclick', 'openResearchModal(this)');

    const goalsHtml = (item.goals || []).map(g =>
        `<span class="goal-label">${g}</span>`
    ).join('');

    const summaryHtml = (item.summaryItems || []).map(s =>
        `<div class="summary-item">${s}</div>`
    ).join('');

    const asIsHtml = (item.asIs || []).map(a =>
        `<li>${a}</li>`
    ).join('');

    const toBeHtml = (item.toBe || []).map(t =>
        `<li>${t}</li>`
    ).join('');

    const methodHtml = (item.methodItems || []).map(m =>
        `<li>${m}</li>`
    ).join('');

    const imageUrl = item.image || 'https://via.placeholder.com/600x220/4facfe/ffffff?text=Research';
    const imageUrlSafe = imageUrl.replace(/'/g, "\\'");

    const showEdit = currentUser && editMode;
    const showDelete = currentUser && deleteMode;
    const actionsHtml = (showEdit || showDelete) ? `
        <div class="research-card-actions" style="position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:10;">
            ${showEdit ? `<button class="admin-btn edit" style="padding:5px 10px;font-size:0.8em;" onclick="event.stopPropagation(); openResearchEditModal('edit','${key}')"><i class="fas fa-edit"></i></button>` : ''}
            ${showDelete ? `<button class="admin-btn delete" style="padding:5px 10px;font-size:0.8em;" onclick="event.stopPropagation(); deleteResearch('${key}')"><i class="fas fa-trash"></i></button>` : ''}
        </div>
    ` : '';

    div.innerHTML = `
        ${actionsHtml}
        <div class="slide-header">
            <h2 class="project-title">${item.title || ''}</h2>
            <div class="project-subtitle">
                <span class="highlight-red">${item.subtitle || ''}</span>
            </div>
            <div class="goals-row">
                ${goalsHtml}
            </div>
        </div>

        <div class="card-image">
            <img src="${imageUrl}" alt="${item.title || '연구'}" onerror="this.src='https://via.placeholder.com/600x220/4facfe/ffffff?text=Research'">
        </div>

        <div class="card-summary">
            ${summaryHtml}
        </div>

        <p class="click-hint">클릭하여 상세 정보 보기 →</p>

        <div class="slide-content">
            <div class="section-box as-is">
                <div class="box-label">AS-IS</div>
                <ul class="section-list">
                    ${asIsHtml}
                </ul>
            </div>
            <div class="section-box to-be">
                <div class="box-label">TO-BE</div>
                <ul class="section-list">
                    ${toBeHtml}
                </ul>
            </div>
        </div>

        <div class="proposed-section">
            <div class="proposed-title">PROPOSED METHOD</div>
            <div class="proposed-content">
                <div class="method-image">
                    <img src="${imageUrl}" alt="연구 방법론" onerror="this.src='https://via.placeholder.com/800x400?text=Research+Method+Diagram'">
                </div>
                <div class="method-description">
                    <ul>
                        ${methodHtml}
                    </ul>
                </div>
            </div>
        </div>
    `;

    return div;
}

// ==================== 상세 모달 (detail) ====================
function openResearchModal(slideElement) {
    const modal = document.getElementById('researchModal');
    const modalBody = document.getElementById('modalBody');

    const clonedSlide = slideElement.cloneNode(true);
    clonedSlide.removeAttribute('onclick');

    // 클론에서 관리 버튼 제거
    const actions = clonedSlide.querySelector('.research-card-actions');
    if (actions) actions.remove();

    modalBody.innerHTML = '';
    modalBody.appendChild(clonedSlide);

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeResearchModal() {
    const modal = document.getElementById('researchModal');
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

// ==================== 연구 추가/수정 모달 ====================
function openResearchEditModal(mode, key) {
    editingResearchKey = (mode === 'edit') ? key : null;
    currentImageUrl = '';

    const title = document.getElementById('researchModalTitle');
    if (title) title.textContent = (mode === 'add') ? '연구 추가' : '연구 수정';

    // 폼 초기화
    const form = document.getElementById('researchForm');
    if (form) form.reset();

    const preview = document.getElementById('researchImagePreview');
    if (preview) preview.innerHTML = '';

    const progressWrap = document.getElementById('researchUploadProgress');
    if (progressWrap) progressWrap.style.display = 'none';

    if (mode === 'edit' && key) {
        database.ref(`research/${key}`).once('value').then(snap => {
            const item = snap.val();
            if (!item) return;

            document.getElementById('researchTitle').value = item.title || '';
            document.getElementById('researchSubtitle').value = item.subtitle || '';
            document.getElementById('researchGoals').value = (item.goals || []).join('\n');
            document.getElementById('researchSummary').value = (item.summaryItems || []).join('\n');
            document.getElementById('researchAsIs').value = (item.asIs || []).join('\n');
            document.getElementById('researchToBe').value = (item.toBe || []).join('\n');
            document.getElementById('researchMethod').value = (item.methodItems || []).join('\n');

            currentImageUrl = item.image || '';
            if (currentImageUrl && preview) {
                preview.innerHTML = `<img src="${currentImageUrl}" style="max-width:120px;max-height:80px;border-radius:6px;border:2px solid #4facfe;margin-top:4px;" onerror="this.style.display='none'">`;
            }
        });
    }

    if (researchModal2) researchModal2.style.display = 'block';
}

async function saveResearch(e) {
    e.preventDefault();
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'error');
        return;
    }

    const saveBtn = document.getElementById('researchSaveBtn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const title = document.getElementById('researchTitle').value.trim();
        const subtitle = document.getElementById('researchSubtitle').value.trim();
        const goals = document.getElementById('researchGoals').value
            .split('\n').filter(line => line.trim()).map(l => l.trim());
        const summaryItems = document.getElementById('researchSummary').value
            .split('\n').filter(line => line.trim()).map(l => l.trim());
        const asIs = document.getElementById('researchAsIs').value
            .split('\n').filter(line => line.trim()).map(l => l.trim());
        const toBe = document.getElementById('researchToBe').value
            .split('\n').filter(line => line.trim()).map(l => l.trim());
        const methodItems = document.getElementById('researchMethod').value
            .split('\n').filter(line => line.trim()).map(l => l.trim());

        // 이미지 업로드
        const imageFile = document.getElementById('researchImage').files[0];
        let imageUrl = currentImageUrl;

        if (imageFile) {
            const progressWrap = document.getElementById('researchUploadProgress');
            const progressBar = document.getElementById('researchProgressBar');
            if (progressWrap) progressWrap.style.display = 'block';

            imageUrl = await uploadResearchImage(imageFile, pct => {
                if (progressBar) progressBar.style.width = pct + '%';
            });

            if (progressWrap) progressWrap.style.display = 'none';
        }

        // order 계산
        let order = 1;
        if (!editingResearchKey) {
            const snap = await database.ref('research').once('value');
            const existing = snap.val();
            if (existing) {
                const maxOrder = Math.max(...Object.values(existing).map(r => r.order || 0));
                order = maxOrder + 1;
            }
        } else {
            const snap = await database.ref(`research/${editingResearchKey}`).once('value');
            const existing = snap.val();
            order = existing ? (existing.order || 1) : 1;
        }

        const data = { order, title, subtitle, goals, image: imageUrl, summaryItems, asIs, toBe, methodItems };

        if (editingResearchKey) {
            await database.ref(`research/${editingResearchKey}`).update(data);
            showAlert('연구가 수정되었습니다.', 'success');
        } else {
            await database.ref('research').push(data);
            showAlert('연구가 추가되었습니다.', 'success');
        }

        if (researchModal2) researchModal2.style.display = 'none';
        await loadAndRenderResearch();
    } catch (error) {
        console.error('저장 실패:', error);
        showAlert('저장 실패: ' + error.message, 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

window.deleteResearch = async function(key) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    if (!confirm('이 연구를 삭제하시겠습니까?')) return;
    try {
        await database.ref(`research/${key}`).remove();
        showAlert('연구가 삭제되었습니다.', 'success');
        await loadAndRenderResearch();
    } catch (error) {
        showAlert('삭제 실패: ' + error.message, 'error');
    }
};

// ==================== 이벤트 리스너 설정 ====================
function setupEventListeners() {
    // 로그인/로그아웃
    if (loginBtn) loginBtn.addEventListener('click', () => loginModal && (loginModal.style.display = 'block'));
    if (loginClose) loginClose.addEventListener('click', () => loginModal && (loginModal.style.display = 'none'));
    if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

    // 로그인 모달 배경 클릭 닫기
    if (loginModal) {
        loginModal.addEventListener('click', (e) => {
            if (e.target === loginModal) loginModal.style.display = 'none';
        });
    }

    // 로그인 폼 제출
    const loginFormEl = document.getElementById('loginForm');
    if (loginFormEl) {
        loginFormEl.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email')?.value || '';
            const password = document.getElementById('password')?.value || '';
            try {
                const result = await loginUser(email, password);
                currentUser = result.user;
                updateAuthUI();
                showAlert('로그인 성공!', 'success');
                if (loginModal) loginModal.style.display = 'none';
                loginFormEl.reset();
            } catch (error) {
                showAlert('로그인 실패: ' + error.message, 'error');
            }
        });
    }

    // 관리자 패널 버튼
    if (addResearchBtn) {
        addResearchBtn.addEventListener('click', () => {
            openResearchEditModal('add', null);
        });
    }

    if (researchEditModeBtn) {
        researchEditModeBtn.addEventListener('click', () => {
            editMode = !editMode;
            if (editMode) deleteMode = false;
            researchEditModeBtn.classList.toggle('active', editMode);
            if (researchDeleteModeBtn) researchDeleteModeBtn.classList.remove('active');
            loadAndRenderResearch();
        });
    }

    if (researchDeleteModeBtn) {
        researchDeleteModeBtn.addEventListener('click', () => {
            deleteMode = !deleteMode;
            if (deleteMode) editMode = false;
            researchDeleteModeBtn.classList.toggle('active', deleteMode);
            if (researchEditModeBtn) researchEditModeBtn.classList.remove('active');
            loadAndRenderResearch();
        });
    }

    // 연구 편집 모달 닫기
    if (researchModalClose) {
        researchModalClose.addEventListener('click', () => {
            if (researchModal2) researchModal2.style.display = 'none';
        });
    }
    if (researchModal2) {
        researchModal2.addEventListener('click', (e) => {
            if (e.target === researchModal2) researchModal2.style.display = 'none';
        });
    }

    // 연구 폼 제출
    if (researchForm) researchForm.addEventListener('submit', saveResearch);

    // 이미지 미리보기
    const imageInput = document.getElementById('researchImage');
    if (imageInput) {
        imageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const preview = document.getElementById('researchImagePreview');
            if (file && preview) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    preview.innerHTML = `<img src="${ev.target.result}" style="max-width:120px;max-height:80px;border-radius:6px;border:2px solid #4facfe;margin-top:4px;">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // 상세 모달 외부 클릭 닫기
    const detailModal = document.getElementById('researchModal');
    if (detailModal) {
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) closeResearchModal();
        });
    }

    // ESC 키로 모달 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeResearchModal();
            if (researchModal2) researchModal2.style.display = 'none';
            if (loginModal) loginModal.style.display = 'none';
        }
    });
}

// ==================== DOMContentLoaded ====================
document.addEventListener('DOMContentLoaded', async () => {
    // DOM 요소 바인딩
    loginBtn = document.getElementById('loginBtn');
    logoutBtn = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal');
    loginClose = document.getElementById('loginClose');
    userInfo = document.getElementById('userInfo');
    userName = document.getElementById('userName');
    adminPanel = document.getElementById('researchAdminPanel');
    addResearchBtn = document.getElementById('addResearchBtn');
    researchEditModeBtn = document.getElementById('researchEditModeBtn');
    researchDeleteModeBtn = document.getElementById('researchDeleteModeBtn');
    researchModal2 = document.getElementById('researchModal2');
    researchForm = document.getElementById('researchForm');
    researchModalClose = document.getElementById('researchModalClose');

    // Firebase 초기화
    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();

        auth.onAuthStateChanged(async (user) => {
            currentUser = user;
            updateAuthUI();
            await loadAndRenderResearch();
        });
    } catch (error) {
        console.error('Firebase 초기화 실패:', error);
        showAlert('Firebase 초기화 실패: ' + error.message, 'error');
    }

    setupEventListeners();
});

// 애니메이션 스타일 추가
const researchStyle = document.createElement('style');
researchStyle.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(100px); }
        to   { opacity: 1; transform: translateX(0); }
    }
`;
document.head.appendChild(researchStyle);
