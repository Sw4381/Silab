// photo.js - Patents와 Awards를 Firebase로 관리 + Photo Gallery(카테고리/년도 카드 → 상세) 구현

const firebaseConfig = {
    apiKey: "AIzaSyC1HQOuTGQ5IaLQiSRitcM2NsaYxtAmDQk",
    authDomain: "security-lab-projects-4d1cb.firebaseapp.com",
    databaseURL: "https://security-lab-projects-4d1cb-default-rtdb.firebaseio.com",
    projectId: "security-lab-projects-4d1cb",
    storageBucket: "security-lab-projects-4d1cb.firebasestorage.app",
    messagingSenderId: "1075416037204",
    appId: "1:1075416037204:web:89db47137971d40485bac1",
    measurementId: "G-JH2LH2CS3K"
};

// ==================== 전역 변수 선언 ====================
let auth, database;
const CLOUDINARY_CLOUD_NAME = 'dtgwtdf3q';
const CLOUDINARY_UPLOAD_PRESET = 'jfwl9ton';
let currentUser = null;
let deleteMode = false;
let editMode = false;
let currentEditingItem = null;

// Firebase에서 업로드된 사진 목록
let FIREBASE_PHOTOS = [];

// ==================== 허용된 사용자 목록 ====================
const ALLOWED_USERS = ['kinjecs0@gmail.com'];

// ==================== DOM 요소들 ====================
let loginBtn, logoutBtn, loginModal, loginClose, loginForm;
let userInfo, userName, adminPanel;
let addPatentBtn, addAwardBtn, addPhotoBtn;
let addPatentForm, addAwardForm, addPhotoForm;
let patentForm, awardForm, photoUploadForm;
let cancelAddPatent, cancelAddAward, cancelAddPhoto;
let toggleDeleteMode, toggleEditMode;
let editItemForm, itemEditForm, cancelEditItem;

// ==================== 기본 함수들 ====================
function showAlert(message, type) {
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.textContent = message;
    alert.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 1002; max-width: 400px;
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

// ==================== Firebase Database 관련 함수들 ====================
async function loadPatentsFromDatabase() {
    if (!database) return;

    try {
        const patentList = document.querySelector('.patent-list');
        if (!patentList) return;

        const dynamicItems = patentList.querySelectorAll('[data-firebase="true"]');
        dynamicItems.forEach(item => item.remove());

        const ref = database.ref('patents');
        const snapshot = await ref.once('value');
        const data = snapshot.val() || {};

        const patents = Object.entries(data)
            .filter(([key, value]) => value && value.content)
            .map(([key, value]) => ({ key, ...value }))
            .sort((a, b) => {
                const numA = parseInt((a.patentNumber || '').replace(/[^\d]/g, ''), 10) || 0;
                const numB = parseInt((b.patentNumber || '').replace(/[^\d]/g, ''), 10) || 0;
                return numB - numA;
            });

        patents.forEach((patent, index) => {
            patent.id = `patent_${index}`;
            addPatentToDOM(patent);
        });

        updateButtonsVisibility();
    } catch (error) {
        console.error('❌ 특허 로드 실패:', error);
        showAlert('특허 로드에 실패했습니다.', 'error');
    }
}

async function loadAwardsFromDatabase() {
    if (!database) return;

    try {
        const awardList = document.querySelector('.award-list');
        if (!awardList) return;

        const dynamicItems = awardList.querySelectorAll('[data-firebase="true"]');
        dynamicItems.forEach(item => item.remove());

        const ref = database.ref('awards');
        const snapshot = await ref.once('value');
        const data = snapshot.val() || {};

        const awards = Object.entries(data)
            .filter(([key, value]) => value && value.content)
            .map(([key, value]) => ({ key, ...value }))
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        awards.forEach((award, index) => {
            award.id = `award_${index}`;
            addAwardToDOM(award);
        });

        updateButtonsVisibility();
    } catch (error) {
        console.error('❌ 수상내역 로드 실패:', error);
        showAlert('수상내역 로드에 실패했습니다.', 'error');
    }
}

function addPatentToDOM(patent) {
    const patentList = document.querySelector('.patent-list');
    if (!patentList) return;

    const li = document.createElement('li');
    li.setAttribute('data-patent-id', patent.id);
    li.setAttribute('data-firebase', 'true');
    li.setAttribute('data-firebase-key', patent.key || patent.id);

    li.innerHTML = `
        <strong>[${patent.patentNumber}]</strong> ${patent.content}
        <div class="item-actions" style="display: none;">
            <button class="edit-item-btn" onclick="editPatent('${patent.id}')" style="display: none;">
                <i class="fas fa-edit"></i> 수정
            </button>
            <button class="delete-item-btn" onclick="deletePatent('${patent.key || patent.id}')" style="display: none;">
                <i class="fas fa-trash"></i> 삭제
            </button>
        </div>
    `;

    patentList.appendChild(li);
}

function addAwardToDOM(award) {
    const awardList = document.querySelector('.award-list');
    if (!awardList) return;

    const li = document.createElement('li');
    li.setAttribute('data-award-id', award.id);
    li.setAttribute('data-firebase', 'true');
    li.setAttribute('data-firebase-key', award.key || award.id);

    let content = award.content;
    if (award.highlight) {
        content = content.replace(award.highlight, `<span class="award-highlight">${award.highlight}</span>`);
    }

    li.innerHTML = `
        ${content}
        <div class="item-actions" style="display: none;">
            <button class="edit-item-btn" onclick="editAward('${award.id}')" style="display: none;">
                <i class="fas fa-edit"></i> 수정
            </button>
            <button class="delete-item-btn" onclick="deleteAward('${award.key || award.id}')" style="display: none;">
                <i class="fas fa-trash"></i> 삭제
            </button>
        </div>
    `;

    awardList.appendChild(li);
}

// ==================== 사진 업로드 (Firebase Storage + DB) ====================
async function loadUploadedPhotosFromDB() {
    if (!database) return;
    try {
        const ref = database.ref('photos');
        const snapshot = await ref.once('value');
        const data = snapshot.val() || {};

        FIREBASE_PHOTOS = Object.entries(data)
            .filter(([, v]) => v && v.src)
            .map(([key, v]) => ({
                src: v.src,
                title: v.title || v.filename || '사진',
                date: v.date || `${v.year}.--.--`,
                year: String(v.year || '기타'),
                category: v.category || '기타',
                description: v.description || '',
                filename: v.filename || '',
                firebaseKey: key,
                storagePath: v.storagePath || '',
                fromFirebase: true
            }));

        // 갤러리 카드 재렌더
        renderYearCards();
        renderCategoryCards();
    } catch (error) {
        console.error('❌ 사진 로드 실패:', error);
    }
}

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

async function uploadPhotoToCloudinary(file, metadata) {
    if (!database) throw new Error('Firebase 초기화 필요');

    const progressWrap = document.getElementById('photoUploadProgress');
    const progressBar = document.getElementById('photoUploadProgressBar');
    const progressText = document.getElementById('photoUploadProgressText');
    if (progressWrap) progressWrap.style.display = 'block';

    // 10MB 초과 시 자동 압축
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
        if (progressText) progressText.textContent = `압축 중... (${(file.size/1024/1024).toFixed(1)}MB)`;
        file = await compressImage(file);
        if (progressText) progressText.textContent = `압축 완료 (${(file.size/1024/1024).toFixed(1)}MB), 업로드 중...`;
    }

    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                if (progressBar) progressBar.style.width = pct + '%';
                if (progressText) progressText.textContent = `업로드 중... ${pct}%`;
            }
        };

        xhr.onload = async () => {
            if (progressWrap) progressWrap.style.display = 'none';
            if (xhr.status === 200) {
                try {
                    const result = JSON.parse(xhr.responseText);
                    const dateStr = metadata.date ? metadata.date.replace(/-/g, '.') : `${metadata.year}.--.--`;
                    const photoData = {
                        src: result.secure_url,
                        storagePath: result.public_id,
                        title: metadata.title || prettyTitleFromFilename(file.name),
                        date: dateStr,
                        year: metadata.year,
                        category: metadata.category,
                        description: metadata.description || '',
                        filename: file.name,
                        createdAt: Date.now(),
                        uploadedBy: currentUser ? currentUser.email : ''
                    };
                    await database.ref('photos').push(photoData);
                    showAlert('사진이 업로드되었습니다!', 'success');
                    await loadUploadedPhotosFromDB();
                    resolve();
                } catch (e) {
                    reject(e);
                }
            } else {
                reject(new Error('Cloudinary 업로드 실패: ' + xhr.responseText));
            }
        };

        xhr.onerror = () => {
            if (progressWrap) progressWrap.style.display = 'none';
            reject(new Error('네트워크 오류'));
        };

        xhr.send(formData);
    });
}

