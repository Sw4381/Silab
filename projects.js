// projects.js - 개선된 위치 삽입 기능 + 탭형 모달

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

// ==================== 프로젝트별 이미지 데이터 ====================
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
    ],
    // ✨ Project 44를 탭 구조로 수정
    'project_44': {
        architecture: [
            {
                url: './Project_photo/Project_44_1.png',
                name: 'System Architecture Overview',
                description: '전체 시스템 아키텍처 구조도',
                originalName: 'project44_architecture_overview.jpg'
            }
        ],
        values: [
            {
                url: './Project_photo/Project_44_2.png',
                name: 'Performance values',
                description: '결과물의 실질가치',
                originalName: 'project44_performance.jpg'
            }
        ]
    }
};

// ==================== 전역 변수 선언 ====================
let auth, database;
let currentUser = null;
let deleteMode = false;
let editMode = false;
let currentActiveTab = 'architecture';

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
    
    const cleanName = projectName.replace(/세부사항/g, '').trim();
    console.log('정리된 이름:', cleanName);
    
    const patterns = [
        /\[PJ(\d+)\]/i,
        /PJ(\d+)/i,
        /(?:project|프로젝트)\s*(\d+)/i,
        /project(\d+)/i,
        /프로젝트(\d+)/,
        /(\d+)/
    ];
    
    for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];
        const match = cleanName.match(pattern);
        if (match) {
            console.log(`패턴 ${i + 1} 매치됨:`, match[1]);
            return match[1];
        }
    }
    
    console.log('숫자를 찾을 수 없음');
    return null;
}

// 프로젝트에 이미지가 있는지 확인하는 함수
function hasProjectImages(projectNumber) {
    const projectKey = `project_${projectNumber}`;
    const projectData = PROJECT_IMAGES[projectKey];
    
    if (!projectData) return false;
    
    // 배열 형태 (기존 방식)
    if (Array.isArray(projectData) && projectData.length > 0) {
        return true;
    }
    
    // 객체 형태 (탭 구조)
    if (typeof projectData === 'object' && !Array.isArray(projectData)) {
        return (projectData.architecture && projectData.architecture.length > 0) ||
               (projectData.values && projectData.values.length > 0);
    }
    
    return false;
}

// ==================== 새로운 위치 삽입 시스템 ====================

// 모든 프로젝트를 정렬된 배열로 가져오기
async function getAllProjectsSorted(projectType) {
    try {
        const refPath = projectType === 'current' ? 'current projects' : 'past projects';
        const ref = database.ref(refPath);
        const snapshot = await ref.orderByChild('displayOrder').once('value');
        const data = snapshot.val() || {};
        
        // displayOrder가 없는 기존 항목들은 createdAt으로 정렬
        const projects = Object.entries(data)
            .filter(([key, value]) => value && value.name)
            .map(([key, value]) => ({
                key,
                ...value,
                displayOrder: value.displayOrder !== undefined ? value.displayOrder : value.createdAt || 0
            }))
            .sort((a, b) => a.displayOrder - b.displayOrder);
        
        console.log(`📊 ${projectType} 프로젝트 정렬 결과:`, projects.length, '개');
        projects.forEach((project, index) => {
            console.log(`  ${index + 1}. ${project.name} (order: ${project.displayOrder})`);
        });
        
        return projects;
    } catch (error) {
        console.error('❌ 프로젝트 정렬 조회 실패:', error);
        return [];
    }
}

