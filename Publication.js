// publications.js - 개선된 논문 관리 JavaScript 파일

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
let currentUser = null;
let deleteMode = false;
let editMode = false;
let currentEditingPublication = null;

// ==================== 허용된 사용자 목록 ====================
const ALLOWED_USERS = ['kinjecs0@gmail.com'];

// ==================== DOM 요소들 ====================
let loginBtn, logoutBtn, loginModal, loginClose, loginForm;
let userInfo, userName, adminPanel, addPublicationBtn, addPublicationForm;
let publicationForm, cancelAddPublication, toggleDeleteMode, toggleEditMode;
let editPublicationForm, publicationEditForm, cancelEditPublication;

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

// ==================== 새로운 위치 삽입 시스템 ====================

// 모든 논문을 정렬된 배열로 가져오기
async function getAllPublicationsSorted(publicationType) {
    try {
        const refPath = `publications/${publicationType}`;
        const ref = database.ref(refPath);
        const snapshot = await ref.orderByChild('displayOrder').once('value');
        const data = snapshot.val() || {};
        
        // displayOrder가 없는 기존 항목들은 createdAt으로 정렬
        const publications = Object.entries(data)
            .filter(([key, value]) => value && value.title)
            .map(([key, value]) => ({
                key,
                ...value,
                displayOrder: value.displayOrder !== undefined ? value.displayOrder : value.createdAt || 0
            }))
            .sort((a, b) => a.displayOrder - b.displayOrder);
        
        console.log(`📊 ${publicationType} 논문 정렬 결과:`, publications.length, '개');
        publications.forEach((publication, index) => {
            console.log(`  ${index + 1}. ${publication.title} (order: ${publication.displayOrder})`);
        });
        
        return publications;
    } catch (error) {
        console.error('❌ 논문 정렬 조회 실패:', error);
        return [];
    }
}

// 특정 위치에 논문 삽입
async function insertPublicationAtPosition(publicationData, targetPosition) {
    try {
        console.log('🎯 특정 위치 삽입 시작');
        console.log('📍 대상 위치:', targetPosition);
        console.log('📦 논문:', publicationData.title);
        
        const publicationType = publicationData.type;
        const refPath = `publications/${publicationType}`;
        const ref = database.ref(refPath);
        
        // 현재 모든 논문 가져오기
        const existingPublications = await getAllPublicationsSorted(publicationType);
        console.log('📊 기존 논문 수:', existingPublications.length);
        
        // 위치 검증
        const maxPosition = existingPublications.length + 1;
        const actualPosition = Math.max(1, Math.min(parseInt(targetPosition), maxPosition));
        
        if (actualPosition !== parseInt(targetPosition)) {
            console.log(`⚠️ 위치 조정: ${targetPosition} → ${actualPosition}`);
        }
        
        // 새 논문의 displayOrder 계산
        let newDisplayOrder;
        
        if (actualPosition === 1) {
            // 맨 앞에 삽입
            const firstOrder = existingPublications.length > 0 ? existingPublications[0].displayOrder : 1000;
            newDisplayOrder = firstOrder - 100;
            console.log('📍 맨 앞 삽입, 새 순서:', newDisplayOrder);
        } else if (actualPosition > existingPublications.length) {
            // 맨 뒤에 삽입
            const lastOrder = existingPublications.length > 0 ? existingPublications[existingPublications.length - 1].displayOrder : 0;
            newDisplayOrder = lastOrder + 100;
            console.log('📍 맨 뒤 삽입, 새 순서:', newDisplayOrder);
        } else {
            // 중간에 삽입
            const prevIndex = actualPosition - 2;
            const nextIndex = actualPosition - 1;
            
            const prevOrder = existingPublications[prevIndex].displayOrder;
            const nextOrder = existingPublications[nextIndex].displayOrder;
            
            console.log(`📍 ${prevIndex + 1}번과 ${nextIndex + 1}번 사이 삽입`);
            console.log(`📊 이전: ${prevOrder}, 다음: ${nextOrder}`);
            
            // 중간값 계산
            newDisplayOrder = (prevOrder + nextOrder) / 2;
            
            // 값이 너무 가까우면 재정렬 후 다시 시도
            if (Math.abs(nextOrder - prevOrder) < 1) {
                console.log('⚠️ 순서값이 너무 가까움, 재정렬 필요');
                await reorderPublicationsByType(publicationType);
                return await insertPublicationAtPosition(publicationData, targetPosition);
            }
            
            console.log('📍 중간 삽입, 새 순서:', newDisplayOrder);
        }
        
        // 새 논문 데이터 생성
        const newPublication = {
            publicationId: publicationData.publicationId,
            title: publicationData.title,
            authors: publicationData.authors,
            journal: publicationData.journal,
            url: publicationData.url || '',
            award: publicationData.award || '',
            type: publicationData.type,
            displayOrder: newDisplayOrder,
            createdAt: Date.now()
        };
        
        console.log('💾 저장할 논문:', newPublication);
        
        // Firebase에 저장
        await ref.push(newPublication);
        
        console.log('✅ 위치 삽입 완료');
        return true;
        
    } catch (error) {
        console.error('❌ 위치 삽입 실패:', error);
        throw error;
    }
}

