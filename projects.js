// projects.js - 프로젝트 관리 JavaScript 파일 (정적 이미지 세부사항 기능 포함)

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

// ==================== 프로젝트별 이미지 데이터 (정적 데이터) ====================
const PROJECT_IMAGES = {
    'project_47': [
        {
            url: './Project_photo/Project_47.jpg',
            name: 'Project 47',
            originalName: 'project47.jpg'
        }
    ],
    'project_46': [
        {
            url: './Project_photo/Project_46.png',
            name: 'Project 46',
            originalName: 'project46.png'
        }
    ]
};

// ==================== 전역 변수 선언 ====================
let auth, database;
let currentUser = null;
let deleteMode = false;
let editMode = false;

// ==================== 허용된 사용자 목록 ====================
const ALLOWED_USERS = ['kinjecs0@gmail.com'];

// ==================== DOM 요소들 ====================
let loginBtn, logoutBtn, loginModal, loginClose, loginForm;
let userInfo, userName, adminPanel, addProjectBtn, addProjectForm;
let projectForm, cancelAddProject, toggleDeleteMode, toggleEditMode;
let editProjectForm, projectEditForm, cancelEditProject;
let imageModal, imageModalClose, imageGallery, noImages;
let currentEditingProject = null;

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

// 프로젝트 이름에서 번호 추출하는 함수
function extractProjectNumber(projectName) {
    console.log('프로젝트 이름 분석:', projectName);
    
    // 정확한 프로젝트 이름 정리 (세부사항 버튼 텍스트 제거)
    const cleanName = projectName.replace(/세부사항/g, '').trim();
    console.log('정리된 이름:', cleanName);
    
    // 다양한 패턴으로 숫자 추출 시도
    const patterns = [
        /\[PJ(\d+)\]/i,                   // "[PJ48]", "[pj47]" 형식 (새로 추가)
        /PJ(\d+)/i,                       // "PJ48", "pj47" 형식 (새로 추가)
        /(?:project|프로젝트)\s*(\d+)/i,  // "Project 47", "프로젝트 47"
        /project(\d+)/i,                  // "project47"
        /프로젝트(\d+)/,                  // "프로젝트47"
        /(\d+)/                           // 단순 숫자
    ];
    
    for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        const match = cleanName.match(pattern);
        if (match) {
            console.log(`패턴 ${i + 1} (${pattern}) 매치됨:`, match[1]);
            return match[1];
        }
    }
    
    console.log('숫자를 찾을 수 없음');
    return null;
}

// ==================== Firebase 관련 함수들 ====================
async function loadProjectsFromRealtimeDB() {
    if (!database) {
        console.error('❌ Realtime Database가 초기화되지 않았습니다.');
        return;
    }
    
    try {
        console.log('🔄 Realtime Database에서 프로젝트 로드 중...');
        
        // 기존 Firebase 프로젝트 제거
        const dynamicProjects = document.querySelectorAll('[data-firebase="true"]');
        dynamicProjects.forEach(item => item.remove());
        
        // current projects 로드
        const currentRef = database.ref('current projects');
        const currentSnapshot = await currentRef.once('value');
        const currentData = currentSnapshot.val() || {};
        
        // past projects 로드
        const pastRef = database.ref('past projects');
        const pastSnapshot = await pastRef.once('value');
        const pastData = pastSnapshot.val() || {};
        
        console.log('📊 현재 프로젝트 데이터:', Object.keys(currentData).length, '개');
        console.log('📊 과거 프로젝트 데이터:', Object.keys(pastData).length, '개');
        
        // 현재 프로젝트 처리
        Object.keys(currentData).forEach((firebaseKey, index) => {
            const project = currentData[firebaseKey];
            if (project && project.name) {
                project.id = `current_${index}`;
                project.firebaseKey = firebaseKey;
                project.type = 'current';
                addProjectToDOM(project);
            }
        });
        
        // 과거 프로젝트 처리
        Object.keys(pastData).forEach((firebaseKey, index) => {
            const project = pastData[firebaseKey];
            if (project && project.name) {
                project.id = `past_${index}`;
                project.firebaseKey = firebaseKey;
                project.type = 'past';
                addProjectToDOM(project);
            }
        });
        
        console.log('✅ 프로젝트 로드 완료');
        updateButtonsVisibility();
        
    } catch (error) {
        console.error('❌ 프로젝트 로드 실패:', error);
        showAlert('프로젝트 로드에 실패했습니다.', 'error');
    }
}