window.deleteFirebasePhoto = async function(firebaseKey, storagePath) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    if (!confirm('정말로 이 사진을 삭제하시겠습니까?')) return;

    try {
        await database.ref(`photos/${firebaseKey}`).remove();
        showAlert('사진이 삭제되었습니다.', 'success');
        await loadUploadedPhotosFromDB();
    } catch (error) {
        console.error('❌ 사진 삭제 실패:', error);
        showAlert('사진 삭제 실패: ' + error.message, 'error');
    }
};

// ==================== 특허 추가/삭제/수정 ====================
async function addPatentToDatabase(patentData) {
    try {
        const newPatent = {
            patentNumber: patentData.patentNumber,
            content: patentData.content,
            createdAt: Date.now()
        };

        const ref = database.ref('patents');
        await ref.push(newPatent);

        showAlert('특허가 성공적으로 추가되었습니다!', 'success');
        setTimeout(() => loadPatentsFromDatabase(), 700);
    } catch (error) {
        console.error('❌ 특허 추가 실패:', error);
        showAlert('특허 추가 실패: ' + error.message, 'error');
    }
}

window.deletePatent = async function(patentKey) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    if (!confirm('정말로 이 특허를 삭제하시겠습니까?')) return;

    try {
        await database.ref(`patents/${patentKey}`).remove();
        showAlert('특허가 삭제되었습니다.', 'success');

        const patentElement = document.querySelector(`[data-firebase-key="${patentKey}"]`);
        if (patentElement) patentElement.remove();

        setTimeout(() => loadPatentsFromDatabase(), 400);
    } catch (error) {
        console.error('❌ 특허 삭제 실패:', error);
        showAlert('특허 삭제 실패: ' + error.message, 'error');
    }
};