// 논문 타입별 재정렬
async function reorderPublicationsByType(publicationType) {
    try {
        console.log(`🔄 ${publicationType} 논문 재정렬 시작`);
        
        const refPath = `publications/${publicationType}`;
        const ref = database.ref(refPath);
        
        const existingPublications = await getAllPublicationsSorted(publicationType);
        
        // 100 단위로 재정렬
        for (let i = 0; i < existingPublications.length; i++) {
            const publication = existingPublications[i];
            const newOrder = (i + 1) * 100;
            
            await ref.child(publication.key).update({
                displayOrder: newOrder
            });
            
            console.log(`✅ ${publication.title}: ${newOrder}`);
        }
        
        console.log('✅ 재정렬 완료');
    } catch (error) {
        console.error('❌ 재정렬 실패:', error);
        throw error;
    }
}

// 현재 논문 수를 기반으로 위치 옵션 업데이트
async function updatePositionOptions() {
    try {
        const publicationTypeSelect = document.getElementById('publicationType');
        const specificPositionInput = document.getElementById('specificPosition');
        
        if (!publicationTypeSelect || !specificPositionInput) return;
        
        const selectedType = publicationTypeSelect.value;
        const existingPublications = await getAllPublicationsSorted(selectedType);
        const maxPosition = existingPublications.length + 1;
        
        // placeholder 업데이트
        specificPositionInput.placeholder = `1 ~ ${maxPosition} 사이의 숫자 입력`;
        specificPositionInput.max = maxPosition;
        
        // 도움말 텍스트 업데이트
        const helpText = document.querySelector('.position-help');
        if (helpText) {
            helpText.textContent = `현재 ${existingPublications.length}개 논문이 있습니다. 1~${maxPosition} 사이로 입력하세요.`;
        }
        
        console.log(`📊 ${selectedType} 논문 위치 옵션 업데이트: 1~${maxPosition}`);
        
    } catch (error) {
        console.error('❌ 위치 옵션 업데이트 실패:', error);
    }
}