function addProjectToDOM(project) {
    let container;
    if (project.type === 'current') {
        container = document.querySelector('.project-list:not(.past)');
    } else {
        container = document.querySelector('.project-list.past .more-projects');
        if (!container) {
            container = document.querySelector('.project-list.past');
        }
    }
    
    if (container) {
        const projectElement = createProjectElement(project);
        container.appendChild(projectElement);
    } else {
        console.error('❌ 프로젝트 컨테이너를 찾을 수 없습니다:', project.type);
    }
}

function createProjectElement(project) {
    const projectDiv = document.createElement('div');
    projectDiv.className = project.type === 'current' ? 'project-item' : 'project-item past-item';
    projectDiv.setAttribute('data-project-id', project.id);
    projectDiv.setAttribute('data-firebase', 'true');
    projectDiv.setAttribute('data-firebase-key', project.firebaseKey || project.id);
    
    const deleteId = project.firebaseKey || project.id;
    
    // 프로젝트 이름에서 번호 추출하여 이미지가 있는지 확인
    const projectNumber = extractProjectNumber(project.name);
    const hasImages = projectNumber && PROJECT_IMAGES[`project_${projectNumber}`];
    
    // 현재 진행 중 프로젝트이고 이미지가 있는 경우에만 세부사항 버튼 추가
    const detailsButton = (project.type === 'current' && hasImages) ? 
        `<button class="details-btn" onclick="showProjectDetails('${project.id}', '${project.name.replace(/'/g, "\\'")}', ${projectNumber})">
            <i class="fas fa-info-circle"></i> 세부사항
        </button>` : '';
    
    projectDiv.innerHTML = `
        <div class="project-content">
            <div class="project-header">
                <div class="project-info">
                    <h3 class="project-name">
                        ${project.name}
                        ${detailsButton}
                    </h3>
                    <p class="project-period">
                        <i class="far fa-calendar-alt"></i> 연구기간: ${project.period}
                    </p>
                    <p class="project-funding">
                        <strong>Funding:</strong> ${project.funding}
                    </p>
                    ${project.description ? `
                        <p class="project-desc">
                            <strong>주요내용:</strong> ${project.description}
                        </p>
                    ` : ''}
                </div>
                <div class="project-actions" style="display: none;">
                    <button class="edit-project-btn" onclick="editProject('${project.id}', '${project.type}')" style="display: none;">
                        <i class="fas fa-edit"></i> 수정
                    </button>
                    <button class="delete-project-btn" onclick="deleteFirebaseProject('${deleteId}', '${project.type}')" style="display: none;">
                        <i class="fas fa-trash"></i> 삭제
                    </button>
                </div>
            </div>
        </div>
    `;
    
    return projectDiv;
}

async function addProjectToRealtimeDB(projectData) {
    try {
        console.log('💾 프로젝트 추가 시작:', projectData.name);
        
        const refPath = projectData.type === 'current' ? 'current projects' : 'past projects';
        const ref = database.ref(refPath);
        
        await ref.push(projectData);
        
        showAlert('프로젝트가 성공적으로 추가되었습니다!', 'success');
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadProjectsFromRealtimeDB();
        }, 1000);
        
    } catch (error) {
        console.error('❌ 프로젝트 추가 실패:', error);
        showAlert('프로젝트 추가 실패: ' + error.message, 'error');
    }
}

// 프로젝트 삭제
window.deleteFirebaseProject = async function(projectId, projectType) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    
    if (!confirm('정말로 이 프로젝트를 삭제하시겠습니까?')) return;
    
    try {
        console.log('🗑️ 프로젝트 삭제 시도:', projectId, projectType);
        
        const refPath = `${projectType === 'current' ? 'current projects' : 'past projects'}/${projectId}`;
        
        // 데이터베이스에서 프로젝트 삭제
        await database.ref(refPath).remove();
        
        showAlert('프로젝트가 삭제되었습니다.', 'success');
        
        // DOM에서도 제거
        const projectElement = document.querySelector(`[data-project-id*="${projectId}"]`);
        if (projectElement) {
            projectElement.remove();
        }
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadProjectsFromRealtimeDB();
        }, 500);
        
    } catch (error) {
        console.error('❌ 프로젝트 삭제 실패:', error);
        showAlert('프로젝트 삭제 실패: ' + error.message, 'error');
    }
};

// ==================== 이미지 세부사항 관련 함수들 ====================