// 특정 위치에 프로젝트 삽입
async function insertProjectAtPosition(projectData, targetPosition) {
    try {
        console.log('🎯 특정 위치 삽입 시작');
        console.log('📍 대상 위치:', targetPosition);
        console.log('📦 프로젝트:', projectData.name);
        
        const projectType = projectData.type;
        const refPath = projectType === 'current' ? 'current projects' : 'past projects';
        const ref = database.ref(refPath);
        
        // 현재 모든 프로젝트 가져오기
        const existingProjects = await getAllProjectsSorted(projectType);
        console.log('📊 기존 프로젝트 수:', existingProjects.length);
        
        // 위치 검증
        const maxPosition = existingProjects.length + 1;
        const actualPosition = Math.max(1, Math.min(parseInt(targetPosition), maxPosition));
        
        if (actualPosition !== parseInt(targetPosition)) {
            console.log(`⚠️ 위치 조정: ${targetPosition} → ${actualPosition}`);
        }
        
        // 새 프로젝트의 displayOrder 계산
        let newDisplayOrder;
        
        if (actualPosition === 1) {
            // 맨 앞에 삽입
            const firstOrder = existingProjects.length > 0 ? existingProjects[0].displayOrder : 1000;
            newDisplayOrder = firstOrder - 100;
            console.log('📍 맨 앞 삽입, 새 순서:', newDisplayOrder);
        } else if (actualPosition > existingProjects.length) {
            // 맨 뒤에 삽입
            const lastOrder = existingProjects.length > 0 ? existingProjects[existingProjects.length - 1].displayOrder : 0;
            newDisplayOrder = lastOrder + 100;
            console.log('📍 맨 뒤 삽입, 새 순서:', newDisplayOrder);
        } else {
            // 중간에 삽입
            const prevIndex = actualPosition - 2;
            const nextIndex = actualPosition - 1;
            
            const prevOrder = existingProjects[prevIndex].displayOrder;
            const nextOrder = existingProjects[nextIndex].displayOrder;
            
            console.log(`📍 ${prevIndex + 1}번과 ${nextIndex + 1}번 사이 삽입`);
            console.log(`📊 이전: ${prevOrder}, 다음: ${nextOrder}`);
            
            // 중간값 계산
            newDisplayOrder = (prevOrder + nextOrder) / 2;
            
            // 값이 너무 가까우면 재정렬 후 다시 시도
            if (Math.abs(nextOrder - prevOrder) < 1) {
                console.log('⚠️ 순서값이 너무 가까움, 재정렬 필요');
                await reorderProjectsByType(projectType);
                return await insertProjectAtPosition(projectData, targetPosition);
            }
            
            console.log('📍 중간 삽입, 새 순서:', newDisplayOrder);
        }
        
        // 새 프로젝트 데이터 생성
        const newProject = {
            name: projectData.name,
            period: projectData.period,
            funding: projectData.funding,
            description: projectData.description,
            type: projectData.type,
            displayOrder: newDisplayOrder,
            createdAt: Date.now()
        };
        
        console.log('💾 저장할 프로젝트:', newProject);
        
        // Firebase에 저장
        await ref.push(newProject);
        
        console.log('✅ 위치 삽입 완료');
        return true;
        
    } catch (error) {
        console.error('❌ 위치 삽입 실패:', error);
        throw error;
    }
}