// ==================== Firebase 관련 함수들 ====================
async function loadPublicationsFromRealtimeDB() {
    if (!database) {
        console.error('❌ Realtime Database가 초기화되지 않았습니다.');
        return;
    }
    
    try {
        console.log('🔄 Realtime Database에서 논문 로드 중...');
        
        // 기존 Firebase 논문 제거
        const lists = ['sci-list', 'kci-list', 'other-list'];
        lists.forEach(listClass => {
            const list = document.querySelector(`.${listClass}`);
            if (list) {
                const dynamicItems = list.querySelectorAll('[data-firebase="true"]');
                dynamicItems.forEach(item => item.remove());
            }
        });
        
        // 기타 발표의 숨겨진 리스트와 더 보기 섹션도 제거
        const otherHiddenList = document.querySelector('.other-hidden-list');
        if (otherHiddenList) {
            const hiddenItems = otherHiddenList.querySelectorAll('[data-firebase="true"]');
            hiddenItems.forEach(item => item.remove());
        }
        
        const morePublicationsSection = document.querySelector('.more-publications');
        if (morePublicationsSection) {
            morePublicationsSection.remove();
        }
        
        // 논문 타입별로 로드
        const types = ['sci', 'kci', 'other'];
        let totalCounts = { sci: 0, kci: 0, other: 0 };
        
        for (const type of types) {
            const publications = await getAllPublicationsSorted(type);
            
            console.log(`📊 ${type} 논문 데이터:`, publications.length, '개');
            
            publications.forEach((publication, index) => {
                publication.id = `${type}_${index}`;
                publication.firebaseKey = publication.key;
                publication.type = type;
                addPublicationToDOM(publication);
                totalCounts[type]++;
            });
        }
        
        // 카운트 업데이트
        updatePublicationCounts(totalCounts);
        
        console.log('✅ 논문 로드 완료');
        updateButtonsVisibility();
        
    } catch (error) {
        console.error('❌ 논문 로드 실패:', error);
        showAlert('논문 로드에 실패했습니다.', 'error');
    }
}

function addPublicationToDOM(publication) {
    let container;
    
    // 논문 타입에 따라 올바른 컨테이너 찾기
    if (publication.type === 'sci') {
        container = document.querySelector('.sci-list');
    } else if (publication.type === 'kci') {
        container = document.querySelector('.kci-list');
    } else if (publication.type === 'other') {
        // 기타 발표 논문의 경우 개수에 따라 컨테이너 결정
        const otherList = document.querySelector('.other-list');
        const visibleItems = otherList ? otherList.querySelectorAll('li:not([data-hidden="true"])').length : 0;
        
        if (visibleItems < 30) {
            // 처음 30편은 바로 표시
            container = otherList;
        } else {
            // 30편 이후는 숨겨진 영역에 추가
            container = document.querySelector('.other-hidden-list');
            if (!container) {
                // 숨겨진 리스트가 없으면 생성
                createMorePublicationsSection();
                container = document.querySelector('.other-hidden-list');
            }
        }
    }
    
    if (container) {
        const publicationElement = createPublicationElement(publication);
        if (publication.type === 'other' && container.classList && container.classList.contains('other-hidden-list')) {
            publicationElement.setAttribute('data-hidden', 'true');
        }
        container.appendChild(publicationElement);
    } else {
        console.error('❌ 논문 컨테이너를 찾을 수 없습니다:', publication.type);
    }
}

// 더 많은 논문 보기 섹션 생성
function createMorePublicationsSection() {
    const otherSection = document.querySelector('.other-section');
    if (!otherSection) return;
    
    const moreSection = document.createElement('div');
    moreSection.className = 'more-publications';
    moreSection.innerHTML = `
        <button id="show-more-other" class="show-more-button">
            <span>더 많은 논문 보기</span>
            <i class="fas fa-chevron-down"></i>
        </button>
        
        <div class="hidden-publications other-hidden" style="display: none;">
            <ul class="other-hidden-list" style="list-style: none; padding: 0; margin: 0;">
                <!-- 30편 이후 논문들이 여기에 표시됩니다 -->
            </ul>
        </div>
    `;
    
    otherSection.appendChild(moreSection);
    
    // 더 보기 버튼 이벤트 리스너 추가
    setupMoreButtonListener();
}