window.editPatent = function(patentId) {
    if (!currentUser || !editMode) {
        showAlert('수정 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }

    const patentElement = document.querySelector(`[data-patent-id="${patentId}"]`);
    if (!patentElement) {
        showAlert('특허를 찾을 수 없습니다.', 'error');
        return;
    }

    const patentNumber = patentElement.querySelector('strong').textContent.replace(/[\[\]]/g, '');
    const clonedElement = patentElement.cloneNode(true);
    const actionsDiv = clonedElement.querySelector('.item-actions');
    if (actionsDiv) actionsDiv.remove();

    let fullText = clonedElement.textContent.trim();
    const content = fullText.replace(`[${patentNumber}]`, '').trim();

    const firebaseKey = patentElement.getAttribute('data-firebase-key') || patentId;

    document.getElementById('editItemKey').value = firebaseKey;
    document.getElementById('editItemType').value = 'patent';
    document.getElementById('editPatentNumber').value = patentNumber;
    document.getElementById('editItemContent').value = content;

    const highlightGroup = document.getElementById('editHighlightGroup');
    const patentNumberGroup = document.getElementById('editPatentNumberGroup');
    if (highlightGroup) highlightGroup.style.display = 'none';
    if (patentNumberGroup) patentNumberGroup.style.display = 'block';

    currentEditingItem = { id: patentId, firebaseKey, type: 'patent' };

    if (addPatentForm) addPatentForm.style.display = 'none';
    if (addAwardForm) addAwardForm.style.display = 'none';
    if (editItemForm) {
        editItemForm.style.display = 'block';
        editItemForm.scrollIntoView({ behavior: 'smooth' });
    }

    showAlert('특허 수정 모드가 활성화되었습니다.', 'success');
};

// ==================== 수상내역 추가/삭제/수정 ====================
async function addAwardToDatabase(awardData) {
    try {
        const newAward = {
            content: awardData.content,
            highlight: awardData.highlight || '',
            date: awardData.date,
            createdAt: Date.now()
        };

        const ref = database.ref('awards');
        await ref.push(newAward);

        showAlert('수상내역이 성공적으로 추가되었습니다!', 'success');
        setTimeout(() => loadAwardsFromDatabase(), 700);
    } catch (error) {
        console.error('❌ 수상내역 추가 실패:', error);
        showAlert('수상내역 추가 실패: ' + error.message, 'error');
    }
}

window.deleteAward = async function(awardKey) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    if (!confirm('정말로 이 수상내역을 삭제하시겠습니까?')) return;

    try {
        await database.ref(`awards/${awardKey}`).remove();
        showAlert('수상내역이 삭제되었습니다.', 'success');

        const awardElement = document.querySelector(`[data-firebase-key="${awardKey}"]`);
        if (awardElement) awardElement.remove();

        setTimeout(() => loadAwardsFromDatabase(), 400);
    } catch (error) {
        console.error('❌ 수상내역 삭제 실패:', error);
        showAlert('수상내역 삭제 실패: ' + error.message, 'error');
    }
};

window.editAward = function(awardId) {
    if (!currentUser || !editMode) {
        showAlert('수정 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }

    const awardElement = document.querySelector(`[data-award-id="${awardId}"]`);
    if (!awardElement) {
        showAlert('수상내역을 찾을 수 없습니다.', 'error');
        return;
    }

    const highlightElement = awardElement.querySelector('.award-highlight');
    const highlight = highlightElement ? highlightElement.textContent : '';

    const clonedElement = awardElement.cloneNode(true);
    const actionsDiv = clonedElement.querySelector('.item-actions');
    if (actionsDiv) actionsDiv.remove();

    let content = clonedElement.textContent.trim();
    const firebaseKey = awardElement.getAttribute('data-firebase-key') || awardId;

    document.getElementById('editItemKey').value = firebaseKey;
    document.getElementById('editItemType').value = 'award';
    document.getElementById('editItemContent').value = content;
    document.getElementById('editItemHighlight').value = highlight;

    const highlightGroup = document.getElementById('editHighlightGroup');
    const patentNumberGroup = document.getElementById('editPatentNumberGroup');
    if (patentNumberGroup) patentNumberGroup.style.display = 'none';
    if (highlightGroup) highlightGroup.style.display = 'block';

    currentEditingItem = { id: awardId, firebaseKey, type: 'award' };

    if (addPatentForm) addPatentForm.style.display = 'none';
    if (addAwardForm) addAwardForm.style.display = 'none';
    if (editItemForm) {
        editItemForm.style.display = 'block';
        editItemForm.scrollIntoView({ behavior: 'smooth' });
    }

    showAlert('수상내역 수정 모드가 활성화되었습니다.', 'success');
};

async function updateItem() {
    if (!currentEditingItem) {
        showAlert('수정할 항목이 선택되지 않았습니다.', 'error');
        return;
    }

    try {
        const formData = new FormData(itemEditForm);
        const itemType = formData.get('editItemType');
        const firebaseKey = formData.get('editItemKey');

        if (itemType === 'patent') {
            const updatedPatent = {
                patentNumber: formData.get('editPatentNumber'),
                content: formData.get('editItemContent')
            };

            await database.ref(`patents/${firebaseKey}`).update(updatedPatent);
            showAlert('특허가 성공적으로 수정되었습니다!', 'success');
            setTimeout(() => loadPatentsFromDatabase(), 700);

        } else if (itemType === 'award') {
            const updatedAward = {
                content: formData.get('editItemContent'),
                highlight: formData.get('editItemHighlight') || '',
                date: formData.get('editAwardDate') || new Date().toISOString().split('T')[0]
            };

            await database.ref(`awards/${firebaseKey}`).update(updatedAward);
            showAlert('수상내역이 성공적으로 수정되었습니다!', 'success');
            setTimeout(() => loadAwardsFromDatabase(), 700);
        }

        if (editItemForm) editItemForm.style.display = 'none';
        if (itemEditForm) itemEditForm.reset();
        currentEditingItem = null;

    } catch (error) {
        console.error('❌ 수정 실패:', error);
        showAlert('수정 실패: ' + error.message, 'error');
    }
}

// ==================== 인증 관련 ====================
async function loginUser(email, password) {
    if (!ALLOWED_USERS.includes(email)) {
        throw new Error('접근 권한이 없습니다. 연구실 멤버만 사용할 수 있습니다.');
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
        if (addPatentForm) addPatentForm.style.display = 'none';
        if (addAwardForm) addAwardForm.style.display = 'none';
        if (addPhotoForm) addPhotoForm.style.display = 'none';
        if (editItemForm) editItemForm.style.display = 'none';
        deleteMode = false;
        editMode = false;
    }
    updateButtonsVisibility();
}

function updateButtonsVisibility() {
    const itemActions = document.querySelectorAll('.item-actions');
    const editButtons = document.querySelectorAll('.edit-item-btn');
    const deleteButtons = document.querySelectorAll('.delete-item-btn');

    itemActions.forEach(action => {
        action.style.display = (currentUser && (editMode || deleteMode)) ? 'inline-block' : 'none';
    });

    editButtons.forEach(button => {
        button.style.display = (currentUser && editMode) ? 'inline-block' : 'none';
    });

    deleteButtons.forEach(button => {
        button.style.display = (currentUser && deleteMode) ? 'inline-block' : 'none';
    });

    if (toggleEditMode) toggleEditMode.classList.toggle('active', editMode);
    if (toggleDeleteMode) toggleDeleteMode.classList.toggle('active', deleteMode);
}

// ==================== 이벤트 리스너 설정 ====================
function setupEventListeners() {
    if (loginBtn) loginBtn.addEventListener('click', () => loginModal && (loginModal.style.display = 'block'));
    if (loginClose) loginClose.addEventListener('click', () => loginModal && (loginModal.style.display = 'none'));
    if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email')?.value || "";
            const password = document.getElementById('password')?.value || "";

            try {
                const result = await loginUser(email, password);
                currentUser = result.user;
                updateAuthUI();
                showAlert('로그인 성공!', 'success');
                if (loginModal) loginModal.style.display = 'none';
                loginForm.reset();
            } catch (error) {
                showAlert('로그인 실패: ' + error.message, 'error');
            }
        });
    }

    // 특허 관리
    if (addPatentBtn) {
        addPatentBtn.addEventListener('click', () => {
            if (editItemForm && editItemForm.style.display === 'block') {
                editItemForm.style.display = 'none';
                currentEditingItem = null;
            }
            if (addAwardForm && addAwardForm.style.display === 'block') addAwardForm.style.display = 'none';
            if (addPatentForm) addPatentForm.style.display = (addPatentForm.style.display === 'block') ? 'none' : 'block';
        });
    }

    if (cancelAddPatent) cancelAddPatent.addEventListener('click', () => {
        if (addPatentForm) addPatentForm.style.display = 'none';
        if (patentForm) patentForm.reset();
    });

    if (patentForm) patentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(patentForm);
        await addPatentToDatabase({ patentNumber: fd.get('patentNumber'), content: fd.get('patentContent') });
        if (addPatentForm) addPatentForm.style.display = 'none';
        if (patentForm) patentForm.reset();
    });

    // 사진 업로드 관리
    if (addPhotoBtn) {
        addPhotoBtn.addEventListener('click', () => {
            if (editItemForm && editItemForm.style.display === 'block') {
                editItemForm.style.display = 'none';
                currentEditingItem = null;
            }
            if (addPatentForm && addPatentForm.style.display === 'block') addPatentForm.style.display = 'none';
            if (addAwardForm && addAwardForm.style.display === 'block') addAwardForm.style.display = 'none';
            if (addPhotoForm) addPhotoForm.style.display = (addPhotoForm.style.display === 'block') ? 'none' : 'block';
        });
    }

    if (cancelAddPhoto) cancelAddPhoto.addEventListener('click', () => {
        if (addPhotoForm) addPhotoForm.style.display = 'none';
        if (photoUploadForm) photoUploadForm.reset();
    });

    if (photoUploadForm) photoUploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(photoUploadForm);
        const file = fd.get('photoFile');
        if (!file || !file.size) {
            showAlert('사진 파일을 선택해주세요.', 'error');
            return;
        }
        const dateVal = fd.get('photoDate');
        const year = dateVal ? dateVal.substring(0, 4) : String(new Date().getFullYear());
        const submitBtn = document.getElementById('photoUploadSubmit');
        if (submitBtn) submitBtn.disabled = true;
        try {
            await uploadPhotoToCloudinary(file, {
                title: fd.get('photoTitle') || '',
                date: dateVal,
                year,
                category: fd.get('photoCategory'),
                description: fd.get('photoDescription') || ''
            });
            if (addPhotoForm) addPhotoForm.style.display = 'none';
            if (photoUploadForm) photoUploadForm.reset();
        } catch (error) {
            console.error('❌ 업로드 실패:', error);
            showAlert('업로드 실패: ' + error.message, 'error');
        } finally {
            if (submitBtn) submitBtn.disabled = false;
        }
    });

    // 수상내역 관리
    if (addAwardBtn) {
        addAwardBtn.addEventListener('click', () => {
            if (editItemForm && editItemForm.style.display === 'block') {
                editItemForm.style.display = 'none';
                currentEditingItem = null;
            }
            if (addPatentForm && addPatentForm.style.display === 'block') addPatentForm.style.display = 'none';
            if (addAwardForm) addAwardForm.style.display = (addAwardForm.style.display === 'block') ? 'none' : 'block';
        });
    }

    if (cancelAddAward) cancelAddAward.addEventListener('click', () => {
        if (addAwardForm) addAwardForm.style.display = 'none';
        if (awardForm) awardForm.reset();
    });

    if (awardForm) awardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(awardForm);
        await addAwardToDatabase({
            content: fd.get('awardContent'),
            highlight: fd.get('awardHighlight') || '',
            date: fd.get('awardDate')
        });
        if (addAwardForm) addAwardForm.style.display = 'none';
        if (awardForm) awardForm.reset();
    });

    // 수정/삭제 토글
    if (toggleEditMode) toggleEditMode.addEventListener('click', () => {
        editMode = !editMode;
        updateButtonsVisibility();
        showAlert(editMode ? '수정 모드 활성화' : '수정 모드 비활성화', 'success');
    });

    if (toggleDeleteMode) toggleDeleteMode.addEventListener('click', () => {
        deleteMode = !deleteMode;
        updateButtonsVisibility();
        showAlert(deleteMode ? '삭제 모드 활성화' : '삭제 모드 비활성화', 'success');
        // Firebase 사진 삭제 버튼 표시/숨김을 위해 갤러리 재렌더
        const board = document.getElementById('photoBoard');
        if (board && board.children.length > 0) applyFilterAndRender();
    });

    // 수정 취소/완료
    if (cancelEditItem) cancelEditItem.addEventListener('click', () => {
        if (editItemForm) editItemForm.style.display = 'none';
        if (itemEditForm) itemEditForm.reset();
        currentEditingItem = null;
        showAlert('수정이 취소되었습니다.', 'warning');
    });

    if (itemEditForm) itemEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateItem();
    });

    // 모달 외부 클릭 시 닫기(로그인)
    window.addEventListener('click', (e) => {
        if (loginModal && e.target === loginModal) loginModal.style.display = 'none';
    });
}