// 프로젝트 세부사항 표시
window.showProjectDetails = function(projectId, projectName, projectNumber) {
    try {
        console.log('🔍 프로젝트 세부사항 로드:', projectName);
        
        if (!imageModal) {
            showAlert('이미지 모달을 찾을 수 없습니다.', 'error');
            return;
        }
        
        // 모달 제목 설정
        const modalTitle = document.getElementById('imageModalTitle');
        if (modalTitle) {
            modalTitle.textContent = `${projectName} - 세부사항`;
        }
        
        // 프로젝트 이미지 가져오기
        const projectKey = `project_${projectNumber}`;
        const images = PROJECT_IMAGES[projectKey] || [];
        
        // 이미지 갤러리 표시
        displayImageGallery(images);
        
        // 모달 표시
        imageModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('❌ 세부사항 로드 실패:', error);
        showAlert('세부사항을 불러오는데 실패했습니다.', 'error');
    }
};

// 이미지 갤러리 표시
function displayImageGallery(images) {
    if (!imageGallery || !noImages) return;
    
    imageGallery.innerHTML = '';
    
    if (!images || images.length === 0) {
        noImages.style.display = 'block';
        imageGallery.style.display = 'none';
        return;
    }
    
    noImages.style.display = 'none';
    imageGallery.style.display = 'grid';
    
    images.forEach((image, index) => {
        const galleryItem = document.createElement('div');
        galleryItem.className = 'gallery-item';
        
        galleryItem.innerHTML = `
            <img src="${image.url}" alt="${image.originalName || image.name}" 
                 onclick="openImageFullscreen('${image.url}', '${(image.originalName || image.name).replace(/'/g, "\\'")}')">
            <div class="gallery-item-info">
                <p class="gallery-item-name">${image.originalName || image.name}</p>
            </div>
        `;
        
        imageGallery.appendChild(galleryItem);
    });
}