// 더 보기 버튼 이벤트 리스너 설정
function setupMoreButtonListener() {
    const showMoreBtn = document.getElementById('show-more-other');
    const hiddenSection = document.querySelector('.other-hidden');
    
    if (showMoreBtn && hiddenSection) {
        showMoreBtn.addEventListener('click', function() {
            const isHidden = hiddenSection.style.display === 'none';
            
            if (isHidden) {
                hiddenSection.style.display = 'block';
                showMoreBtn.querySelector('span').textContent = '접기';
                showMoreBtn.querySelector('i').classList.remove('fa-chevron-down');
                showMoreBtn.querySelector('i').classList.add('fa-chevron-up');
            } else {
                hiddenSection.style.display = 'none';
                showMoreBtn.querySelector('span').textContent = '더 많은 논문 보기';
                showMoreBtn.querySelector('i').classList.remove('fa-chevron-up');
                showMoreBtn.querySelector('i').classList.add('fa-chevron-down');
            }
        });
    }
}

function createPublicationElement(publication) {
    const li = document.createElement('li');
    li.className = 'publication-item';
    li.setAttribute('data-publication-id', publication.id);
    li.setAttribute('data-firebase', 'true');
    li.setAttribute('data-firebase-key', publication.firebaseKey || publication.id);
    
    const deleteId = publication.firebaseKey || publication.id;
    
    // URL 링크 처리
    const titleContent = publication.url ? 
        `<a href="${publication.url}" target="_blank"><strong>${publication.title}</strong></a>` :
        `<strong>${publication.title}</strong>`;
    
    // 수상 내역 처리
    const awardContent = publication.award ? 
        ` - <span class="award">${publication.award}</span>` : '';
    
    li.innerHTML = `
        <span class="publication-id">[${publication.publicationId}]</span>
        <div class="publication-content">
            <p class="publication-title">${titleContent}</p>
            <p class="publication-authors">${publication.authors}</p>
            <p class="publication-journal">${publication.journal}${awardContent}</p>
            <div class="publication-actions" style="display: none;">
                <button class="edit-publication-btn" onclick="editPublication('${publication.id}', '${publication.type}')" style="display: none;">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button class="delete-publication-btn" onclick="deleteFirebasePublication('${deleteId}', '${publication.type}')" style="display: none;">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>
    `;
    
    return li;
}

function updatePublicationCounts(counts) {
    // 안전하게 DOM 요소 찾기
    const sciCountElement = document.querySelector('.sci-count');
    const kciCountElement = document.querySelector('.kci-count');
    const otherCountElement = document.querySelector('.other-count');
    
    if (sciCountElement) {
        sciCountElement.textContent = `${counts.sci}편`;
    }
    if (kciCountElement) {
        kciCountElement.textContent = `${counts.kci}편`;
    }
    if (otherCountElement) {
        otherCountElement.textContent = `${counts.other}편`;
    }
}

// ==================== 논문 추가 함수 (개선됨) ====================
async function addPublicationToRealtimeDB(publicationData) {
    try {
        console.log('💾 논문 추가 시작:', publicationData.title);
        console.log('📍 삽입 모드:', publicationData.insertPosition);
        
        const insertPosition = publicationData.insertPosition;
        const specificPosition = publicationData.specificPosition;
        
        if (insertPosition === 'specific' && specificPosition) {
            // 특정 위치 삽입
            console.log('🎯 특정 위치 삽입:', specificPosition);
            await insertPublicationAtPosition(publicationData, specificPosition);
        } else {
            // 맨 위 또는 맨 아래 삽입
            const refPath = `publications/${publicationData.type}`;
            const ref = database.ref(refPath);
            
            let displayOrder;
            
            if (insertPosition === 'last') {
                // 맨 아래 추가
                const existingPublications = await getAllPublicationsSorted(publicationData.type);
                const lastOrder = existingPublications.length > 0 ? 
                    existingPublications[existingPublications.length - 1].displayOrder : 0;
                displayOrder = lastOrder + 100;
                console.log('⬇️ 맨 아래 삽입, 순서:', displayOrder);
            } else {
                // 맨 위 추가 (기본값)
                const existingPublications = await getAllPublicationsSorted(publicationData.type);
                const firstOrder = existingPublications.length > 0 ? existingPublications[0].displayOrder : 100;
                displayOrder = firstOrder - 100;
                console.log('⬆️ 맨 위 삽입, 순서:', displayOrder);
            }
            
            const newPublication = {
                publicationId: publicationData.publicationId,
                title: publicationData.title,
                authors: publicationData.authors,
                journal: publicationData.journal,
                url: publicationData.url || '',
                award: publicationData.award || '',
                type: publicationData.type,
                displayOrder: displayOrder,
                createdAt: Date.now()
            };
            
            await ref.push(newPublication);
        }
        
        showAlert('논문이 성공적으로 추가되었습니다!', 'success');
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadPublicationsFromRealtimeDB();
        }, 1000);
        
    } catch (error) {
        console.error('❌ 논문 추가 실패:', error);
        showAlert('논문 추가 실패: ' + error.message, 'error');
    }
}