// ==================== 스크롤 애니메이션 ====================
function setupScrollAnimation() {
    const hiddenElements = document.querySelectorAll(".hidden");
    const handleScroll = () => {
        hiddenElements.forEach(element => {
            const elementTop = element.getBoundingClientRect().top;
            const windowHeight = window.innerHeight;
            if (elementTop < windowHeight - 50) element.classList.add("visible");
            else element.classList.remove("visible");
        });
    };
    window.addEventListener("scroll", handleScroll);
    handleScroll();
}

// ==================== 섹션 토글(기존 유지) ====================
function initSectionToggle() {
    const navButtons = document.querySelectorAll('.section-nav-btn');
    const sections = {
        'patents': document.getElementById('patents'),
        'awards': document.getElementById('awards'),
        'photos': document.getElementById('photos')
    };
    const sectionNav = document.querySelector('.section-nav');
    let isPhotoMode = false;

    if (sections.patents) sections.patents.style.display = 'block';
    if (sections.awards) sections.awards.style.display = 'block';
    if (sections.photos) sections.photos.style.display = 'none';

    navButtons.forEach(button => {
        button.addEventListener('click', function() {
            const targetId = this.getAttribute('data-target');
            const targetSection = sections[targetId];

            if (targetId === 'photos') {
                isPhotoMode = true;

                Object.values(sections).forEach(section => {
                    if (section) section.style.display = 'none';
                });

                if (targetSection) {
                    targetSection.style.display = 'block';
                    targetSection.classList.add('visible');
                }

                navButtons.forEach(btn => btn.classList.remove('active'));
                this.classList.add('active');

                window.scrollTo({
                    top: sectionNav.offsetTop - 20,
                    behavior: 'smooth'
                });
            } else {
                if (isPhotoMode) {
                    isPhotoMode = false;
                    if (sections.patents) sections.patents.style.display = 'block';
                    if (sections.awards) sections.awards.style.display = 'block';
                    if (sections.photos) sections.photos.style.display = 'none';
                    navButtons.forEach(btn => btn.classList.remove('active'));
                }

                if (targetSection) {
                    window.scrollTo({
                        top: targetSection.offsetTop - 100,
                        behavior: 'smooth'
                    });
                }
            }
        });
    });
}