// 이미지 전체화면 보기
window.openImageFullscreen = function(imageUrl, imageName) {
    const fullscreenModal = document.createElement('div');
    fullscreenModal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); z-index: 1001; display: flex;
        justify-content: center; align-items: center; cursor: pointer;
    `;
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = imageName;
    img.style.cssText = `
        max-width: 90%; max-height: 90%; object-fit: contain;
        border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    `;
    
    fullscreenModal.appendChild(img);
    document.body.appendChild(fullscreenModal);
    
    fullscreenModal.addEventListener('click', () => {
        document.body.removeChild(fullscreenModal);
    });
};

// ==================== 프로젝트 수정 관련 함수들 ====================
window.editProject = function(projectId, projectType) {
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'warning');
        return;
    }
    
    if (!editMode) {
        showAlert('수정 모드가 활성화되지 않았습니다.', 'warning');
        return;
    }
    
    console.log('✏️ 프로젝트 수정 모드 시작:', projectId);
    
    const projectElement = document.querySelector(`[data-project-id="${projectId}"]`);
    if (!projectElement) {
        showAlert('프로젝트를 찾을 수 없습니다.', 'error');
        return;
    }
    
    // 프로젝트 정보 추출
    const projectNameElement = projectElement.querySelector('.project-name');
    const projectName = projectNameElement.textContent.replace('세부사항', '').trim();
    const projectPeriod = projectElement.querySelector('.project-period').textContent.replace('연구기간: ', '').replace(/.*📅\s*/, '');
    const projectFunding = projectElement.querySelector('.project-funding').textContent.replace('Funding: ', '');
    const projectDescElement = projectElement.querySelector('.project-desc');
    const projectDesc = projectDescElement ? projectDescElement.textContent.replace('주요내용: ', '') : '';
    
    const firebaseKey = projectElement.getAttribute('data-firebase-key') || projectId;
    
    // 수정 폼에 데이터 채우기
    document.getElementById('editProjectId').value = projectId;
    document.getElementById('editProjectFirebaseKey').value = firebaseKey;
    document.getElementById('editProjectCurrentType').value = projectType;
    document.getElementById('editProjectName').value = projectName;
    document.getElementById('editProjectPeriod').value = projectPeriod;
    document.getElementById('editProjectFunding').value = projectFunding;
    document.getElementById('editProjectDesc').value = projectDesc;
    document.getElementById('editProjectType').value = projectType;
    
    currentEditingProject = {
        id: projectId,
        firebaseKey: firebaseKey,
        type: projectType
    };
    
    // 폼 표시
    if (addProjectForm) {
        addProjectForm.style.display = 'none';
    }
    if (editProjectForm) {
        editProjectForm.style.display = 'block';
        editProjectForm.scrollIntoView({ behavior: 'smooth' });
    }
    
    showAlert('프로젝트 수정 모드가 활성화되었습니다.', 'success');
};

async function updateProject() {
    if (!currentEditingProject) {
        showAlert('수정할 프로젝트가 선택되지 않았습니다.', 'error');
        return;
    }
    
    try {
        console.log('💾 프로젝트 수정 시작');
        
        const formData = new FormData(projectEditForm);
        const newProjectData = {
            name: formData.get('editProjectName'),
            period: formData.get('editProjectPeriod'),
            funding: formData.get('editProjectFunding'),
            description: formData.get('editProjectDesc'),
            type: formData.get('editProjectType')
        };
        
        const oldType = formData.get('editProjectCurrentType');
        const newType = newProjectData.type;
        const firebaseKey = formData.get('editProjectFirebaseKey');
        
        // 프로젝트 업데이트
        if (oldType !== newType) {
            // 타입이 변경된 경우: 기존 위치에서 삭제하고 새 위치에 추가
            const oldRefPath = `${oldType === 'current' ? 'current projects' : 'past projects'}/${firebaseKey}`;
            await database.ref(oldRefPath).remove();
            const newRefPath = `${newType === 'current' ? 'current projects' : 'past projects'}`;
            await database.ref(newRefPath).push(newProjectData);
        } else {
            // 같은 타입 내에서 수정
            const refPath = `${newType === 'current' ? 'current projects' : 'past projects'}/${firebaseKey}`;
            await database.ref(refPath).update(newProjectData);
        }
        
        showAlert('프로젝트가 성공적으로 수정되었습니다!', 'success');
        
        // 폼 초기화 및 숨기기
        if (editProjectForm) {
            editProjectForm.style.display = 'none';
        }
        if (projectEditForm) {
            projectEditForm.reset();
        }
        currentEditingProject = null;
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadProjectsFromRealtimeDB();
        }, 1000);
        
    } catch (error) {
        console.error('❌ 프로젝트 수정 실패:', error);
        showAlert('프로젝트 수정 실패: ' + error.message, 'error');
    }
}

// ==================== 인증 관련 함수들 ====================
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
        if (addProjectForm) addProjectForm.style.display = 'none';
        if (editProjectForm) editProjectForm.style.display = 'none';
        deleteMode = false;
        editMode = false;
    }
    updateButtonsVisibility();
}

function updateButtonsVisibility() {
    const projectActions = document.querySelectorAll('.project-actions');
    const editButtons = document.querySelectorAll('.edit-project-btn');
    const deleteButtons = document.querySelectorAll('.delete-project-btn');
    
    projectActions.forEach(action => {
        action.style.display = (currentUser && (editMode || deleteMode)) ? 'block' : 'none';
    });
    
    editButtons.forEach(button => {
        button.style.display = (currentUser && editMode) ? 'inline-block' : 'none';
    });
    
    deleteButtons.forEach(button => {
        button.style.display = (currentUser && deleteMode) ? 'inline-block' : 'none';
    });
    
    // 토글 버튼 활성화 상태 표시
    if (toggleEditMode) {
        toggleEditMode.classList.toggle('active', editMode);
    }
    
    if (toggleDeleteMode) {
        toggleDeleteMode.classList.toggle('active', deleteMode);
    }
}

// ==================== 이벤트 리스너 설정 ====================
function setupEditEventListeners() {
    editProjectForm = document.getElementById('editProjectForm');
    projectEditForm = document.getElementById('projectEditForm');
    cancelEditProject = document.getElementById('cancelEditProject');
    
    if (!editProjectForm || !projectEditForm || !cancelEditProject) {
        console.warn('⚠️ 수정 관련 DOM 요소를 찾을 수 없습니다.');
        return;
    }
    
    // 수정 취소 버튼
    cancelEditProject.addEventListener('click', () => {
        editProjectForm.style.display = 'none';
        projectEditForm.reset();
        currentEditingProject = null;
        showAlert('프로젝트 수정이 취소되었습니다.', 'warning');
    });
    
    // 수정 폼 제출
    projectEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateProject();
    });
    
    console.log('✅ 수정 관련 이벤트 리스너 설정 완료');
}

function setupImageEventListeners() {
    // 이미지 모달 닫기
    if (imageModalClose) {
        imageModalClose.addEventListener('click', () => {
            imageModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        });
    }
    
    // 모달 외부 클릭 시 닫기
    if (imageModal) {
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal) {
                imageModal.style.display = 'none';
                document.body.style.overflow = 'auto';
            }
        });
    }
    
    console.log('✅ 이미지 관련 이벤트 리스너 설정 완료');
}

function setupEventListeners() {
    console.log('🔧 이벤트 리스너 설정 시작');
    
    // 로그인 관련 - 안전하게 요소 확인 후 이벤트 추가
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            if (loginModal) loginModal.style.display = 'block';
        });
    }
    
    if (loginClose) {
        loginClose.addEventListener('click', () => {
            if (loginModal) loginModal.style.display = 'none';
        });
    }
    
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logoutUser);
    }
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emailInput = document.getElementById('email');
            const passwordInput = document.getElementById('password');
            
            if (!emailInput || !passwordInput) {
                showAlert('로그인 폼 요소를 찾을 수 없습니다.', 'error');
                return;
            }
            
            const email = emailInput.value;
            const password = passwordInput.value;
            
            try {
                const result = await loginUser(email, password);
                currentUser = result.user;
                updateAuthUI();
                showAlert('로그인 성공!', 'success');
                if (loginModal) loginModal.style.display = 'none';
                loginForm.reset();
            } catch (error) {
                console.error('❌ 로그인 실패:', error);
                showAlert('로그인 실패: ' + error.message, 'error');
            }
        });
    }

    // 프로젝트 관리
    if (addProjectBtn) {
        addProjectBtn.addEventListener('click', () => {
            if (editProjectForm && editProjectForm.style.display === 'block') {
                editProjectForm.style.display = 'none';
                currentEditingProject = null;
            }
            if (addProjectForm) {
                addProjectForm.style.display = addProjectForm.style.display === 'none' ? 'block' : 'none';
            }
        });
    }
    
    if (cancelAddProject) {
        cancelAddProject.addEventListener('click', () => {
            if (addProjectForm) addProjectForm.style.display = 'none';
            if (projectForm) projectForm.reset();
        });
    }
    
    if (projectForm) {
        projectForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(projectForm);
            
            const projectData = {
                name: formData.get('projectName'),
                period: formData.get('projectPeriod'),
                funding: formData.get('projectFunding'),
                description: formData.get('projectDesc'),
                type: formData.get('projectType')
            };
            
            await addProjectToRealtimeDB(projectData);
            if (addProjectForm) addProjectForm.style.display = 'none';
            if (projectForm) projectForm.reset();
        });
    }
    
    // 수정/삭제 모드 토글
    if (toggleEditMode) {
        toggleEditMode.addEventListener('click', () => {
            editMode = !editMode;
            updateButtonsVisibility();
            showAlert(editMode ? '수정 모드 활성화' : '수정 모드 비활성화', 'success');
        });
    }
    
    if (toggleDeleteMode) {
        toggleDeleteMode.addEventListener('click', () => {
            deleteMode = !deleteMode;
            updateButtonsVisibility();
            showAlert(deleteMode ? '삭제 모드 활성화' : '삭제 모드 비활성화', 'success');
        });
    }
    
    // 모달 외부 클릭 시 닫기
    window.addEventListener('click', (e) => {
        if (loginModal && e.target === loginModal) {
            loginModal.style.display = 'none';
        }
    });

    // 수정 관련 이벤트 리스너 설정
    setupEditEventListeners();
    
    // 이미지 관련 이벤트 리스너 설정
    setupImageEventListeners();
    
    console.log('✅ 이벤트 리스너 설정 완료');
}

function setupScrollAnimation() {
    const hiddenElements = document.querySelectorAll(".hidden");
    
    const handleScroll = () => {
        hiddenElements.forEach(element => {
            const elementTop = element.getBoundingClientRect().top;
            const windowHeight = window.innerHeight;
            
            if (elementTop < windowHeight - 50) {
                element.classList.add("visible");
            } else {
                element.classList.remove("visible");
            }
        });
    };
    
    window.addEventListener("scroll", handleScroll);
    handleScroll();
}

function setupMoreButton() {
    const loadMoreBtn = document.getElementById("load-more");
    const moreProjects = document.querySelector(".more-projects");
    
    if (loadMoreBtn && moreProjects) {
        loadMoreBtn.addEventListener("click", function() {
            moreProjects.classList.toggle("visible");
            this.classList.toggle("active");
        });
    }
}

// ==================== 메인 초기화 ====================
document.addEventListener("DOMContentLoaded", function() {
    console.log('🚀 프로젝트 관리 시스템 시작');
    
    // DOM 요소들 초기화 - 안전하게 요소 가져오기
    loginBtn = document.getElementById('loginBtn');
    logoutBtn = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal');
    loginClose = document.getElementById('loginClose');
    loginForm = document.getElementById('loginForm');
    userInfo = document.getElementById('userInfo');
    userName = document.getElementById('userName');
    adminPanel = document.getElementById('adminPanel');
    addProjectBtn = document.getElementById('addProjectBtn');
    addProjectForm = document.getElementById('addProjectForm');
    projectForm = document.getElementById('projectForm');
    cancelAddProject = document.getElementById('cancelAddProject');
    toggleDeleteMode = document.getElementById('toggleDeleteMode');
    toggleEditMode = document.getElementById('toggleEditMode');
    
    // 이미지 모달 관련 요소들 초기화
    imageModal = document.getElementById('imageModal');
    imageModalClose = document.getElementById('imageModalClose');
    imageGallery = document.getElementById('imageGallery');
    noImages = document.getElementById('noImages');
    
    console.log('📱 DOM 요소 초기화 완료');
    console.log('🖼️ 이미지 모달 요소:', imageModal ? '찾음' : '없음');
    
    // Firebase 초기화
    try {
        // Firebase 앱이 이미 초기화되었는지 확인
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log('🔥 Firebase 앱 초기화 완료');
        }
        
        // Firebase 서비스 초기화
        auth = firebase.auth();
        database = firebase.database();
        
        console.log('✅ Firebase 서비스 초기화 완료');
        console.log('🔐 Auth:', auth ? '성공' : '실패');
        console.log('💾 Database:', database ? '성공' : '실패');
        
        // 인증 상태 변화 리스너
        auth.onAuthStateChanged((user) => {
            currentUser = user;
            updateAuthUI();
            
            if (user) {
                console.log('✅ 사용자 로그인:', user.email);
                loadProjectsFromRealtimeDB();
            } else {
                console.log('ℹ️ 사용자 미로그인');
                loadProjectsFromRealtimeDB();
            }
        });
        
    } catch (error) {
        console.error('❌ Firebase 초기화 실패:', error);
        showAlert('Firebase 초기화 실패: ' + error.message, 'error');
    }
    
    // 이벤트 리스너들 설정
    setupEventListeners();
    
    // 스크롤 애니메이션
    setupScrollAnimation();
    
    // 더 보기 버튼
    setupMoreButton();
    
    console.log('🎯 프로젝트 관리 시스템 로드 완료');
    console.log('📊 프로젝트 이미지 데이터:', Object.keys(PROJECT_IMAGES));
});

// ==================== 전역 함수 노출 및 디버깅 ====================
window.debugData = function() {
    console.log('=== 현재 시스템 상태 ===');
    console.log('- currentUser:', currentUser);
    console.log('- deleteMode:', deleteMode);
    console.log('- editMode:', editMode);
    console.log('- database:', database ? '연결됨' : '연결 안됨');
    console.log('- currentEditingProject:', currentEditingProject);
    console.log('- imageModal:', imageModal ? '찾음' : '없음');
    console.log('- PROJECT_IMAGES:', PROJECT_IMAGES);
    
    console.log('\n=== 데이터 다시 로드 ===');
    loadProjectsFromRealtimeDB();
};

// 프로젝트 이미지 데이터 확인 함수
window.debugImages = function() {
    console.log('=== 프로젝트 이미지 정보 ===');
    Object.keys(PROJECT_IMAGES).forEach(key => {
        console.log(`${key}:`, PROJECT_IMAGES[key].length, '개 이미지');
        PROJECT_IMAGES[key].forEach((img, index) => {
            console.log(`  ${index + 1}. ${img.name} (${img.url})`);
        });
    });
};

// 기타 필요한 전역 함수들
window.deleteProject = function(projectId) {
    console.log('deleteProject 호출됨:', projectId);
};

window.openModal = function(projectId) {
    console.log('openModal 호출됨:', projectId);
};

window.closeModal = function(projectId) {
    console.log('closeModal 호출됨:', projectId);
};

console.log('🎯 projects.js 로드 완료');