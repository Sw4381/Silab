// projects.js - 프로젝트 관리 시스템
// 설정값은 config.js 참조

// ==================== 전역 변수 선언 ====================
let auth, database;
let currentUser = null;
let deleteMode = false;
let editMode = false;
let isLoadingProjects = false; // 동시 로드로 인한 중복 렌더링 방지 가드
let isMutatingProject = false; // 추가/수정/삭제 동시 실행·더블 클릭 방지 가드

// ==================== 허용된 사용자 목록 ====================
var ALLOWED_USERS = [ALLOWED_EMAIL];

// ==================== DOM 요소들 ====================
let loginBtn, logoutBtn, loginModal, loginClose, loginForm;
let userInfo, userName, adminPanel, addProjectBtn, addProjectForm;
let projectForm, cancelAddProject, toggleDeleteMode, toggleEditMode;
let editProjectForm, projectEditForm, cancelEditProject;
let currentEditingProject = null;

// 프로젝트 이름에서 번호 추출하는 함수
function extractProjectNumber(projectName) {
    const patterns = [
        /\[PJ(\d+)\]/i,
        /PJ(\d+)/i,
        /(?:project|프로젝트)\s*(\d+)/i,
        /project(\d+)/i,
        /프로젝트(\d+)/,
        /(\d+)/
    ];
    
    for (let pattern of patterns) {
        const match = projectName.match(pattern);
        if (match) {
            return parseInt(match[1], 10);
        }
    }
    
    return Infinity; // 번호를 찾을 수 없는 경우 맨 마지막에 배치
}

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


// ==================== 입력값 검증 ====================
// 프로젝트 입력값을 정제(trim)하고 필수값을 검증한다.
// 반환: { ok: true, data } 또는 { ok: false, message }
function validateAndCleanProjectData(raw) {
    const data = {
        name: (raw.name || '').trim(),
        period: (raw.period || '').trim(),
        funding: (raw.funding || '').trim(),
        description: (raw.description || '').trim(),
        type: raw.type === 'past' ? 'past' : 'current'
    };

    if (!data.name) return { ok: false, message: '프로젝트명을 입력해주세요.' };
    if (!data.period) return { ok: false, message: '연구기간을 입력해주세요.' };
    if (!data.funding) return { ok: false, message: 'Funding 정보를 입력해주세요.' };
    if (data.name.length > 300) return { ok: false, message: '프로젝트명이 너무 깁니다. (최대 300자)' };

    return { ok: true, data };
}

// ==================== 새로운 위치 삽입 시스템 ====================