// 프로젝트 타입별 재정렬
async function reorderProjectsByType(projectType) {
    try {
        console.log(`🔄 ${projectType} 프로젝트 재정렬 시작`);
        
        const refPath = projectType === 'current' ? 'current projects' : 'past projects';
        const ref = database.ref(refPath);
        
        const existingProjects = await getAllProjectsSorted(projectType);
        
        // 100 단위로 재정렬
        for (let i = 0; i < existingProjects.length; i++) {
            const project = existingProjects[i];
            const newOrder = (i + 1) * 100;
            
            await ref.child(project.key).update({
                displayOrder: newOrder
            });
            
            console.log(`✅ ${project.name}: ${newOrder}`);
        }
        
        console.log('✅ 재정렬 완료');
    } catch (error) {
        console.error('❌ 재정렬 실패:', error);
        throw error;
    }
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
        const currentProjects = await getAllProjectsSorted('current');
        
        // past projects 로드  
        const pastProjects = await getAllProjectsSorted('past');
        
        console.log('📊 현재 프로젝트:', currentProjects.length, '개');
        console.log('📊 과거 프로젝트:', pastProjects.length, '개');
        
        // 현재 프로젝트 처리
        currentProjects.forEach((project, index) => {
            project.id = `current_${index}`;
            project.firebaseKey = project.key;
            project.type = 'current';
            addProjectToDOM(project);
        });
        
        // 과거 프로젝트 처리
        pastProjects.forEach((project, index) => {
            project.id = `past_${index}`;
            project.firebaseKey = project.key;
            project.type = 'past';
            addProjectToDOM(project);
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
    const hasImages = projectNumber && hasProjectImages(projectNumber);
    
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

// ==================== 프로젝트 추가 함수 (개선됨) ====================
async function addProjectToRealtimeDB(projectData) {
    try {
        console.log('💾 프로젝트 추가 시작:', projectData.name);
        console.log('📍 삽입 모드:', projectData.insertPosition);
        
        const insertPosition = projectData.insertPosition;
        const specificPosition = projectData.specificPosition;
        
        if (insertPosition === 'specific' && specificPosition) {
            // 특정 위치 삽입
            console.log('🎯 특정 위치 삽입:', specificPosition);
            await insertProjectAtPosition(projectData, specificPosition);
        } else {
            // 맨 위 또는 맨 아래 삽입
            const refPath = projectData.type === 'current' ? 'current projects' : 'past projects';
            const ref = database.ref(refPath);
            
            let displayOrder;
            
            if (insertPosition === 'last') {
                // 맨 아래 추가
                const existingProjects = await getAllProjectsSorted(projectData.type);
                const lastOrder = existingProjects.length > 0 ? 
                    existingProjects[existingProjects.length - 1].displayOrder : 0;
                displayOrder = lastOrder + 100;
                console.log('⬇️ 맨 아래 삽입, 순서:', displayOrder);
            } else {
                // 맨 위 추가 (기본값)
                const existingProjects = await getAllProjectsSorted(projectData.type);
                const firstOrder = existingProjects.length > 0 ? existingProjects[0].displayOrder : 100;
                displayOrder = firstOrder - 100;
                console.log('⬆️ 맨 위 삽입, 순서:', displayOrder);
            }
            
            const newProject = {
                name: projectData.name,
                period: projectData.period,
                funding: projectData.funding,
                description: projectData.description,
                type: projectData.type,
                displayOrder: displayOrder,
                createdAt: Date.now()
            };
            
            await ref.push(newProject);
        }
        
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
        
        await database.ref(refPath).remove();
        
        showAlert('프로젝트가 삭제되었습니다.', 'success');
        
        const projectElement = document.querySelector(`[data-project-id*="${projectId}"]`);
        if (projectElement) {
            projectElement.remove();
        }
        
        setTimeout(() => {
            loadProjectsFromRealtimeDB();
        }, 500);
        
    } catch (error) {
        console.error('❌ 프로젝트 삭제 실패:', error);
        showAlert('프로젝트 삭제 실패: ' + error.message, 'error');
    }
};

// ==================== 이미지 세부사항 관련 함수들 ====================
window.showProjectDetails = function(projectId, projectName, projectNumber) {
    try {
        console.log('🔍 프로젝트 세부사항 로드:', projectName);
        
        if (!imageModal) {
            showAlert('이미지 모달을 찾을 수 없습니다.', 'error');
            return;
        }
        
        const modalTitle = document.getElementById('imageModalTitle');
        if (modalTitle) {
            modalTitle.textContent = `${projectName} - 세부사항`;
        }
        
        const projectKey = `project_${projectNumber}`;
        const projectImages = PROJECT_IMAGES[projectKey];
        
        if (!projectImages) {
            showAlert('프로젝트 이미지를 찾을 수 없습니다.', 'error');
            return;
        }
        
        // Project 44인 경우 탭 구조 사용
        if (projectKey === 'project_44') {
            setupTabbedModal(projectImages);
        } else {
            // 기존 방식 (단일 갤러리)
            displayImageGallery(projectImages);
        }
        
        imageModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('❌ 세부사항 로드 실패:', error);
        showAlert('세부사항을 불러오는데 실패했습니다.', 'error');
    }
};

// ==================== 탭형 모달 관련 함수들 ====================
function setupTabbedModal(projectImages) {
    // 기존 갤러리 숨기기
    if (imageGallery) imageGallery.style.display = 'none';
    if (noImages) noImages.style.display = 'none';
    
    // 탭 네비게이션이 없으면 추가
    let tabNavigation = document.querySelector('.tab-navigation');
    if (!tabNavigation) {
        createTabNavigation();
        tabNavigation = document.querySelector('.tab-navigation');
    }
    
    tabNavigation.style.display = 'flex';
    
    // 탭 컨텐츠가 없으면 추가
    let architectureTab = document.getElementById('architecture-tab');
    let valuesTab = document.getElementById('values-tab');
    
    if (!architectureTab || !valuesTab) {
        createTabContents();
        architectureTab = document.getElementById('architecture-tab');
        valuesTab = document.getElementById('values-tab');
    }
    
    // 갤러리 표시
    displayTabGallery('architecture', projectImages.architecture || []);
    displayTabGallery('values', projectImages.values || []);
    
    // 기본적으로 Architecture 탭 활성화
    switchTab('architecture');
    
    // 탭 이벤트 리스너 설정
    setupTabEventListeners();
}

function createTabNavigation() {
    const modalBody = document.querySelector('.image-modal-body');
    
    const tabNav = document.createElement('div');
    tabNav.className = 'tab-navigation';
    tabNav.style.cssText = `
        padding: 0 30px;
        background: #2c3e50;
        border-bottom: 2px solid #34495e;
        display: flex;
        gap: 0;
    `;
    
    tabNav.innerHTML = `
        <button class="tab-btn active" data-tab="architecture" style="
            padding: 20px 40px; font-size: 18px; font-weight: 600;
            background: transparent; color: #bdc3c7; border: none;
            cursor: pointer; position: relative; transition: all 0.3s ease;
            border-radius: 0; flex: 1; text-transform: uppercase;
            letter-spacing: 1px;
        ">
            <i class="fas fa-building"></i> Architecture
        </button>
        <button class="tab-btn" data-tab="values" style="
            padding: 20px 40px; font-size: 18px; font-weight: 600;
            background: transparent; color: #bdc3c7; border: none;
            cursor: pointer; position: relative; transition: all 0.3s ease;
            border-radius: 0; flex: 1; text-transform: uppercase;
            letter-spacing: 1px;
        ">
            <i class="fas fa-chart-line"></i> Values
        </button>
    `;
    
    modalBody.insertBefore(tabNav, modalBody.firstChild);
}

function createTabContents() {
    const modalBody = document.querySelector('.image-modal-body');
    
    // Architecture 탭
    const archTab = document.createElement('div');
    archTab.className = 'tab-content active';
    archTab.id = 'architecture-tab';
    archTab.style.cssText = `
        display: block; height: 100%; width: 100%;
        padding: 30px; overflow-y: auto;
    `;
    archTab.innerHTML = `
        <div class="image-gallery" id="architectureGallery" style="
            display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 30px; max-width: 1400px; margin: 0 auto;
        "></div>
        <div class="no-images" id="noArchitectureImages" style="
            display: none; flex-direction: column; align-items: center;
            justify-content: center; height: 60%; color: #7f8c8d; font-size: 18px;
        ">
            <i class="fas fa-building" style="font-size: 64px; margin-bottom: 20px; opacity: 0.5;"></i>
            <p>Architecture 이미지가 없습니다.</p>
        </div>
    `;
    
    // Values 탭
    const valuesTab = document.createElement('div');
    valuesTab.className = 'tab-content';
    valuesTab.id = 'values-tab';
    valuesTab.style.cssText = `
        display: none; height: 100%; width: 100%;
        padding: 30px; overflow-y: auto;
    `;
    valuesTab.innerHTML = `
        <div class="image-gallery" id="valuesGallery" style="
            display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 30px; max-width: 1400px; margin: 0 auto;
        "></div>
        <div class="no-images" id="noValuesImages" style="
            display: none; flex-direction: column; align-items: center;
            justify-content: center; height: 60%; color: #7f8c8d; font-size: 18px;
        ">
            <i class="fas fa-chart-line" style="font-size: 64px; margin-bottom: 20px; opacity: 0.5;"></i>
            <p>Values 이미지가 없습니다.</p>
        </div>
    `;
    
    modalBody.appendChild(archTab);
    modalBody.appendChild(valuesTab);
}

// 탭 전환
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.color = '#bdc3c7';
        btn.style.background = 'transparent';
    });
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    
    // 선택된 탭 활성화
    const selectedBtn = document.querySelector(`[data-tab="${tabName}"]`);
    const selectedContent = document.getElementById(`${tabName}-tab`);
    
    if (selectedBtn) {
        selectedBtn.classList.add('active');
        selectedBtn.style.color = '#fff';
        selectedBtn.style.background = 'rgba(52, 152, 219, 0.2)';
    }
    
    if (selectedContent) {
        selectedContent.classList.add('active');
        selectedContent.style.display = 'block';
    }
    
    currentActiveTab = tabName;
}