/* =========================================================
   Photo Gallery (카테고리/년도 카드 → 상세)
   - ✅ 연도 카드 추가
   - ✅ 갤러리 내부: 연도칩 + 연도별 그룹핑(연도필터 없을 때)
   - ✅ description 유지
   ========================================================= */

const CATEGORY_THUMB_COUNT = 3;

// ---- 기존 유틸들(너 코드 유지) ----
function parseDateFromFilename(filename) {
    const base = filename;

    const m8 = base.match(/(^|[^0-9])(20\d{2})(\d{2})(\d{2})([^0-9]|$)/);
    if (m8) {
        const y = m8[2], mo = m8[3], d = m8[4];
        return `${y}.${mo}.${d}`;
    }

    const m6 = base.match(/(^|[^0-9])(\d{2})(\d{2})(\d{2})([^0-9]|$)/);
    if (m6) {
        const yy = m6[2];
        const y = `20${yy}`;
        const mo = m6[3], d = m6[4];
        return `${y}.${mo}.${d}`;
    }

    const mk = base.match(/(\d{1,2})월(\d{1,2})일/);
    if (mk) {
        const mo = String(mk[1]).padStart(2, "0");
        const d = String(mk[2]).padStart(2, "0");
        return `MMDD:${mo}.${d}`;
    }

    return null;
}

function parseDateForSort(dateStr) {
    if (!dateStr) return 0;
    const clean = dateStr.replace(/\./g, "").replace(/-/g, "");
    const n = parseInt(clean, 10);
    return Number.isFinite(n) ? n : 0;
}

function prettyTitleFromFilename(filename) {
    let t = filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, "").trim();
    t = t.replace(/^20\d{6}[_-]?/, "");
    t = t.replace(/^\d{6}[_-]?/, "");
    t = t.replace(/_/g, " ").trim();
    t = t.replace(/\s+/g, " ");
    return t || filename;
}