// 논문 삭제
window.deleteFirebasePublication = async function(publicationId, publicationType) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    
    if (!confirm('정말로 이 논문을 삭제하시겠습니까?')) return;
    
    try {
        console.log('🗑️ 논문 삭제 시도:', publicationId, publicationType);
        
        const refPath = `publications/${publicationType}/${publicationId}`;
        
        // 데이터베이스에서 논문 삭제
        await database.ref(refPath).remove();
        
        showAlert('논문이 삭제되었습니다.', 'success');
        
        // DOM에서도 제거
        const publicationElement = document.querySelector(`[data-publication-id*="${publicationId}"]`);
        if (publicationElement) {
            publicationElement.remove();
        }
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadPublicationsFromRealtimeDB();
        }, 500);
        
    } catch (error) {
        console.error('❌ 논문 삭제 실패:', error);
        showAlert('논문 삭제 실패: ' + error.message, 'error');
    }
};

// ==================== 논문 수정 관련 함수들 ====================
window.editPublication = function(publicationId, publicationType) {
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'warning');
        return;
    }
    
    if (!editMode) {
        showAlert('수정 모드가 활성화되지 않았습니다.', 'warning');
        return;
    }
    
    console.log('✏️ 논문 수정 모드 시작:', publicationId);
    
    const publicationElement = document.querySelector(`[data-publication-id="${publicationId}"]`);
    if (!publicationElement) {
        showAlert('논문을 찾을 수 없습니다.', 'error');
        return;
    }
    
    // 논문 정보 추출
    const publicationIdText = publicationElement.querySelector('.publication-id').textContent.replace(/[\[\]]/g, '');
    const publicationTitle = publicationElement.querySelector('.publication-title strong').textContent;
    const publicationAuthors = publicationElement.querySelector('.publication-authors').textContent;
    const journalElement = publicationElement.querySelector('.publication-journal');
    const journalText = journalElement.textContent;
    const awardElement = journalElement.querySelector('.award');
    
    // 저널과 수상 내역 분리
    let publicationJournal = journalText;
    let publicationAward = '';
    if (awardElement) {
        publicationAward = awardElement.textContent;
        publicationJournal = journalText.replace(` - ${publicationAward}`, '');
    }
    
    // URL 추출
    const linkElement = publicationElement.querySelector('.publication-title a');
    const publicationUrl = linkElement ? linkElement.href : '';
    
    const firebaseKey = publicationElement.getAttribute('data-firebase-key') || publicationId;
    
    // 수정 폼에 데이터 채우기
    document.getElementById('editPublicationKey').value = firebaseKey;
    document.getElementById('editPublicationCurrentType').value = publicationType;
    document.getElementById('editPublicationId').value = publicationIdText;
    document.getElementById('editPublicationType').value = publicationType;
    document.getElementById('editPublicationTitle').value = publicationTitle;
    document.getElementById('editPublicationAuthors').value = publicationAuthors;
    document.getElementById('editPublicationJournal').value = publicationJournal;
    document.getElementById('editPublicationUrl').value = publicationUrl;
    document.getElementById('editPublicationAward').value = publicationAward;
    
    currentEditingPublication = {
        id: publicationId,
        firebaseKey: firebaseKey,
        type: publicationType
    };
    
    // 폼 표시
    if (addPublicationForm) {
        addPublicationForm.style.display = 'none';
    }
    if (editPublicationForm) {
        editPublicationForm.style.display = 'block';
        editPublicationForm.scrollIntoView({ behavior: 'smooth' });
    }
    
    showAlert('논문 수정 모드가 활성화되었습니다.', 'success');
};