// 탭별 갤러리 표시
function displayTabGallery(tabName, images) {
    const gallery = document.getElementById(`${tabName}Gallery`);
    const noImagesElement = document.getElementById(`no${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Images`);
    
    if (!gallery || !noImagesElement) return;
    
    gallery.innerHTML = '';
    
    if (!images || images.length === 0) {
        noImagesElement.style.display = 'flex';
        return;
    }
    
    noImagesElement.style.display = 'none';
    
    images.forEach((image, index) => {
        const galleryItem = document.createElement('div');
        galleryItem.className = 'gallery-item';
        galleryItem.style.cssText = `
            background: #2c3e50; border-radius: 15px; overflow: hidden;
            box-shadow: 0 8px 25px rgba(0,0,0,0.3); transition: all 0.3s ease;
            border: 2px solid transparent;
        `;
        
        galleryItem.innerHTML = `
            <img src="${image.url}" 
                 alt="${image.originalName || image.name}" 
                 onclick="openImageFullscreen('${image.url}', '${(image.originalName || image.name).replace(/'/g, "\\'")}')"
                 style="
                    width: 100%; height: 300px; object-fit: cover;
                    cursor: pointer; transition: transform 0.3s ease;
                 ">
            <div class="gallery-item-info" style="
                padding: 20px; background: linear-gradient(135deg, #34495e, #2c3e50);
            ">
                <p class="gallery-item-name" style="
                    font-size: 16px; font-weight: 600; color: #ecf0f1;
                    margin: 0; text-align: center;
                ">${image.name}</p>
                ${image.description ? `
                    <p class="gallery-item-desc" style="
                        font-size: 14px; color: #bdc3c7; margin-top: 8px;
                        text-align: center; line-height: 1.4;
                    ">${image.description}</p>
                ` : ''}
            </div>
        `;
        
        // 호버 효과 추가
        galleryItem.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-10px)';
            this.style.boxShadow = '0 15px 40px rgba(52, 152, 219, 0.3)';
            this.style.borderColor = '#3498db';
            this.querySelector('img').style.transform = 'scale(1.05)';
        });
        
        galleryItem.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 8px 25px rgba(0,0,0,0.3)';
            this.style.borderColor = 'transparent';
            this.querySelector('img').style.transform = 'scale(1)';
        });
        
        gallery.appendChild(galleryItem);
    });
}

