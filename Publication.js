// publications.js - 논문 번호 자동 제안 기능이 포함된 완전한 논문 관리 JavaScript 파일
// 설정값은 config.js 참조

// ==================== 전역 변수 선언 ====================
let auth, database;
let currentUser = null;
let deleteMode = false;
let editMode = false;
let currentEditingPublication = null;
let isMutatingPublication = false;

// ==================== 허용된 사용자 목록 ====================
var ALLOWED_USERS = [ALLOWED_EMAIL];

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

// ==================== 논문 번호 관련 함수들 (새로 추가) ====================

// 모든 논문에서 가장 높은 번호 찾기
async function getHighestPublicationNumber() {
    try {
        console.log('🔍 가장 높은 논문 번호 검색 중...');
        
        let highestNumber = 0;
        const types = ['sci', 'kci', 'other'];
        
        for (const type of types) {
            const refPath = `publications/${type}`;
            const ref = database.ref(refPath);
            const snapshot = await ref.once('value');
            const data = snapshot.val() || {};
            
            Object.values(data).forEach(publication => {
                if (publication && publication.publicationId) {
                    // P 뒤의 숫자만 추출 (예: P179 -> 179)
                    const match = publication.publicationId.match(/P(\d+)/i);
                    if (match) {
                        const number = parseInt(match[1], 10);
                        if (number > highestNumber) {
                            highestNumber = number;
                        }
                    }
                }
            });
        }
        
        console.log('📊 현재 가장 높은 논문 번호:', highestNumber);
        return highestNumber;
        
    } catch (error) {
        console.error('❌ 논문 번호 검색 실패:', error);
        return 0;
    }
}

// 다음 논문 번호 제안
async function suggestNextPublicationNumber() {
    try {
        const highestNumber = await getHighestPublicationNumber();
        const nextNumber = highestNumber + 1;
        const suggestedId = `P${nextNumber}`;
        
        console.log('💡 제안하는 다음 논문 번호:', suggestedId);
        return suggestedId;
        
    } catch (error) {
        console.error('❌ 논문 번호 제안 실패:', error);
        return 'P1'; // 기본값
    }
}

// 논문 ID 입력 필드 업데이트
async function updatePublicationIdSuggestion() {
    try {
        const publicationIdInput = document.getElementById('publicationId');
        if (!publicationIdInput) return;
        
        const suggestedId = await suggestNextPublicationNumber();
        
        // placeholder에 제안 번호 표시
        publicationIdInput.placeholder = `예: ${suggestedId} (다음 추천 번호)`;
        
        // 입력 필드 옆에 도움말 추가
        let helpElement = document.querySelector('.publication-id-help');
        if (!helpElement) {
            helpElement = document.createElement('div');
            helpElement.className = 'publication-id-help';
            helpElement.style.cssText = `
                font-size: 12px;
                color: #666;
                margin-top: 4px;
                padding: 8px 12px;
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border-radius: 6px;
                border-left: 4px solid #007bff;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                animation: slideInDown 0.3s ease;
            `;
            publicationIdInput.parentNode.appendChild(helpElement);
        }
        
        helpElement.innerHTML = `
            <i class="fas fa-lightbulb" style="color: #ffc107;"></i>
            <strong>제안 번호: ${suggestedId}</strong> (현재 가장 높은 번호 기준)
        `;
        
        // 자동 입력 버튼 추가 또는 업데이트
        let autoFillBtn = document.querySelector('.auto-fill-btn');
        if (!autoFillBtn) {
            // 입력 필드를 컨테이너로 감싸기
            const inputContainer = document.createElement('div');
            inputContainer.className = 'input-with-button';
            inputContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';
            
            publicationIdInput.parentNode.insertBefore(inputContainer, publicationIdInput);
            inputContainer.appendChild(publicationIdInput);
            
            // 자동 입력 버튼 생성
            autoFillBtn = document.createElement('button');
            autoFillBtn.type = 'button';
            autoFillBtn.className = 'auto-fill-btn';
            autoFillBtn.style.cssText = `
                padding: 6px 12px;
                font-size: 12px;
                background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.3s ease;
                box-shadow: 0 2px 4px rgba(0,123,255,0.3);
                white-space: nowrap;
            `;
            autoFillBtn.innerHTML = '<i class="fas fa-magic"></i> 자동입력';
            
            autoFillBtn.addEventListener('mouseenter', () => {
                autoFillBtn.style.background = 'linear-gradient(135deg, #0056b3 0%, #004085 100%)';
                autoFillBtn.style.transform = 'translateY(-1px)';
                autoFillBtn.style.boxShadow = '0 4px 8px rgba(0,123,255,0.4)';
            });
            
            autoFillBtn.addEventListener('mouseleave', () => {
                autoFillBtn.style.background = 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)';
                autoFillBtn.style.transform = 'translateY(0)';
                autoFillBtn.style.boxShadow = '0 2px 4px rgba(0,123,255,0.3)';
            });
            
            inputContainer.appendChild(autoFillBtn);
        }
        
        // 자동 입력 버튼 클릭 이벤트 업데이트
        autoFillBtn.onclick = () => {
            publicationIdInput.value = suggestedId;
            showAlert(`논문 번호 ${suggestedId}가 자동 입력되었습니다.`, 'success');
            
            // 실시간 검증 트리거
            const event = new Event('input', { bubbles: true });
            publicationIdInput.dispatchEvent(event);
        };
        
        console.log('✅ 논문 번호 제안 업데이트 완료');
        
    } catch (error) {
        console.error('❌ 논문 번호 제안 업데이트 실패:', error);
    }
}