async function updatePublication() {
    if (!currentEditingPublication) {
        showAlert('수정할 논문이 선택되지 않았습니다.', 'error');
        return;
    }
    
    try {
        console.log('💾 논문 수정 시작');
        
        const formData = new FormData(publicationEditForm);
        const newPublicationData = {
            publicationId: formData.get('editPublicationId'),
            title: formData.get('editPublicationTitle'),
            authors: formData.get('editPublicationAuthors'),
            journal: formData.get('editPublicationJournal'),
            url: formData.get('editPublicationUrl') || '',
            award: formData.get('editPublicationAward') || '',
            type: formData.get('editPublicationType')
        };
        
        const oldType = formData.get('editPublicationCurrentType');
        const newType = newPublicationData.type;
        const firebaseKey = formData.get('editPublicationKey');
        
        // 논문 업데이트
        if (oldType !== newType) {
            // 타입이 변경된 경우: 기존 위치에서 삭제하고 새 위치에 추가
            const oldRefPath = `publications/${oldType}/${firebaseKey}`;
            
            const oldSnapshot = await database.ref(oldRefPath).once('value');
            const oldData = oldSnapshot.val();
            const oldDisplayOrder = oldData ? oldData.displayOrder : Date.now();
            
            await database.ref(oldRefPath).remove();
            
            const newRefPath = `publications/${newType}`;
            await database.ref(newRefPath).push({
                ...newPublicationData,
                displayOrder: oldDisplayOrder,
                createdAt: oldData ? oldData.createdAt : Date.now()
            });
        } else {
            // 같은 타입 내에서 수정
            const refPath = `publications/${newType}/${firebaseKey}`;
            await database.ref(refPath).update(newPublicationData);
        }
        
        showAlert('논문이 성공적으로 수정되었습니다!', 'success');
        
        // 폼 초기화 및 숨기기
        if (editPublicationForm) {
            editPublicationForm.style.display = 'none';
        }
        if (publicationEditForm) {
            publicationEditForm.reset();
        }
        currentEditingPublication = null;
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadPublicationsFromRealtimeDB();
        }, 1000);
        
    } catch (error) {
        console.error('❌ 논문 수정 실패:', error);
        showAlert('논문 수정 실패: ' + error.message, 'error');
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
        if (addPublicationForm) addPublicationForm.style.display = 'none';
        if (editPublicationForm) editPublicationForm.style.display = 'none';
        deleteMode = false;
        editMode = false;
    }
    updateButtonsVisibility();
}