// 탭 이벤트 리스너 설정
function setupTabEventListeners() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    
    // 기존 이벤트 리스너 제거 후 새로 추가
    tabButtons.forEach(button => {
        const newButton = button.cloneNode(true);
        button.parentNode.replaceChild(newButton, button);
        
        newButton.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            switchTab(tabName);
        });
        
        // 호버 효과 추가
        newButton.addEventListener('mouseenter', function() {
            if (!this.classList.contains('active')) {
                this.style.color = '#fff';
                this.style.background = 'rgba(52, 152, 219, 0.1)';
            }
        });
        
        newButton.addEventListener('mouseleave', function() {
            if (!this.classList.contains('active')) {
                this.style.color = '#bdc3c7';
                this.style.background = 'transparent';
            }
        });
    });
}

// 기존 displayImageGallery 함수 수정
function displayImageGallery(images) {
    if (!imageGallery || !noImages) return;
    
    // 탭 네비게이션 숨기기 (일반 프로젝트용)
    const tabNavigation = document.querySelector('.tab-navigation');
    if (tabNavigation) {
        tabNavigation.style.display = 'none';
    }
    
    // 탭 컨텐츠 숨기기
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => {
        content.style.display = 'none';
    });
    
    // 기본 갤러리 표시
    imageGallery.style.display = 'grid';
    imageGallery.innerHTML = '';
    
    if (!images || images.length === 0) {
        noImages.style.display = 'block';
        imageGallery.style.display = 'none';
        return;
    }
    
    noImages.style.display = 'none';
    
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