// ==================== Photo UI 상태 ====================
let activeCategory = null;
let activeYear = null;
let activeList = [];
let activeModalIndex = 0;

// -------------------- 그룹핑 유틸 --------------------
function groupByCategory(data) {
    const map = new Map();
    data.forEach(item => {
        const key = item.category || "기타";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    });
    map.forEach(arr => arr.sort((a, b) => parseDateForSort(b.date) - parseDateForSort(a.date)));
    return map;
}

function groupByYear(data) {
    const map = new Map();
    data.forEach(item => {
        const y = String(item.year || "기타");
        if (!map.has(y)) map.set(y, []);
        map.get(y).push(item);
    });
    map.forEach(arr => arr.sort((a, b) => parseDateForSort(b.date) - parseDateForSort(a.date)));
    return map;
}

function sortYearsDesc(years) {
    // "기타" 같은 값은 맨 뒤로
    const numericYears = years.filter(y => /^\d{4}$/.test(String(y)));
    const others = years.filter(y => !/^\d{4}$/.test(String(y)));
    numericYears.sort((a, b) => Number(b) - Number(a));
    return [...numericYears, ...others];
}

// -------------------- 카드 생성 공통(카테고리/년도 동일 카드 스타일 사용) --------------------
function createThumbImgs(list, count = CATEGORY_THUMB_COUNT, altPrefix = "") {
    const thumbs = list.slice(0, count);
    const imgs = [];
    for (let i = 0; i < count; i++) {
        const t = thumbs[i] || thumbs[0];
        if (t) imgs.push(`<img src="${t.src}" alt="${altPrefix} 대표사진">`);
    }
    return imgs.join("");
}

// -------------------- 카테고리 카드 렌더 --------------------
function renderCategoryCards() {
    const container = document.getElementById("photoCategories");
    if (!container) return;
    container.innerHTML = "";

    const grouped = groupByCategory(FIREBASE_PHOTOS);
    const categories = Array.from(grouped.keys());

    const preferredOrder = ["연구실모임", "행사", "워크숍", "학회", "수상", "기타"];
    categories.sort((a, b) => preferredOrder.indexOf(a) - preferredOrder.indexOf(b));

    categories.forEach(cat => {
        const list = grouped.get(cat) || [];
        if (!list.length) return;

        const card = document.createElement("div");
        card.className = "photo-category-card";
        card.dataset.category = cat;

        card.innerHTML = `
            <div class="photo-category-topbar">
                <div class="photo-category-name">
                    <i class="fas fa-folder-open"></i> ${cat}
                </div>
                <div class="photo-category-badge">${list.length}장</div>
            </div>
            <div class="photo-category-thumbs">
                ${createThumbImgs(list, CATEGORY_THUMB_COUNT, cat)}
            </div>
            <div class="photo-category-footer">
                <span>대표사진 ${Math.min(CATEGORY_THUMB_COUNT, list.length)}장</span>
                <span class="cta">보기 <i class="fas fa-arrow-right"></i></span>
            </div>
        `;

        // ✅ 카테고리 클릭 → 갤러리(연도는 전체)
        card.addEventListener("click", () => openGalleryView(cat, null));
        container.appendChild(card);
    });
}

// -------------------- 년도 카드 렌더 --------------------
function renderYearCards() {
    const container = document.getElementById("photoYears");
    if (!container) return;
    container.innerHTML = "";

    const grouped = groupByYear(FIREBASE_PHOTOS);
    const years = sortYearsDesc(Array.from(grouped.keys()));

    years.forEach(y => {
        const list = grouped.get(y) || [];
        if (!list.length) return;

        const card = document.createElement("div");
        card.className = "photo-category-card";
        card.dataset.year = y;

        card.innerHTML = `
            <div class="photo-category-topbar">
                <div class="photo-category-name">
                    <i class="fas fa-calendar-alt"></i> ${y}년
                </div>
                <div class="photo-category-badge">${list.length}장</div>
            </div>
            <div class="photo-category-thumbs">
                ${createThumbImgs(list, CATEGORY_THUMB_COUNT, `${y}년`)}
            </div>
            <div class="photo-category-footer">
                <span>대표사진 ${Math.min(CATEGORY_THUMB_COUNT, list.length)}장</span>
                <span class="cta">보기 <i class="fas fa-arrow-right"></i></span>
            </div>
        `;

        // ✅ 연도 클릭 → 갤러리(카테고리는 전체)
        card.addEventListener("click", () => openGalleryView(null, y));
        container.appendChild(card);
    });
}

// -------------------- 사진 item 생성 --------------------
function createPhotoItemElement(photo) {
    const div = document.createElement("div");
    div.className = "photo-item";
    div.dataset.src = photo.src;
    div.dataset.title = photo.title;
    div.dataset.date = photo.date;
    div.dataset.category = photo.category;
    div.dataset.year = photo.year;
    if (photo.firebaseKey) div.dataset.firebaseKey = photo.firebaseKey;
    if (photo.storagePath) div.dataset.storagePath = photo.storagePath;

    const deleteBtn = (photo.fromFirebase && currentUser && deleteMode)
        ? `<button class="photo-delete-btn" onclick="event.stopPropagation(); deleteFirebasePhoto('${photo.firebaseKey}','${photo.storagePath}')">
               <i class="fas fa-trash"></i>
           </button>`
        : '';

    div.innerHTML = `
        <div class="photo-card">
            <img src="${photo.src}" alt="${photo.title}">
            <div class="photo-overlay">
                <div class="photo-info">
                    <h4>${photo.title}</h4>
                    <p>${photo.date}</p>
                    <span class="category">${photo.category}</span>
                </div>
            </div>
            ${deleteBtn}
        </div>
    `;
    return div;
}