// 모든 프로젝트를 정렬된 배열로 가져오기
async function getAllProjectsSorted(projectType) {
    try {
        const refPath = projectType === 'current' ? 'current projects' : 'past projects';
        const ref = database.ref(refPath);
        const snapshot = await ref.orderByChild('displayOrder').once('value');
        const data = snapshot.val() || {};
        
        const projects = Object.entries(data)
            .filter(([key, value]) => value && value.name)
            .map(([key, value]) => ({
                key,
                ...value,
                displayOrder: value.displayOrder !== undefined ? value.displayOrder : value.createdAt || 0
            }))
            .sort((a, b) => a.displayOrder - b.displayOrder);
        
        console.log(`📊 ${projectType} 프로젝트 정렬 결과:`, projects.length, '개');
        
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
        
        const existingProjects = await getAllProjectsSorted(projectType);
        console.log('📊 기존 프로젝트 수:', existingProjects.length);
        
        const maxPosition = existingProjects.length + 1;
        // 비정상 입력(NaN/음수/소수/범위 초과) 방어: 유효하지 않으면 맨 뒤로 배치
        const requested = parseInt(targetPosition, 10);
        const safeRequested = Number.isInteger(requested) && requested >= 1 ? requested : maxPosition;
        const actualPosition = Math.max(1, Math.min(safeRequested, maxPosition));

        if (actualPosition !== safeRequested) {
            console.log(`⚠️ 위치 조정: ${targetPosition} → ${actualPosition}`);
        }
        
        let newDisplayOrder;
        
        if (actualPosition === 1) {
            const firstOrder = existingProjects.length > 0 ? existingProjects[0].displayOrder : 1000;
            newDisplayOrder = firstOrder - 100;
            console.log('📍 맨 앞 삽입, 새 순서:', newDisplayOrder);
        } else if (actualPosition > existingProjects.length) {
            const lastOrder = existingProjects.length > 0 ? existingProjects[existingProjects.length - 1].displayOrder : 0;
            newDisplayOrder = lastOrder + 100;
            console.log('📍 맨 뒤 삽입, 새 순서:', newDisplayOrder);
        } else {
            const prevIndex = actualPosition - 2;
            const nextIndex = actualPosition - 1;
            
            const prevOrder = existingProjects[prevIndex].displayOrder;
            const nextOrder = existingProjects[nextIndex].displayOrder;
            
            console.log(`📍 ${prevIndex + 1}번과 ${nextIndex + 1}번 사이 삽입`);
            console.log(`📊 이전: ${prevOrder}, 다음: ${nextOrder}`);
            
            newDisplayOrder = (prevOrder + nextOrder) / 2;
            
            if (Math.abs(nextOrder - prevOrder) < 1) {
                console.log('⚠️ 순서값이 너무 가까움, 재정렬 필요');
                await reorderProjectsByType(projectType);
                return await insertProjectAtPosition(projectData, targetPosition);
            }
            
            console.log('📍 중간 삽입, 새 순서:', newDisplayOrder);
        }
        
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

    // 이미 로드가 진행 중이면 중단 (onAuthStateChanged 중복 발화 등으로 인한 목록 중복 방지)
    if (isLoadingProjects) {
        console.log('⏳ 이미 프로젝트 로드 중 - 중복 호출 무시');
        return;
    }
    isLoadingProjects = true;

    try {
        console.log('🔄 Realtime Database에서 프로젝트 로드 중...');

        // 기존 Firebase 프로젝트 제거
        const dynamicProjects = document.querySelectorAll('[data-firebase="true"]');
        dynamicProjects.forEach(item => item.remove());

        // current projects 로드
        const currentProjects = await getAllProjectsSorted('current');

        // past projects 로드 및 프로젝트 번호로 정렬
        const pastProjects = await getAllProjectsSorted('past');

        // 과거 프로젝트를 프로젝트 번호로 정렬
        pastProjects.sort((a, b) => {
            const numA = extractProjectNumber(a.name);
            const numB = extractProjectNumber(b.name);
            return numB - numA; // 큰 번호부터 정렬 (내림차순)
        });

        console.log('📊 현재 프로젝트:', currentProjects.length, '개');
        console.log('📊 과거 프로젝트:', pastProjects.length, '개');

        // 동일 프로젝트 중복 렌더링 방지
        // (같은 프로젝트가 current·past 양쪽 노드에 들어있거나 DB에 중복 저장된 경우 대비)
        const seenProjects = new Set();
        const makeProjectKey = (p) =>
            `${(p.name || '').trim().toLowerCase()}|${(p.period || '').trim().toLowerCase()}`;
        let skippedDuplicates = 0;

        // 현재 프로젝트 처리
        currentProjects.forEach((project, index) => {
            const key = makeProjectKey(project);
            if (seenProjects.has(key)) {
                skippedDuplicates++;
                console.warn('⚠️ 중복 프로젝트 건너뜀 (current):', project.name, '/ key:', project.key);
                return;
            }
            seenProjects.add(key);
            project.id = `current_${index}`;
            project.firebaseKey = project.key;
            project.type = 'current';
            addProjectToDOM(project);
        });

        // 과거 프로젝트 처리
        pastProjects.forEach((project, index) => {
            const key = makeProjectKey(project);
            if (seenProjects.has(key)) {
                skippedDuplicates++;
                console.warn('⚠️ 중복 프로젝트 건너뜀 (past):', project.name, '/ key:', project.key);
                return;
            }
            seenProjects.add(key);
            project.id = `past_${index}`;
            project.firebaseKey = project.key;
            project.type = 'past';
            addProjectToDOM(project);
        });

        if (skippedDuplicates > 0) {
            console.warn(`⚠️ 중복으로 표시되지 않은 프로젝트 ${skippedDuplicates}건 - DB 정리를 권장합니다.`);
        }

        console.log('✅ 프로젝트 로드 완료');
        updateButtonsVisibility();

        // 페이지 요소 표시 애니메이션
        animatePageElements();

    } catch (error) {
        console.error('❌ 프로젝트 로드 실패:', error);
        showAlert('프로젝트 로드에 실패했습니다.', 'error');
    } finally {
        isLoadingProjects = false;
    }
}
// 페이지 애니메이션 함수 추가
function animatePageElements() {
    const hiddenElements = document.querySelectorAll('.hidden');
    
    hiddenElements.forEach((element, index) => {
        setTimeout(() => {
            element.classList.remove('hidden');
            element.classList.add('visible');
        }, index * 150); // 각 요소마다 150ms 간격으로 순차 표시
    });
    
    console.log('✨ 페이지 애니메이션 적용 완료');
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
    // 수정 시 렌더된 텍스트를 다시 파싱하지 않도록 원본 값을 보관 (setAttribute는 자동 이스케이프됨)
    projectDiv.setAttribute('data-name', project.name || '');
    projectDiv.setAttribute('data-period', project.period || '');
    projectDiv.setAttribute('data-funding', project.funding || '');
    projectDiv.setAttribute('data-description', project.description || '');

    const deleteId = project.firebaseKey || project.id;
    const esc = (typeof escHtml === 'function') ? escHtml : (s) => (s == null ? '' : String(s));

    projectDiv.innerHTML = `
        <div class="project-content">
            <div class="project-header">
                <div class="project-info">
                    <h3 class="project-name">
                        ${esc(project.name)}
                    </h3>
                    <p class="project-period">
                        <i class="far fa-calendar-alt"></i> 연구기간: ${esc(project.period)}
                    </p>
                    <p class="project-funding">
                        <strong>Funding:</strong> ${esc(project.funding)}
                    </p>
                    ${project.description ? `
                        <p class="project-desc">
                            <strong>주요내용:</strong> ${esc(project.description)}
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
    // --- 사전 검증 (await 이전에 동기적으로 처리하여 더블 클릭을 확실히 차단) ---
    if (!database) {
        showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'warning');
        return;
    }
    if (isMutatingProject) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }

    const validation = validateAndCleanProjectData(projectData);
    if (!validation.ok) {
        showAlert(validation.message, 'warning');
        return;
    }
    // 정제된 값으로 교체하되 위치 관련 필드는 유지
    projectData = { ...projectData, ...validation.data };

    // 특정 위치 삽입 시 위치값 검증
    if (projectData.insertPosition === 'specific') {
        const pos = parseInt(projectData.specificPosition, 10);
        if (!Number.isInteger(pos) || pos < 1) {
            showAlert('삽입 위치는 1 이상의 숫자로 입력해주세요.', 'warning');
            return;
        }
        projectData.specificPosition = pos;
    }

    isMutatingProject = true;
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
    } finally {
        isMutatingProject = false;
    }
}