window.openImageFullscreen = function(imageUrl, imageName) {
    const fullscreenModal = document.createElement('div');
    fullscreenModal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.9); z-index: 1002; display: flex;
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
    
    const projectNameElement = projectElement.querySelector('.project-name');
    const projectName = projectNameElement.textContent.replace('세부사항', '').trim();
    const projectPeriod = projectElement.querySelector('.project-period').textContent.replace('연구기간: ', '').replace(/.*📅\s*/, '');
    const projectFunding = projectElement.querySelector('.project-funding').textContent.replace('Funding: ', '');
    const projectDescElement = projectElement.querySelector('.project-desc');
    const projectDesc = projectDescElement ? projectDescElement.textContent.replace('주요내용: ', '') : '';
    
    const firebaseKey = projectElement.getAttribute('data-firebase-key') || projectId;
    
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
        
        if (oldType !== newType) {
            const oldRefPath = `${oldType === 'current' ? 'current projects' : 'past projects'}/${firebaseKey}`;
            
            const oldSnapshot = await database.ref(oldRefPath).once('value');
            const oldData = oldSnapshot.val();
            const oldDisplayOrder = oldData ? oldData.displayOrder : Date.now();
            
            await database.ref(oldRefPath).remove();
            
            const newRefPath = `${newType === 'current' ? 'current projects' : 'past projects'}`;
            await database.ref(newRefPath).push({
                ...newProjectData,
                displayOrder: oldDisplayOrder,
                createdAt: oldData ? oldData.createdAt : Date.now()
            });
        } else {
            const refPath = `${newType === 'current' ? 'current projects' : 'past projects'}/${firebaseKey}`;
            await database.ref(refPath).update(newProjectData);
        }
        
        showAlert('프로젝트가 성공적으로 수정되었습니다!', 'success');
        
        if (editProjectForm) {
            editProjectForm.style.display = 'none';
        }
        if (projectEditForm) {
            projectEditForm.reset();
        }
        currentEditingProject = null;
        
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
    
    if (toggleEditMode) {
        toggleEditMode.classList.toggle('active', editMode);
    }
    
    if (toggleDeleteMode) {
        toggleDeleteMode.classList.toggle('active', deleteMode);
    }
}

// ==================== 위치 입력 도우미 함수들 ====================
function resetPositionFields() {
    const insertPositionSelect = document.getElementById('insertPosition');
    const specificPositionGroup = document.getElementById('specificPositionGroup');
    const specificPositionInput = document.getElementById('specificPosition');
    
    if (insertPositionSelect) {
        insertPositionSelect.value = 'first';
    }
    if (specificPositionGroup) {
        specificPositionGroup.style.display = 'none';
        specificPositionGroup.classList.add('hidden');
    }
    if (specificPositionInput) {
        specificPositionInput.value = '';
    }
}

// 현재 프로젝트 수를 기반으로 위치 옵션 업데이트
async function updatePositionOptions() {
    try {
        const projectTypeSelect = document.getElementById('projectType');
        const specificPositionInput = document.getElementById('specificPosition');
        
        if (!projectTypeSelect || !specificPositionInput) return;
        
        const selectedType = projectTypeSelect.value;
        const existingProjects = await getAllProjectsSorted(selectedType);
        const maxPosition = existingProjects.length + 1;
        
        // placeholder 업데이트
        specificPositionInput.placeholder = `1 ~ ${maxPosition} 사이의 숫자 입력`;
        specificPositionInput.max = maxPosition;
        
        // 도움말 텍스트 업데이트
        const helpText = document.querySelector('.position-help');
        if (helpText) {
            helpText.textContent = `현재 ${existingProjects.length}개 프로젝트가 있습니다. 1~${maxPosition} 사이로 입력하세요.`;
        }
        
        console.log(`📊 ${selectedType} 프로젝트 위치 옵션 업데이트: 1~${maxPosition}`);
        
    } catch (error) {
        console.error('❌ 위치 옵션 업데이트 실패:', error);
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
    
    cancelEditProject.addEventListener('click', () => {
        editProjectForm.style.display = 'none';
        projectEditForm.reset();
        currentEditingProject = null;
        showAlert('프로젝트 수정이 취소되었습니다.', 'warning');
    });
    
    projectEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await updateProject();
    });
    
    console.log('✅ 수정 관련 이벤트 리스너 설정 완료');
}