// -------------------- 평면 렌더(연도 필터가 있을 때) --------------------
function renderPhotoBoardFlat(list) {
    const board = document.getElementById("photoBoard");
    if (!board) return;

    board.classList.remove("year-grouped");
    board.innerHTML = "";
    list.forEach(p => board.appendChild(createPhotoItemElement(p)));

    const countEl = document.getElementById("photoActiveCount");
    if (countEl) countEl.textContent = `${list.length}장`;
}

// -------------------- 연도 섹션 그룹 렌더(연도 필터가 없을 때) --------------------
function renderPhotoBoardGroupedByYear(list) {
    const board = document.getElementById("photoBoard");
    if (!board) return;

    board.classList.add("year-grouped");
    board.innerHTML = "";

    const map = groupByYear(list);
    const years = sortYearsDesc(Array.from(map.keys()));

    years.forEach(y => {
        const arr = map.get(y) || [];
        if (!arr.length) return;

        const section = document.createElement("div");
        section.className = "photo-year-section";

        section.innerHTML = `
            <div class="photo-year-header">
                <div class="photo-year-title">${y}년</div>
                <div class="photo-year-count">${arr.length}장</div>
            </div>
        `;

        const grid = document.createElement("div");
        grid.className = "photo-grid";
        arr.forEach(p => grid.appendChild(createPhotoItemElement(p)));

        section.appendChild(grid);
        board.appendChild(section);
    });

    const countEl = document.getElementById("photoActiveCount");
    if (countEl) countEl.textContent = `${list.length}장`;
}

// -------------------- Year Chips --------------------
function renderYearChips(list) {
    const wrap = document.getElementById("photoYearChips");
    if (!wrap) return;
    wrap.innerHTML = "";

    const years = sortYearsDesc(Array.from(groupByYear(list).keys()));
    if (!years.length) return;

    // 전체년도 칩
    const allChip = document.createElement("button");
    allChip.className = "year-chip" + (!activeYear ? " active" : "");
    allChip.type = "button";
    allChip.textContent = "전체년도";
    allChip.addEventListener("click", () => openGalleryView(activeCategory, null));
    wrap.appendChild(allChip);

    years.forEach(y => {
        const chip = document.createElement("button");
        chip.className = "year-chip" + (String(activeYear) === String(y) ? " active" : "");
        chip.type = "button";
        chip.textContent = `${y}년`;
        chip.addEventListener("click", () => openGalleryView(activeCategory, y));
        wrap.appendChild(chip);
    });
}

// -------------------- 뷰 전환 --------------------
function openCategoryView() {
    const categoryView = document.getElementById("photoCategoryView");
    const galleryView = document.getElementById("photoGalleryView");
    if (categoryView) categoryView.style.display = "block";
    if (galleryView) galleryView.style.display = "none";

    activeCategory = null;
    activeYear = null;

    const searchInput = document.getElementById("photoSearchInput");
    if (searchInput) searchInput.value = "";
}

function openGalleryView(categoryOrNull, yearOrNull) {
    const categoryView = document.getElementById("photoCategoryView");
    const galleryView = document.getElementById("photoGalleryView");
    if (categoryView) categoryView.style.display = "none";
    if (galleryView) galleryView.style.display = "block";

    activeCategory = categoryOrNull || null;
    activeYear = yearOrNull || null;

    // pill 업데이트
    const pill = document.getElementById("photoActiveCategoryPill");
    if (pill) {
        const c = activeCategory ? activeCategory : "전체";
        const y = activeYear ? `${activeYear}년` : "전체년도";
        pill.textContent = `${c} · ${y}`;
    }

    applyFilterAndRender();
}

// -------------------- 필터 적용 + 렌더 --------------------
function applyFilterAndRender() {
    const searchInput = document.getElementById("photoSearchInput");
    const q = (searchInput?.value || "").trim().toLowerCase();

    let filtered = FIREBASE_PHOTOS.slice();

    if (activeCategory) filtered = filtered.filter(p => p.category === activeCategory);
    if (activeYear) filtered = filtered.filter(p => String(p.year) === String(activeYear));
    if (q) filtered = filtered.filter(p => (p.title || "").toLowerCase().includes(q));

    // 정렬: year desc, date desc
    filtered.sort((a, b) => {
        const ya = Number(a.year || 0), yb = Number(b.year || 0);
        if (yb !== ya) return yb - ya;
        return parseDateForSort(b.date) - parseDateForSort(a.date);
    });

    activeList = filtered;

    // ✅ 연도 필터 없으면 → 연도별 섹션 그룹핑
    if (!activeYear) renderPhotoBoardGroupedByYear(activeList);
    else renderPhotoBoardFlat(activeList);

    // ✅ 칩은 현재 결과 기반
    renderYearChips(activeList);
}