// 프로젝트 삭제
window.deleteFirebaseProject = async function(projectId, projectType) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    if (!database) {
        showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }
    if (!projectId) {
        showAlert('삭제할 프로젝트 식별자가 없습니다.', 'error');
        return;
    }
    if (isMutatingProject) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }

    if (!confirm('정말로 이 프로젝트를 삭제하시겠습니까?')) return;

    isMutatingProject = true;
    try {
        console.log('🗑️ 프로젝트 삭제 시도:', projectId, projectType);

        const refPath = `${projectType === 'current' ? 'current projects' : 'past projects'}/${projectId}`;

        await database.ref(refPath).remove();

        showAlert('프로젝트가 삭제되었습니다.', 'success');

        // firebaseKey 기준으로 정확히 매칭하여 즉시 제거 (data-project-id가 아니라 data-firebase-key 사용)
        const projectElement = document.querySelector(`[data-firebase-key="${projectId}"]`);
        if (projectElement) {
            projectElement.remove();
        }

        setTimeout(() => {
            loadProjectsFromRealtimeDB();
        }, 500);

    } catch (error) {
        console.error('❌ 프로젝트 삭제 실패:', error);
        showAlert('프로젝트 삭제 실패: ' + error.message, 'error');
    } finally {
        isMutatingProject = false;
    }
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
    
    // 렌더된 텍스트를 파싱하지 않고 보관해 둔 원본 값을 사용 (공백/아이콘으로 인한 깨짐 방지)
    const projectName = projectElement.getAttribute('data-name') || '';
    const projectPeriod = projectElement.getAttribute('data-period') || '';
    const projectFunding = projectElement.getAttribute('data-funding') || '';
    const projectDesc = projectElement.getAttribute('data-description') || '';

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
    // --- 사전 검증 (await 이전 동기 처리로 더블 클릭 차단) ---
    if (!currentEditingProject) {
        showAlert('수정할 프로젝트가 선택되지 않았습니다.', 'error');
        return;
    }
    if (!database) {
        showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'warning');
        return;
    }
    if (isMutatingProject) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }

    const formData = new FormData(projectEditForm);
    const validation = validateAndCleanProjectData({
        name: formData.get('editProjectName'),
        period: formData.get('editProjectPeriod'),
        funding: formData.get('editProjectFunding'),
        description: formData.get('editProjectDesc'),
        type: formData.get('editProjectType')
    });
    if (!validation.ok) {
        showAlert(validation.message, 'warning');
        return;
    }
    const newProjectData = validation.data;

    const oldType = formData.get('editProjectCurrentType');
    const newType = newProjectData.type;
    const firebaseKey = formData.get('editProjectFirebaseKey');

    if (!firebaseKey) {
        showAlert('수정 대상 식별자를 찾을 수 없습니다. 새로고침 후 다시 시도해주세요.', 'error');
        return;
    }

    isMutatingProject = true;
    try {
        if (oldType !== newType) {
            // 기존 프로젝트의 정보 가져오기
            const oldRefPath = `${oldType === 'current' ? 'current projects' : 'past projects'}/${firebaseKey}`;
            const oldSnapshot = await database.ref(oldRefPath).once('value');
            const oldData = oldSnapshot.val();

            // 이미 삭제된 항목이면 중단 (유령 항목 생성 방지)
            if (!oldData) {
                throw new Error('기존 프로젝트를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
            }

            // 과거 프로젝트로 변경 시 최상단에 위치하도록 displayOrder 설정
            const displayOrder = newType === 'past' ? -100 : Date.now();
            const newRefPath = `${newType === 'current' ? 'current projects' : 'past projects'}`;

            // 데이터 유실 방지: 새 위치에 먼저 생성한 뒤 기존 항목을 삭제
            await database.ref(newRefPath).push({
                ...newProjectData,
                displayOrder: displayOrder,
                createdAt: oldData.createdAt || Date.now()
            });
            await database.ref(oldRefPath).remove();

            // 다른 프로젝트들의 displayOrder 재조정
            await reorderProjectsByType(newType);

        } else {
            // 타입 변경 없는 경우: 존재 확인 후 업데이트
            const refPath = `${newType === 'current' ? 'current projects' : 'past projects'}/${firebaseKey}`;
            const snap = await database.ref(refPath).once('value');
            if (!snap.exists()) {
                throw new Error('수정할 프로젝트를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
            }
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
    } finally {
        isMutatingProject = false;
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

// 메인 초기화
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
    
    editProjectForm = document.getElementById('editProjectForm');
    projectEditForm = document.getElementById('projectEditForm');
    cancelEditProject = document.getElementById('cancelEditProject');
    
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
    
    // 이벤트 리스너 설정
    function setupEventListeners() {
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
        
        // 프로젝트 추가 버튼
        if (addProjectBtn) {
            addProjectBtn.addEventListener('click', () => {
                if (!currentUser) {
                    showAlert('로그인이 필요합니다.', 'warning');
                    return;
                }
                if (addProjectForm) {
                    addProjectForm.style.display = 'block';
                    addProjectForm.scrollIntoView({ behavior: 'smooth' });
                }
                if (editProjectForm) {
                    editProjectForm.style.display = 'none';
                }
            });
        }
        
        // 프로젝트 추가 폼 제출
        if (projectForm) {
            projectForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(projectForm);
                
                const projectData = {
                    name: formData.get('projectName'),
                    period: formData.get('projectPeriod'),
                    funding: formData.get('projectFunding'),
                    description: formData.get('projectDesc'),
                    type: formData.get('projectType'),
                    insertPosition: formData.get('insertPosition'),
                    specificPosition: formData.get('specificPosition')
                };
                
                await addProjectToRealtimeDB(projectData);
                projectForm.reset();
                if (addProjectForm) addProjectForm.style.display = 'none';
                resetPositionFields();
            });
        }
        
        // 프로젝트 추가 취소
        if (cancelAddProject) {
            cancelAddProject.addEventListener('click', () => {
                if (projectForm) projectForm.reset();
                if (addProjectForm) addProjectForm.style.display = 'none';
                resetPositionFields();
            });
        }
        
        // 프로젝트 수정 폼 제출
        if (projectEditForm) {
            projectEditForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                await updateProject();
            });
        }
        
        // 프로젝트 수정 취소
        if (cancelEditProject) {
            cancelEditProject.addEventListener('click', () => {
                if (projectEditForm) projectEditForm.reset();
                if (editProjectForm) editProjectForm.style.display = 'none';
                currentEditingProject = null;
            });
        }
        
        // 수정 모드 토글
        if (toggleEditMode) {
            toggleEditMode.addEventListener('click', () => {
                if (!currentUser) {
                    showAlert('로그인이 필요합니다.', 'warning');
                    return;
                }
                editMode = !editMode;
                if (editMode) {
                    deleteMode = false;
                    showAlert('수정 모드가 활성화되었습니다.', 'success');
                } else {
                    showAlert('수정 모드가 비활성화되었습니다.', 'success');
                }
                updateButtonsVisibility();
            });
        }
        
        // 삭제 모드 토글
        if (toggleDeleteMode) {
            toggleDeleteMode.addEventListener('click', () => {
                if (!currentUser) {
                    showAlert('로그인이 필요합니다.', 'warning');
                    return;
                }
                deleteMode = !deleteMode;
                if (deleteMode) {
                    editMode = false;
                    showAlert('삭제 모드가 활성화되었습니다. 주의하세요!', 'warning');
                } else {
                    showAlert('삭제 모드가 비활성화되었습니다.', 'success');
                }
                updateButtonsVisibility();
            });
        }
        
        // 위치 선택 변경 이벤트
        const insertPositionSelect = document.getElementById('insertPosition');
        const specificPositionGroup = document.getElementById('specificPositionGroup');
        
        if (insertPositionSelect && specificPositionGroup) {
            insertPositionSelect.addEventListener('change', (e) => {
                if (e.target.value === 'specific') {
                    specificPositionGroup.style.display = 'block';
                    specificPositionGroup.classList.remove('hidden');
                    updatePositionOptions();
                } else {
                    specificPositionGroup.style.display = 'none';
                    specificPositionGroup.classList.add('hidden');
                }
            });
        }
        
        // 프로젝트 타입 변경 시 위치 옵션 업데이트
        const projectTypeSelect = document.getElementById('projectType');
        if (projectTypeSelect) {
            projectTypeSelect.addEventListener('change', () => {
                const insertPosition = document.getElementById('insertPosition');
                if (insertPosition && insertPosition.value === 'specific') {
                    updatePositionOptions();
                }
            });
        }
    }
    
    setupEventListeners();
    console.log('🎯 개선된 프로젝트 관리 시스템 로드 완료');
});

console.log('✅ projects.js 로드 완료');