// 논문 번호 중복 체크
async function checkDuplicatePublicationId(publicationId) {
    try {
        const types = ['sci', 'kci', 'other'];
        
        for (const type of types) {
            const refPath = `publications/${type}`;
            const ref = database.ref(refPath);
            const snapshot = await ref.once('value');
            const data = snapshot.val() || {};
            
            const duplicate = Object.values(data).find(publication => 
                publication && publication.publicationId === publicationId
            );
            
            if (duplicate) {
                return {
                    isDuplicate: true,
                    type: type,
                    title: duplicate.title
                };
            }
        }
        
        return { isDuplicate: false };
        
    } catch (error) {
        console.error('❌ 중복 체크 실패:', error);
        return { isDuplicate: false };
    }
}

// 실시간 중복 체크 및 검증
function setupPublicationIdValidation() {
    const publicationIdInput = document.getElementById('publicationId');
    if (!publicationIdInput) return;
    
    // 기존 검증 요소 제거
    const existingValidation = document.querySelector('.publication-id-validation');
    if (existingValidation) {
        existingValidation.remove();
    }
    
    let validationTimeout;
    
    publicationIdInput.addEventListener('input', function() {
        clearTimeout(validationTimeout);
        
        const value = this.value.trim();
        let validationElement = document.querySelector('.publication-id-validation');
        
        if (!validationElement) {
            validationElement = document.createElement('div');
            validationElement.className = 'publication-id-validation';
            validationElement.style.cssText = `
                font-size: 12px;
                margin-top: 6px;
                padding: 8px 12px;
                border-radius: 6px;
                transition: all 0.3s ease;
                animation: fadeIn 0.3s ease;
            `;
            this.parentNode.appendChild(validationElement);
        }
        
        if (!value) {
            validationElement.style.display = 'none';
            return;
        }
        
        // P 형식 검증
        const isValidFormat = /^P\d+$/i.test(value);
        
        if (!isValidFormat) {
            validationElement.style.display = 'block';
            validationElement.style.background = '#fff3cd';
            validationElement.style.color = '#856404';
            validationElement.style.borderLeft = '4px solid #ffc107';
            validationElement.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                올바른 형식: P + 숫자 (예: P179)
            `;
            return;
        }
        
        // 중복 체크 (디바운싱 적용)
        validationTimeout = setTimeout(async () => {
            try {
                const result = await checkDuplicatePublicationId(value);
                
                if (result.isDuplicate) {
                    validationElement.style.display = 'block';
                    validationElement.style.background = '#f8d7da';
                    validationElement.style.color = '#721c24';
                    validationElement.style.borderLeft = '4px solid #dc3545';
                    validationElement.innerHTML = `
                        <i class="fas fa-times-circle"></i>
                        이미 사용 중인 번호입니다 (${result.type.toUpperCase()}: ${result.title.substring(0, 30)}...)
                    `;
                } else {
                    validationElement.style.display = 'block';
                    validationElement.style.background = '#d4edda';
                    validationElement.style.color = '#155724';
                    validationElement.style.borderLeft = '4px solid #28a745';
                    validationElement.innerHTML = `
                        <i class="fas fa-check-circle"></i>
                        사용 가능한 번호입니다
                    `;
                }
            } catch (error) {
                console.error('❌ 실시간 검증 실패:', error);
            }
        }, 500); // 500ms 후 검증 실행
    });
    
    console.log('✅ 논문 번호 실시간 검증 설정 완료');
}

// ==================== 새로운 위치 삽입 시스템 ====================

// 모든 논문을 정렬된 배열로 가져오기
async function getAllPublicationsSorted(publicationType) {
    try {
        const refPath = `publications/${publicationType}`;
        const ref = database.ref(refPath);
        const snapshot = await ref.once('value');
        const data = snapshot.val() || {};
        
        const publications = Object.entries(data)
            .filter(([key, value]) => value && value.title)
            .map(([key, value]) => ({
                key,
                ...value
            }))
            .sort((a, b) => {
                // publicationId 숫자 기준 내림차순 정렬
                const idA = parseInt(a.publicationId.replace(/[^\d]/g, ''), 10);
                const idB = parseInt(b.publicationId.replace(/[^\d]/g, ''), 10);
                return idB - idA;
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
            percentile: (publicationData.percentile === '' || publicationData.percentile == null) ? '' : Number(publicationData.percentile),
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
    const pctVal = (publication.percentile === '' || publication.percentile == null) ? '' : publication.percentile;
    li.setAttribute('data-percentile', pctVal);

    const deleteId = publication.firebaseKey || publication.id;

    // URL 링크 처리
    const titleContent = publication.url ?
        `<a href="${publication.url}" target="_blank"><strong>${publication.title}</strong></a>` :
        `<strong>${publication.title}</strong>`;

    // 수상 내역 처리
    const awardContent = publication.award ?
        ` - <span class="award">${publication.award}</span>` : '';
    // 주의: JIF 백분위는 공개 목록에 표시하지 않음 (data 속성으로만 보관 → 수정 폼/멤버 실적에서 사용)
    
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
function validateAndCleanPublication(publicationData) {
    const publicationId = (publicationData.publicationId || '').trim();
    const title = (publicationData.title || '').trim();
    const authors = (publicationData.authors || '').trim();
    const journal = (publicationData.journal || '').trim();
    const type = (publicationData.type || '').trim();

    if (!publicationId || !title || !authors || !journal || !type) {
        showAlert('논문 번호, 제목, 저자, 저널, 타입은 필수 입력 항목입니다.', 'error');
        return null;
    }

    const pctRaw = publicationData.percentile;
    const percentile = (pctRaw === '' || pctRaw == null) ? '' : Number(pctRaw);
    return {
        ...publicationData,
        publicationId: publicationId,
        title: title,
        authors: authors,
        journal: journal,
        url: (publicationData.url || '').trim(),
        award: (publicationData.award || '').trim(),
        percentile: percentile,
        type: type
    };
}

async function addPublicationToRealtimeDB(publicationData) {
    if (!database) {
        showAlert('데이터베이스가 초기화되지 않았습니다.', 'error');
        return;
    }
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'warning');
        return;
    }

    const cleaned = validateAndCleanPublication(publicationData);
    if (!cleaned) return;
    publicationData = cleaned;

    if (isMutatingPublication) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }
    isMutatingPublication = true;

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
                percentile: (publicationData.percentile === '' || publicationData.percentile == null) ? '' : Number(publicationData.percentile),
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
    } finally {
        isMutatingPublication = false;
    }
}

// 논문 삭제
window.deleteFirebasePublication = async function(publicationId, publicationType) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }

    if (!database) {
        showAlert('데이터베이스가 초기화되지 않았습니다.', 'error');
        return;
    }

    if (!publicationId || !publicationType) {
        showAlert('삭제할 논문 정보가 올바르지 않습니다.', 'error');
        return;
    }

    if (!confirm('정말로 이 논문을 삭제하시겠습니까?')) return;

    if (isMutatingPublication) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }
    isMutatingPublication = true;

    try {
        console.log('🗑️ 논문 삭제 시도:', publicationId, publicationType);

        const refPath = `publications/${publicationType}/${publicationId}`;

        // 데이터베이스에서 논문 삭제
        await database.ref(refPath).remove();

        showAlert('논문이 삭제되었습니다.', 'success');

        // DOM에서도 제거
        const publicationElement = document.querySelector(`[data-firebase-key="${publicationId}"]`);
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
    } finally {
        isMutatingPublication = false;
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
    const pctEl = document.getElementById('editPublicationPercentile');
    if (pctEl) { const dp = publicationElement.getAttribute('data-percentile'); pctEl.value = (dp == null || dp === '') ? '' : dp; }
    
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

    if (!database) {
        showAlert('데이터베이스가 초기화되지 않았습니다.', 'error');
        return;
    }
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'warning');
        return;
    }

    const formData = new FormData(publicationEditForm);
    const newPublicationData = {
        publicationId: (formData.get('editPublicationId') || '').trim(),
        title: (formData.get('editPublicationTitle') || '').trim(),
        authors: (formData.get('editPublicationAuthors') || '').trim(),
        journal: (formData.get('editPublicationJournal') || '').trim(),
        url: (formData.get('editPublicationUrl') || '').trim(),
        award: (formData.get('editPublicationAward') || '').trim(),
        percentile: ((formData.get('editPublicationPercentile') || '') === '') ? '' : Number(formData.get('editPublicationPercentile')),
        type: (formData.get('editPublicationType') || '').trim()
    };

    const oldType = (formData.get('editPublicationCurrentType') || '').trim();
    const newType = newPublicationData.type;
    const firebaseKey = (formData.get('editPublicationKey') || '').trim();

    if (!firebaseKey) {
        showAlert('수정할 논문의 식별자를 찾을 수 없습니다.', 'error');
        return;
    }

    // 필수 항목 검증 (빈/공백 저장 방지)
    if (!newPublicationData.publicationId || !newPublicationData.title ||
        !newPublicationData.authors || !newPublicationData.journal || !newType) {
        showAlert('논문 번호, 제목, 저자, 저널, 타입은 필수 입력 항목입니다.', 'error');
        return;
    }

    // 논문 번호 형식 검증
    if (!/^P\d+$/i.test(newPublicationData.publicationId)) {
        showAlert('논문 번호는 P + 숫자 형식이어야 합니다 (예: P179)', 'error');
        return;
    }

    if (isMutatingPublication) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }
    isMutatingPublication = true;

    try {
        console.log('💾 논문 수정 시작');

        // 중복 체크 (자기 자신 제외)
        const duplicateCheck = await checkDuplicatePublicationId(newPublicationData.publicationId);
        if (duplicateCheck.isDuplicate) {
            // 자기 자신인지 확인
            const refPath = `publications/${duplicateCheck.type}`;
            const ref = database.ref(refPath);
            const snapshot = await ref.once('value');
            const data = snapshot.val() || {};
            
            const isSelf = Object.entries(data).some(([key, pub]) => 
                key === firebaseKey && pub.publicationId === newPublicationData.publicationId
            );
            
            if (!isSelf) {
                showAlert(`이미 사용 중인 논문 번호입니다: ${newPublicationData.publicationId}`, 'error');
                return;
            }
        }
        
        // 논문 업데이트
        if (oldType !== newType) {
            // 타입이 변경된 경우: 새 위치에 먼저 생성한 뒤 기존 위치에서 삭제 (데이터 손실 방지)
            const oldRefPath = `publications/${oldType}/${firebaseKey}`;

            const oldSnapshot = await database.ref(oldRefPath).once('value');
            const oldData = oldSnapshot.val();

            // 기존 논문이 더 이상 존재하지 않으면 중단
            if (!oldData) {
                showAlert('수정할 논문을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.', 'error');
                return;
            }

            const oldDisplayOrder = oldData.displayOrder !== undefined ? oldData.displayOrder : Date.now();

            const newRefPath = `publications/${newType}`;
            await database.ref(newRefPath).push({
                ...newPublicationData,
                displayOrder: oldDisplayOrder,
                createdAt: oldData.createdAt || Date.now()
            });

            // 새 위치 생성이 성공한 뒤에만 기존 논문 삭제
            await database.ref(oldRefPath).remove();
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
    } finally {
        isMutatingPublication = false;
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

    // 논문 관리 - 개선된 버전 (논문 번호 자동 제안 포함)
    if (addPublicationBtn) {
        addPublicationBtn.addEventListener('click', async () => {
            if (editPublicationForm && editPublicationForm.style.display === 'block') {
                editPublicationForm.style.display = 'none';
                currentEditingPublication = null;
            }
            if (addPublicationForm) {
                const isVisible = addPublicationForm.style.display === 'block';
                addPublicationForm.style.display = isVisible ? 'none' : 'block';
                
                // 폼이 열릴 때 번호 제안 및 위치 옵션 업데이트
                if (!isVisible) {
                    await updatePublicationIdSuggestion();
                    await updatePositionOptions();
                    setupPublicationIdValidation();
                }
            }
        });
    }
    
    if (cancelAddPublication) {
        cancelAddPublication.addEventListener('click', () => {
            if (addPublicationForm) addPublicationForm.style.display = 'none';
            if (publicationForm) publicationForm.reset();
            resetPositionFields();
            
            // 검증 메시지들 제거
            const validationElement = document.querySelector('.publication-id-validation');
            if (validationElement) {
                validationElement.remove();
            }
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
            const publicationId = formData.get('publicationId');
            
            // 논문 번호 형식 검증
            if (!/^P\d+$/i.test(publicationId)) {
                showAlert('논문 번호는 P + 숫자 형식이어야 합니다 (예: P179)', 'error');
                return;
            }
            
            // 중복 체크
            const duplicateCheck = await checkDuplicatePublicationId(publicationId);
            if (duplicateCheck.isDuplicate) {
                showAlert(`이미 사용 중인 논문 번호입니다: ${publicationId} (${duplicateCheck.type.toUpperCase()}: ${duplicateCheck.title})`, 'error');
                return;
            }
            
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
                publicationId: publicationId,
                title: formData.get('publicationTitle'),
                authors: formData.get('publicationAuthors'),
                journal: formData.get('publicationJournal'),
                url: formData.get('publicationUrl') || '',
                award: formData.get('publicationAward') || '',
                percentile: formData.get('publicationPercentile') || '',
                type: formData.get('publicationType'),
                insertPosition: insertPosition,
                specificPosition: specificPosition
            };
            
            console.log('📝 논문 추가 요청:', publicationData);
            
            await addPublicationToRealtimeDB(publicationData);
            if (addPublicationForm) addPublicationForm.style.display = 'none';
            if (publicationForm) publicationForm.reset();
            resetPositionFields();
            
            // 검증 메시지 제거
            const validationElement = document.querySelector('.publication-id-validation');
            if (validationElement) {
                validationElement.remove();
            }
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
    console.log('🚀 논문 번호 자동 제안 기능이 포함된 개선된 논문 관리 시스템 시작');
    
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

// 논문 번호 제안 시스템 테스트 함수
window.testPublicationNumberSystem = async function() {
    console.log('🧪 논문 번호 제안 시스템 테스트');
    
    const highestNumber = await getHighestPublicationNumber();
    const suggestedNumber = await suggestNextPublicationNumber();
    
    console.log('📊 현재 가장 높은 번호:', highestNumber);
    console.log('💡 제안 번호:', suggestedNumber);
    
    // 중복 체크 테스트
    const duplicateTest = await checkDuplicatePublicationId('P1');
    console.log('🔍 P1 중복 체크:', duplicateTest);
    
    showAlert(`테스트 완료: 현재 최고 번호 ${highestNumber}, 제안 번호 ${suggestedNumber}`, 'success');
};

// CSS 애니메이션 추가
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            opacity: 0;
            transform: translateX(100px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
    
    @keyframes slideInDown {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }
    
    .auto-fill-btn:hover {
        transform: translateY(-1px);
    }
    
    .auto-fill-btn:active {
        transform: translateY(0);
    }
    
    .publication-id-help {
        animation: slideInDown 0.3s ease;
    }
    
    .publication-id-validation {
        animation: fadeIn 0.3s ease;
    }
`;
document.head.appendChild(style);

console.log('🎯 논문 번호 자동 제안 기능이 포함된 publications.js 로드 완료');