/* ==================== Photo Modal ==================== */
function initPhotoModal() {
    const modal = document.getElementById('photoModal');
    if (!modal) return;

    const modalOverlay = modal.querySelector('.modal-overlay');
    const modalClose = document.getElementById('modalClose');
    const modalImage = modal.querySelector('.modal-image');
    const modalTitle = modal.querySelector('.modal-title');
    const dateText = modal.querySelector('.date-text');
    const categoryText = modal.querySelector('.category-text');
    const descriptionText = modal.querySelector('.description-text');
    const prevBtn = document.getElementById('prevPhoto');
    const nextBtn = document.getElementById('nextPhoto');

    function updateNavButtons() {
        if (prevBtn) prevBtn.disabled = activeModalIndex <= 0;
        if (nextBtn) nextBtn.disabled = activeModalIndex >= activeList.length - 1;
    }

    function openModalByIndex(idx) {
        if (idx < 0 || idx >= activeList.length) return;
        activeModalIndex = idx;
        const photo = activeList[activeModalIndex];

        if (modalImage) {
            modalImage.src = photo.src;
            modalImage.alt = photo.title || "사진";
        }
        if (modalTitle) modalTitle.textContent = photo.title || "";
        if (dateText) dateText.textContent = photo.date || "";
        if (categoryText) categoryText.textContent = photo.category || "";

        if (descriptionText) {
            const d = (photo.description || "").trim();
            descriptionText.textContent = d ? d : "---";
        }

        updateNavButtons();
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }

    function prev() { openModalByIndex(activeModalIndex - 1); }
    function next() { openModalByIndex(activeModalIndex + 1); }

    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (prevBtn) prevBtn.addEventListener('click', prev);
    if (nextBtn) nextBtn.addEventListener('click', next);

    document.addEventListener('keydown', (e) => {
        if (!modal.classList.contains('show')) return;
        if (e.key === 'Escape') closeModal();
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
    });

    // ✅ 그룹핑 구조에서도 이벤트 위임으로 동작
    const board = document.getElementById("photoBoard");
    if (board) {
        board.addEventListener("click", (e) => {
            const item = e.target.closest(".photo-item");
            if (!item) return;
            const src = item.dataset.src;
            const idx = activeList.findIndex(p => p.src === src);
            if (idx !== -1) openModalByIndex(idx);
        });
    }
}

function initPhotoGalleryUI() {
    renderYearCards();
    renderCategoryCards();
    openCategoryView();

    const backBtn = document.getElementById("photoBackBtn");
    if (backBtn) backBtn.addEventListener("click", openCategoryView);

    const viewAllBtn = document.getElementById("photoViewAllBtn");
    if (viewAllBtn) viewAllBtn.addEventListener("click", () => openGalleryView(null, null));

    const clearBtn = document.getElementById("photoClearFiltersBtn");
    if (clearBtn) clearBtn.addEventListener("click", () => {
        activeCategory = null;
        activeYear = null;
        const searchInput = document.getElementById("photoSearchInput");
        if (searchInput) searchInput.value = "";
        openGalleryView(null, null);
    });

    const searchInput = document.getElementById("photoSearchInput");
    if (searchInput) searchInput.addEventListener("input", applyFilterAndRender);
}

// ==================== 메인 초기화 ====================
document.addEventListener("DOMContentLoaded", function() {
    loginBtn = document.getElementById('loginBtn');
    logoutBtn = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal');
    loginClose = document.getElementById('loginClose');
    loginForm = document.getElementById('loginForm');
    userInfo = document.getElementById('userInfo');
    userName = document.getElementById('userName');
    adminPanel = document.getElementById('adminPanel');
    addPatentBtn = document.getElementById('addPatentBtn');
    addAwardBtn = document.getElementById('addAwardBtn');
    addPhotoBtn = document.getElementById('addPhotoBtn');
    addPatentForm = document.getElementById('addPatentForm');
    addAwardForm = document.getElementById('addAwardForm');
    addPhotoForm = document.getElementById('addPhotoForm');
    patentForm = document.getElementById('patentForm');
    awardForm = document.getElementById('awardForm');
    photoUploadForm = document.getElementById('photoUploadForm');
    cancelAddPatent = document.getElementById('cancelAddPatent');
    cancelAddAward = document.getElementById('cancelAddAward');
    cancelAddPhoto = document.getElementById('cancelAddPhoto');
    toggleDeleteMode = document.getElementById('toggleDeleteMode');
    toggleEditMode = document.getElementById('toggleEditMode');
    editItemForm = document.getElementById('editItemForm');
    itemEditForm = document.getElementById('itemEditForm');
    cancelEditItem = document.getElementById('cancelEditItem');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
        auth.onAuthStateChanged((user) => {
            currentUser = user;
            updateAuthUI();
            loadPatentsFromDatabase();
            loadAwardsFromDatabase();
            loadUploadedPhotosFromDB();
        });
    } catch (error) {
        console.error('❌ Firebase 초기화 실패:', error);
        showAlert('Firebase 초기화 실패: ' + error.message, 'error');
    }

    setupEventListeners();
    setupScrollAnimation();
    initSectionToggle();

    initPhotoGalleryUI();
    initPhotoModal();
});

// 버튼 스타일(기존 유지)
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(100px); }
        to   { opacity: 1; transform: translateX(0); }
    }
    .item-actions { display: inline-block; margin-left: 10px; }
    .edit-item-btn, .delete-item-btn {
        padding: 4px 10px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.75em;
        transition: all 0.3s ease;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-left: 5px;
    }
    .edit-item-btn { background: #ffc107; color: #212529; }
    .edit-item-btn:hover { background: #e0a800; }
    .delete-item-btn { background: #dc3545; color: white; }
    .delete-item-btn:hover { background: #c82333; }
    .photo-card { position: relative; }
    .photo-delete-btn {
        position: absolute; top: 8px; right: 8px; z-index: 10;
        background: rgba(220,53,69,0.85); color: white;
        border: none; border-radius: 6px; padding: 6px 10px;
        cursor: pointer; font-size: 0.85em; display: flex; align-items: center; gap: 4px;
        transition: background 0.2s;
    }
    .photo-delete-btn:hover { background: #c82333; }
`;
document.head.appendChild(style);