function setupImageEventListeners() {
    if (imageModalClose) {
        imageModalClose.addEventListener('click', () => {
            imageModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        });
    }
    
    if (imageModal) {
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal) {
                imageModal.style.display = 'none';
                document.body.style.overflow = 'auto';
            }
        });
    }
    
    // ESC 키로 모달 닫기
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && imageModal.style.display === 'block') {
            imageModal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
    });
    
    console.log('✅ 이미지 관련 이벤트 리스너 설정 완료');
}

function setupEventListeners() {
    console.log('🔧 이벤트 리스너 설정 시작');
    
    // 로그인 관련
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
        addProjectBtn.addEventListener('click', async () => {
            if (editProjectForm && editProjectForm.style.display === 'block') {
                editProjectForm.style.display = 'none';
                currentEditingProject = null;
            }
            if (addProjectForm) {
                const isVisible = addProjectForm.style.display === 'block';
                addProjectForm.style.display = isVisible ? 'none' : 'block';
                
                // 폼이 열릴 때 위치 옵션 업데이트
                if (!isVisible) {
                    await updatePositionOptions();
                }
            }
        });
    }
    
    if (cancelAddProject) {
        cancelAddProject.addEventListener('click', () => {
            if (addProjectForm) addProjectForm.style.display = 'none';
            if (projectForm) projectForm.reset();
            resetPositionFields();
        });
    }
    
    // 위치 선택 변경 이벤트
    const insertPositionSelect = document.getElementById('insertPosition');
    const specificPositionGroup = document.getElementById('specificPositionGroup');
    const projectTypeSelect = document.getElementById('projectType');
    
    if (insertPositionSelect && specificPositionGroup) {
        insertPositionSelect.addEventListener('change', function() {
            if (this.value === 'specific') {
                specificPositionGroup.style.display = 'block';
                specificPositionGroup.classList.remove('hidden');
                updatePositionOptions(); // 특정 위치 선택 시 옵션 업데이트
            } else {
                specificPositionGroup.style.display = 'none';
                specificPositionGroup.classList.add('hidden');
            }
        });
    }
    
    // 프로젝트 타입 변경 시 위치 옵션 업데이트
    if (projectTypeSelect) {
        projectTypeSelect.addEventListener('change', () => {
            const insertPosition = document.getElementById('insertPosition');
            if (insertPosition && insertPosition.value === 'specific') {
                updatePositionOptions();
            }
        });
    }
    
    if (projectForm) {
        projectForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // 폼 검증
            const formData = new FormData(projectForm);
            const insertPosition = formData.get('insertPosition');
            const specificPosition = formData.get('specificPosition');
            
            // 특정 위치 선택 시 위치값 검증
            if (insertPosition === 'specific') {
                if (!specificPosition || specificPosition < 1) {
                    showAlert('올바른 위치를 입력해주세요.', 'error');
                    return;
                }
                
                // 최대 위치 검증
                const projectType = formData.get('projectType');
                const existingProjects = await getAllProjectsSorted(projectType);
                const maxPosition = existingProjects.length + 1;
                
                if (parseInt(specificPosition) > maxPosition) {
                    showAlert(`위치는 1~${maxPosition} 사이여야 합니다.`, 'error');
                    return;
                }
            }
            
            const projectData = {
                name: formData.get('projectName'),
                period: formData.get('projectPeriod'),
                funding: formData.get('projectFunding'),
                description: formData.get('projectDesc'),
                type: formData.get('projectType'),
                insertPosition: insertPosition,
                specificPosition: specificPosition
            };
            
            console.log('📝 프로젝트 추가 요청:', projectData);
            
            await addProjectToRealtimeDB(projectData);
            if (addProjectForm) addProjectForm.style.display = 'none';
            if (projectForm) projectForm.reset();
            resetPositionFields();
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

    setupEditEventListeners();
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

// ==================== 데이터 마이그레이션 함수 ====================
async function migrateToDisplayOrder() {
    try {
        console.log('🔄 displayOrder 필드로 데이터 마이그레이션 시작...');
        
        const types = ['current projects', 'past projects'];
        
        for (const type of types) {
            console.log(`📊 ${type} 마이그레이션 중...`);
            
            const ref = database.ref(type);
            const snapshot = await ref.once('value');
            const data = snapshot.val() || {};
            
            const projects = Object.entries(data).filter(([key, project]) => project && project.name);
            
            for (let i = 0; i < projects.length; i++) {
                const [key, project] = projects[i];
                
                // displayOrder가 없는 경우에만 추가
                if (project.displayOrder === undefined) {
                    const displayOrder = (i + 1) * 100; // 100, 200, 300...
                    
                    await ref.child(key).update({
                        displayOrder: displayOrder,
                        createdAt: project.createdAt || Date.now()
                    });
                    
                    console.log(`✅ ${project.name}: displayOrder ${displayOrder} 추가`);
                }
            }
        }
        
        console.log('✅ 마이그레이션 완료');
        showAlert('데이터 마이그레이션이 완료되었습니다.', 'success');
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadProjectsFromRealtimeDB();
        }, 1000);
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error);
        showAlert('마이그레이션 실패: ' + error.message, 'error');
    }
}