function updateButtonsVisibility() {
    const publicationActions = document.querySelectorAll('.publication-actions');
    const editButtons = document.querySelectorAll('.edit-publication-btn');
    const deleteButtons = document.querySelectorAll('.delete-publication-btn');
    
    publicationActions.forEach(action => {
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

// ==================== 이벤트 리스너 설정 ====================
function setupEditEventListeners() {
    editPublicationForm = document.getElementById('editPublicationForm');
    publicationEditForm = document.getElementById('publicationEditForm');
    cancelEditPublication = document.getElementById('cancelEditPublication');
    
    if (!editPublicationForm || !publicationEditForm || !cancelEditPublication) {
        console.warn('⚠️ 수정 관련 DOM 요소를 찾을 수 없습니다.');
        return;
    }
    
    // 수정 취소 버튼
    cancelEditPublication.addEventListener('click', () => {
        editPublicationForm.style.display = 'none';
        publicationEditForm.reset();
        currentEditingPublication = null;
        showAlert('논문 수정이 취소되었습니다.', 'warning');
    });
    
    // 수정 폼 제출
    publicationEditForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await updatePublication();
    });
    
    console.log('✅ 수정 관련 이벤트 리스너 설정 완료');
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

    // 논문 관리
    if (addPublicationBtn) {
        addPublicationBtn.addEventListener('click', async () => {
            if (editPublicationForm && editPublicationForm.style.display === 'block') {
                editPublicationForm.style.display = 'none';
                currentEditingPublication = null;
            }
            if (addPublicationForm) {
                const isVisible = addPublicationForm.style.display === 'block';
                addPublicationForm.style.display = isVisible ? 'none' : 'block';
                
                // 폼이 열릴 때 위치 옵션 업데이트
                if (!isVisible) {
                    await updatePositionOptions();
                }
            }
        });
    }
    
    if (cancelAddPublication) {
        cancelAddPublication.addEventListener('click', () => {
            if (addPublicationForm) addPublicationForm.style.display = 'none';
            if (publicationForm) publicationForm.reset();
            resetPositionFields();
        });
    }
    
    // 위치 선택 변경 이벤트
    const insertPositionSelect = document.getElementById('insertPosition');
    const specificPositionGroup = document.getElementById('specificPositionGroup');
    const publicationTypeSelect = document.getElementById('publicationType');
    
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
    
    // 논문 타입 변경 시 위치 옵션 업데이트
    if (publicationTypeSelect) {
        publicationTypeSelect.addEventListener('change', () => {
            const insertPosition = document.getElementById('insertPosition');
            if (insertPosition && insertPosition.value === 'specific') {
                updatePositionOptions();
            }
        });
    }
    
    if (publicationForm) {
        publicationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // 폼 검증
            const formData = new FormData(publicationForm);
            const insertPosition = formData.get('insertPosition');
            const specificPosition = formData.get('specificPosition');
            
            // 특정 위치 선택 시 위치값 검증
            if (insertPosition === 'specific') {
                if (!specificPosition || specificPosition < 1) {
                    showAlert('올바른 위치를 입력해주세요.', 'error');
                    return;
                }
                
                // 최대 위치 검증
                const publicationType = formData.get('publicationType');
                const existingPublications = await getAllPublicationsSorted(publicationType);
                const maxPosition = existingPublications.length + 1;
                
                if (parseInt(specificPosition) > maxPosition) {
                    showAlert(`위치는 1~${maxPosition} 사이여야 합니다.`, 'error');
                    return;
                }
            }
            
            const publicationData = {
                publicationId: formData.get('publicationId'),
                title: formData.get('publicationTitle'),
                authors: formData.get('publicationAuthors'),
                journal: formData.get('publicationJournal'),
                url: formData.get('publicationUrl') || '',
                award: formData.get('publicationAward') || '',
                type: formData.get('publicationType'),
                insertPosition: insertPosition,
                specificPosition: specificPosition
            };
            
            console.log('📝 논문 추가 요청:', publicationData);
            
            await addPublicationToRealtimeDB(publicationData);
            if (addPublicationForm) addPublicationForm.style.display = 'none';
            if (publicationForm) publicationForm.reset();
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

    // 수정 관련 이벤트 리스너 설정
    setupEditEventListeners();
    
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

// 스크롤 이동 함수
window.scrollToElement = function(elementId) {
    const element = document.getElementById(elementId);
    const headerOffset = 110; // 헤더 높이 등 고정 요소 고려
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

    window.scrollTo({
        top: offsetPosition,
        behavior: 'smooth'
    });
}

// ==================== 데이터 마이그레이션 함수 ====================
async function migrateToDisplayOrder() {
    try {
        console.log('🔄 displayOrder 필드로 데이터 마이그레이션 시작...');
        
        const types = ['sci', 'kci', 'other'];
        
        for (const type of types) {
            console.log(`📊 ${type} 마이그레이션 중...`);
            
            const ref = database.ref(`publications/${type}`);
            const snapshot = await ref.once('value');
            const data = snapshot.val() || {};
            
            const publications = Object.entries(data).filter(([key, publication]) => publication && publication.title);
            
            for (let i = 0; i < publications.length; i++) {
                const [key, publication] = publications[i];
                
                // displayOrder가 없는 경우에만 추가
                if (publication.displayOrder === undefined) {
                    const displayOrder = (i + 1) * 100; // 100, 200, 300...
                    
                    await ref.child(key).update({
                        displayOrder: displayOrder,
                        createdAt: publication.createdAt || Date.now()
                    });
                    
                    console.log(`✅ ${publication.title}: displayOrder ${displayOrder} 추가`);
                }
            }
        }
        
        console.log('✅ 마이그레이션 완료');
        showAlert('데이터 마이그레이션이 완료되었습니다.', 'success');
        
        // 데이터 다시 로드
        setTimeout(() => {
            loadPublicationsFromRealtimeDB();
        }, 1000);
        
    } catch (error) {
        console.error('❌ 마이그레이션 실패:', error);
        showAlert('마이그레이션 실패: ' + error.message, 'error');
    }
}

// ==================== 메인 초기화 ====================
document.addEventListener("DOMContentLoaded", function() {
    console.log('🚀 개선된 논문 관리 시스템 시작');
    
    // DOM 요소들 초기화
    loginBtn = document.getElementById('loginBtn');
    logoutBtn = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal');
    loginClose = document.getElementById('loginClose');
    loginForm = document.getElementById('loginForm');
    userInfo = document.getElementById('userInfo');
    userName = document.getElementById('userName');
    adminPanel = document.getElementById('adminPanel');
    addPublicationBtn = document.getElementById('addPublicationBtn');
    addPublicationForm = document.getElementById('addPublicationForm');
    publicationForm = document.getElementById('publicationForm');
    cancelAddPublication = document.getElementById('cancelAddPublication');
    toggleDeleteMode = document.getElementById('toggleDeleteMode');
    toggleEditMode = document.getElementById('toggleEditMode');
    
    console.log('📱 DOM 요소 초기화 완료');
    
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
            } else {
                console.log('ℹ️ 사용자 미로그인');
            }
            
            loadPublicationsFromRealtimeDB();
        });
        
    } catch (error) {
        console.error('❌ Firebase 초기화 실패:', error);
        showAlert('Firebase 초기화 실패: ' + error.message, 'error');
    }
    
    // 이벤트 리스너들 설정
    setupEventListeners();
    
    // 스크롤 애니메이션
    setupScrollAnimation();
    
    console.log('🎯 개선된 논문 관리 시스템 로드 완료');
});