// ==================== 메인 초기화 ====================
document.addEventListener("DOMContentLoaded", function() {
    console.log('🚀 개선된 프로젝트 관리 시스템 시작');
    
    // DOM 요소들 초기화
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
    
    imageModal = document.getElementById('imageModal');
    imageModalClose = document.getElementById('imageModalClose');
    imageGallery = document.getElementById('imageGallery');
    noImages = document.getElementById('noImages');
    
    console.log('📱 DOM 요소 초기화 완료');
    
    // Firebase 초기화
    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log('🔥 Firebase 앱 초기화 완료');
        }
        
        auth = firebase.auth();
        database = firebase.database();
        
        console.log('✅ Firebase 서비스 초기화 완료');
        
        auth.onAuthStateChanged((user) => {
            currentUser = user;
            updateAuthUI();
            
            if (user) {
                console.log('✅ 사용자 로그인:', user.email);
            } else {
                console.log('ℹ️ 사용자 미로그인');
            }
            
            loadProjectsFromRealtimeDB();
        });
        
    } catch (error) {
        console.error('❌ Firebase 초기화 실패:', error);
        showAlert('Firebase 초기화 실패: ' + error.message, 'error');
    }
    
    setupEventListeners();
    setupScrollAnimation();
    setupMoreButton();
    
    console.log('🎯 개선된 프로젝트 관리 시스템 로드 완료');
});

// ==================== 디버깅 및 관리 함수들 ====================
window.debugSystem = function() {
    console.log('=== 시스템 상태 ===');
    console.log('- currentUser:', currentUser);
    console.log('- deleteMode:', deleteMode);
    console.log('- editMode:', editMode);
    console.log('- database:', database ? '연결됨' : '연결 안됨');
    console.log('- PROJECT_IMAGES:', Object.keys(PROJECT_IMAGES));
    
    loadProjectsFromRealtimeDB();
};

window.runDisplayOrderMigration = function() {
    if (confirm('displayOrder 필드로 마이그레이션을 실행하시겠습니까?')) {
        migrateToDisplayOrder();
    }
};

window.manualReorder = function(projectType = 'current') {
    if (confirm(`${projectType} 프로젝트 순서를 수동으로 재정렬하시겠습니까?`)) {
        reorderProjectsByType(projectType);
    }
};

// 위치 테스트 함수
window.testPositionInsert = async function(projectType = 'current', position = 1) {
    console.log(`🧪 위치 ${position}에 테스트 프로젝트 삽입`);
    
    const testProject = {
        name: `테스트 프로젝트 ${Date.now()}`,
        period: '2024.01 ~ 2024.12',
        funding: '테스트 펀딩',
        description: '위치 삽입 테스트용 프로젝트',
        type: projectType,
        insertPosition: 'specific',
        specificPosition: position
    };
    
    await addProjectToRealtimeDB(testProject);
};

console.log('🎯 완성된 projects.js 로드 완료 - 탭형 모달 포함');