// ==================== 디버깅 및 관리 함수들 ====================
window.debugSystem = function() {
    console.log('=== 시스템 상태 ===');
    console.log('- currentUser:', currentUser);
    console.log('- deleteMode:', deleteMode);
    console.log('- editMode:', editMode);
    console.log('- database:', database ? '연결됨' : '연결 안됨');
    console.log('- currentEditingPublication:', currentEditingPublication);
    
    loadPublicationsFromRealtimeDB();
};

window.runDisplayOrderMigration = function() {
    if (confirm('displayOrder 필드로 마이그레이션을 실행하시겠습니까?')) {
        migrateToDisplayOrder();
    }
};

window.manualReorder = function(publicationType = 'sci') {
    if (confirm(`${publicationType} 논문 순서를 수동으로 재정렬하시겠습니까?`)) {
        reorderPublicationsByType(publicationType);
    }
};

// 위치 테스트 함수
window.testPositionInsert = async function(publicationType = 'sci', position = 1) {
    console.log(`🧪 위치 ${position}에 테스트 논문 삽입`);
    
    const testPublication = {
        publicationId: `TEST${Date.now()}`,
        title: `테스트 논문 ${Date.now()}`,
        authors: '테스트 저자',
        journal: '테스트 저널',
        url: '',
        award: '',
        type: publicationType,
        insertPosition: 'specific',
        specificPosition: position
    };
    
    await addPublicationToRealtimeDB(testPublication);
};

console.log('🎯 개선된 publications.js 로드 완료');