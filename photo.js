// photo.js - Patents와 Awards를 Firebase로 관리하는 JavaScript 파일

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
let currentEditingItem = null;

// ==================== 허용된 사용자 목록 ====================
const ALLOWED_USERS = ['kinjecs0@gmail.com'];

// ==================== DOM 요소들 ====================
let loginBtn, logoutBtn, loginModal, loginClose, loginForm;
let userInfo, userName, adminPanel;
let addPatentBtn, addAwardBtn;
let addPatentForm, addAwardForm;
let patentForm, awardForm;
let cancelAddPatent, cancelAddAward;
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
        console.log('🔄 Database에서 특허 로드 중...');
        
        const patentList = document.querySelector('.patent-list');
        if (!patentList) return;
        
        // Firebase 특허만 제거
        const dynamicItems = patentList.querySelectorAll('[data-firebase="true"]');
        dynamicItems.forEach(item => item.remove());
        
        // Firebase에서 특허 데이터 가져오기
        const ref = database.ref('patents');
        const snapshot = await ref.once('value');
        const data = snapshot.val() || {};
        
        console.log('📊 로드된 특허:', Object.keys(data).length, '개');
        
        // 번호순으로 정렬 (내림차순)
        const patents = Object.entries(data)
            .filter(([key, value]) => value && value.content)
            .map(([key, value]) => ({
                key,
                ...value
            }))
            .sort((a, b) => {
                const numA = parseInt(a.patentNumber.replace(/[^\d]/g, ''), 10);
                const numB = parseInt(b.patentNumber.replace(/[^\d]/g, ''), 10);
                return numB - numA;
            });
        
        // DOM에 특허 추가
        patents.forEach((patent, index) => {
            patent.id = `patent_${index}`;
            addPatentToDOM(patent);
        });
        
        console.log('✅ 특허 로드 완료');
        updateButtonsVisibility();
        
    } catch (error) {
        console.error('❌ 특허 로드 실패:', error);
        showAlert('특허 로드에 실패했습니다.', 'error');
    }
}

async function loadAwardsFromDatabase() {
    if (!database) return;
    
    try {
        console.log('🔄 Database에서 수상내역 로드 중...');
        
        const awardList = document.querySelector('.award-list');
        if (!awardList) return;
        
        // Firebase 수상내역만 제거
        const dynamicItems = awardList.querySelectorAll('[data-firebase="true"]');
        dynamicItems.forEach(item => item.remove());
        
        // Firebase에서 수상내역 데이터 가져오기
        const ref = database.ref('awards');
        const snapshot = await ref.once('value');
        const data = snapshot.val() || {};
        
        console.log('📊 로드된 수상내역:', Object.keys(data).length, '개');
        
        // 날짜순으로 정렬 (최신순)
        const awards = Object.entries(data)
            .filter(([key, value]) => value && value.content)
            .map(([key, value]) => ({
                key,
                ...value
            }))
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // DOM에 수상내역 추가
        awards.forEach((award, index) => {
            award.id = `award_${index}`;
            addAwardToDOM(award);
        });
        
        console.log('✅ 수상내역 로드 완료');
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
    
    // award highlight 처리
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

// ==================== 특허 추가/삭제/수정 ====================
async function addPatentToDatabase(patentData) {
    try {
        console.log('💾 특허 추가 시작:', patentData.patentNumber);
        
        const newPatent = {
            patentNumber: patentData.patentNumber,
            content: patentData.content,
            createdAt: Date.now()
        };
        
        const ref = database.ref('patents');
        await ref.push(newPatent);
        
        showAlert('특허가 성공적으로 추가되었습니다!', 'success');
        
        setTimeout(() => {
            loadPatentsFromDatabase();
        }, 1000);
        
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
        if (patentElement) {
            patentElement.remove();
        }
        
        setTimeout(() => {
            loadPatentsFromDatabase();
        }, 500);
        
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
    
    // content 추출: 전체 텍스트에서 patentNumber와 버튼 텍스트 제거
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
    
    // 하이라이트 필드 숨기기
    const highlightGroup = document.getElementById('editHighlightGroup');
    const patentNumberGroup = document.getElementById('editPatentNumberGroup');
    if (highlightGroup) highlightGroup.style.display = 'none';
    if (patentNumberGroup) patentNumberGroup.style.display = 'block';
    
    currentEditingItem = {
        id: patentId,
        firebaseKey: firebaseKey,
        type: 'patent'
    };
    
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
        console.log('💾 수상내역 추가 시작');
        
        const newAward = {
            content: awardData.content,
            highlight: awardData.highlight || '',
            date: awardData.date,
            createdAt: Date.now()
        };
        
        const ref = database.ref('awards');
        await ref.push(newAward);
        
        showAlert('수상내역이 성공적으로 추가되었습니다!', 'success');
        
        setTimeout(() => {
            loadAwardsFromDatabase();
        }, 1000);
        
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
        if (awardElement) {
            awardElement.remove();
        }
        
        setTimeout(() => {
            loadAwardsFromDatabase();
        }, 500);
        
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
    
    // 먼저 highlight 요소를 찾기
    const highlightElement = awardElement.querySelector('.award-highlight');
    const highlight = highlightElement ? highlightElement.textContent : '';
    
    // content 추출: 전체 텍스트에서 버튼 텍스트 제거
    const clonedElement = awardElement.cloneNode(true);
    const actionsDiv = clonedElement.querySelector('.item-actions');
    if (actionsDiv) actionsDiv.remove();
    
    let content = clonedElement.textContent.trim();
    
    const firebaseKey = awardElement.getAttribute('data-firebase-key') || awardId;
    
    document.getElementById('editItemKey').value = firebaseKey;
    document.getElementById('editItemType').value = 'award';
    document.getElementById('editItemContent').value = content;
    document.getElementById('editItemHighlight').value = highlight;
    
    // 특허 번호 필드 숨기기, 하이라이트 필드 표시
    const highlightGroup = document.getElementById('editHighlightGroup');
    const patentNumberGroup = document.getElementById('editPatentNumberGroup');
    if (patentNumberGroup) patentNumberGroup.style.display = 'none';
    if (highlightGroup) highlightGroup.style.display = 'block';
    
    currentEditingItem = {
        id: awardId,
        firebaseKey: firebaseKey,
        type: 'award'
    };
    
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
            
            setTimeout(() => {
                loadPatentsFromDatabase();
            }, 1000);
            
        } else if (itemType === 'award') {
            const updatedAward = {
                content: formData.get('editItemContent'),
                highlight: formData.get('editItemHighlight') || '',
                date: formData.get('editAwardDate') || new Date().toISOString().split('T')[0]
            };
            
            await database.ref(`awards/${firebaseKey}`).update(updatedAward);
            showAlert('수상내역이 성공적으로 수정되었습니다!', 'success');
            
            setTimeout(() => {
                loadAwardsFromDatabase();
            }, 1000);
        }
        
        if (editItemForm) editItemForm.style.display = 'none';
        if (itemEditForm) itemEditForm.reset();
        currentEditingItem = null;
        
    } catch (error) {
        console.error('❌ 수정 실패:', error);
        showAlert('수정 실패: ' + error.message, 'error');
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
        if (addPatentForm) addPatentForm.style.display = 'none';
        if (addAwardForm) addAwardForm.style.display = 'none';
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
    
    if (toggleEditMode) {
        toggleEditMode.classList.toggle('active', editMode);
    }
    
    if (toggleDeleteMode) {
        toggleDeleteMode.classList.toggle('active', deleteMode);
    }
}

// ==================== 이벤트 리스너 설정 ====================
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

    // 특허 관리
    if (addPatentBtn) {
        addPatentBtn.addEventListener('click', () => {
            if (editItemForm && editItemForm.style.display === 'block') {
                editItemForm.style.display = 'none';
                currentEditingItem = null;
            }
            if (addAwardForm && addAwardForm.style.display === 'block') {
                addAwardForm.style.display = 'none';
            }
            if (addPatentForm) {
                const isVisible = addPatentForm.style.display === 'block';
                addPatentForm.style.display = isVisible ? 'none' : 'block';
            }
        });
    }
    
    if (cancelAddPatent) {
        cancelAddPatent.addEventListener('click', () => {
            if (addPatentForm) addPatentForm.style.display = 'none';
            if (patentForm) patentForm.reset();
        });
    }
    
    if (patentForm) {
        patentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(patentForm);
            const patentData = {
                patentNumber: formData.get('patentNumber'),
                content: formData.get('patentContent')
            };
            
            await addPatentToDatabase(patentData);
            if (addPatentForm) addPatentForm.style.display = 'none';
            if (patentForm) patentForm.reset();
        });
    }
    
    // 수상내역 관리
    if (addAwardBtn) {
        addAwardBtn.addEventListener('click', () => {
            if (editItemForm && editItemForm.style.display === 'block') {
                editItemForm.style.display = 'none';
                currentEditingItem = null;
            }
            if (addPatentForm && addPatentForm.style.display === 'block') {
                addPatentForm.style.display = 'none';
            }
            if (addAwardForm) {
                const isVisible = addAwardForm.style.display === 'block';
                addAwardForm.style.display = isVisible ? 'none' : 'block';
            }
        });
    }
    
    if (cancelAddAward) {
        cancelAddAward.addEventListener('click', () => {
            if (addAwardForm) addAwardForm.style.display = 'none';
            if (awardForm) awardForm.reset();
        });
    }
    
    if (awardForm) {
        awardForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(awardForm);
            const awardData = {
                content: formData.get('awardContent'),
                highlight: formData.get('awardHighlight') || '',
                date: formData.get('awardDate')
            };
            
            await addAwardToDatabase(awardData);
            if (addAwardForm) addAwardForm.style.display = 'none';
            if (awardForm) awardForm.reset();
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
    
    // 수정 관련 이벤트
    if (cancelEditItem) {
        cancelEditItem.addEventListener('click', () => {
            if (editItemForm) editItemForm.style.display = 'none';
            if (itemEditForm) itemEditForm.reset();
            currentEditingItem = null;
            showAlert('수정이 취소되었습니다.', 'warning');
        });
    }
    
    if (itemEditForm) {
        itemEditForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await updateItem();
        });
    }
    
    // 모달 외부 클릭 시 닫기
    window.addEventListener('click', (e) => {
        if (loginModal && e.target === loginModal) {
            loginModal.style.display = 'none';
        }
    });
    
    console.log('✅ 이벤트 리스너 설정 완료');
}

// ==================== 기존 photo 기능들 ====================
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

function setupShowMoreButtons() {
    const showMorePatents = document.getElementById("show-more-patents");
    const showMoreAwards = document.getElementById("show-more-awards");
    
    if (showMorePatents) {
        showMorePatents.addEventListener("click", function() {
            const hiddenSection = this.parentElement.previousElementSibling;
            hiddenSection.classList.toggle("visible");
            
            if (hiddenSection.classList.contains("visible")) {
                this.querySelector("span").textContent = "특허 목록 접기";
                this.querySelector("i").classList.remove("fa-chevron-down");
                this.querySelector("i").classList.add("fa-chevron-up");
                this.parentElement.classList.add("active");
            } else {
                this.querySelector("span").textContent = "더 많은 특허 보기";
                this.querySelector("i").classList.remove("fa-chevron-up");
                this.querySelector("i").classList.add("fa-chevron-down");
                this.parentElement.classList.remove("active");
            }
        });
    }
    
    if (showMoreAwards) {
        showMoreAwards.addEventListener("click", function() {
            const hiddenSection = this.parentElement.previousElementSibling;
            hiddenSection.classList.toggle("visible");
            
            if (hiddenSection.classList.contains("visible")) {
                this.querySelector("span").textContent = "수상내역 접기";
                this.querySelector("i").classList.remove("fa-chevron-down");
                this.querySelector("i").classList.add("fa-chevron-up");
                this.parentElement.classList.add("active");
            } else {
                this.querySelector("span").textContent = "더 많은 수상내역 보기";
                this.querySelector("i").classList.remove("fa-chevron-up");
                this.querySelector("i").classList.add("fa-chevron-down");
                this.parentElement.classList.remove("active");
            }
        });
    }
}

function initPhotoModal() {
    console.log("모달 초기화 시작");
    
    const modal = document.getElementById('photoModal');
    if (!modal) {
        console.error("모달 요소를 찾을 수 없습니다!");
        return { attachPhotoClickEvents: () => {} };
    }
    
    const modalOverlay = modal.querySelector('.modal-overlay');
    const modalClose = document.getElementById('modalClose');
    const modalImage = modal.querySelector('.modal-image');
    const modalTitle = modal.querySelector('.modal-title');
    const dateText = modal.querySelector('.date-text');
    const categoryText = modal.querySelector('.category-text');
    const descriptionText = modal.querySelector('.description-text');
    const prevBtn = document.getElementById('prevPhoto');
    const nextBtn = document.getElementById('nextPhoto');
    
    let currentPhotoIndex = 0;
    let allPhotos = [];
    
    function openModal(photoItem, photoIndex) {
        currentPhotoIndex = photoIndex;
        
        const img = photoItem.querySelector('img');
        const titleElement = photoItem.querySelector('.photo-info h4');
        const dateElement = photoItem.querySelector('.photo-info p');
        const categoryElement = photoItem.querySelector('.photo-info .category');
        
        if (img && modalImage) {
            modalImage.src = img.src;
            modalImage.alt = img.alt || "사진";
        }
        
        if (titleElement && modalTitle) {
            modalTitle.textContent = titleElement.textContent;
        }
        
        if (dateElement && dateText) {
            dateText.textContent = dateElement.textContent;
        }
        
        if (categoryElement && categoryText) {
            categoryText.textContent = categoryElement.textContent;
        }
        
        if (descriptionText) {
            descriptionText.textContent = '---';
        }
        
        updateNavigationButtons();
        
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
    
    function closeModal() {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
    
    function updateNavigationButtons() {
        if (prevBtn) prevBtn.disabled = currentPhotoIndex === 0;
        if (nextBtn) nextBtn.disabled = currentPhotoIndex === allPhotos.length - 1;
    }
    
    function showPreviousPhoto() {
        if (currentPhotoIndex > 0) {
            const prevPhoto = allPhotos[currentPhotoIndex - 1];
            openModal(prevPhoto, currentPhotoIndex - 1);
        }
    }
    
    function showNextPhoto() {
        if (currentPhotoIndex < allPhotos.length - 1) {
            const nextPhoto = allPhotos[currentPhotoIndex + 1];
            openModal(nextPhoto, currentPhotoIndex + 1);
        }
    }
    
    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);
    if (modalClose) modalClose.addEventListener('click', closeModal);
    if (prevBtn) prevBtn.addEventListener('click', showPreviousPhoto);
    if (nextBtn) nextBtn.addEventListener('click', showNextPhoto);
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('show')) {
            closeModal();
        } else if (modal.classList.contains('show')) {
            if (e.key === 'ArrowLeft') showPreviousPhoto();
            if (e.key === 'ArrowRight') showNextPhoto();
        }
    });
    
    function attachPhotoClickEvents() {
        const photoItems = document.querySelectorAll('.photo-item');
        allPhotos = Array.from(photoItems);
        
        photoItems.forEach((item, index) => {
            item.replaceWith(item.cloneNode(true));
        });
        
        document.querySelectorAll('.photo-item').forEach((item, index) => {
            item.onclick = function() {
                openModal(this, index);
            };
            item.style.cursor = 'pointer';
        });
        
        allPhotos = Array.from(document.querySelectorAll('.photo-item'));
    }
    
    return { attachPhotoClickEvents };
}

function initPhotoBoard() {
    console.log("포토 게시판 초기화");
    const photoModal = initPhotoModal();
    photoModal.attachPhotoClickEvents();
}

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
                
                setTimeout(() => {
                    initPhotoBoard();
                }, 100);
                
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

// ==================== 메인 초기화 ====================
document.addEventListener("DOMContentLoaded", function() {
    console.log('🚀 Patents & Awards Firebase 관리 시스템 시작');
    
    // DOM 요소들 초기화
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
    addPatentForm = document.getElementById('addPatentForm');
    addAwardForm = document.getElementById('addAwardForm');
    patentForm = document.getElementById('patentForm');
    awardForm = document.getElementById('awardForm');
    cancelAddPatent = document.getElementById('cancelAddPatent');
    cancelAddAward = document.getElementById('cancelAddAward');
    toggleDeleteMode = document.getElementById('toggleDeleteMode');
    toggleEditMode = document.getElementById('toggleEditMode');
    editItemForm = document.getElementById('editItemForm');
    itemEditForm = document.getElementById('itemEditForm');
    cancelEditItem = document.getElementById('cancelEditItem');
    
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
        
        // 인증 상태 변화 리스너
        auth.onAuthStateChanged((user) => {
            currentUser = user;
            updateAuthUI();
            
            if (user) {
                console.log('✅ 사용자 로그인:', user.email);
            } else {
                console.log('ℹ️ 사용자 미로그인');
            }
            
            loadPatentsFromDatabase();
            loadAwardsFromDatabase();
        });
        
    } catch (error) {
        console.error('❌ Firebase 초기화 실패:', error);
        showAlert('Firebase 초기화 실패: ' + error.message, 'error');
    }
    
    // 이벤트 리스너들 설정
    setupEventListeners();
    
    // 기존 기능들
    setupScrollAnimation();
    setupShowMoreButtons();
    initSectionToggle();
    
    console.log('🎯 Patents & Awards 관리 시스템 로드 완료');
});

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
    
    .item-actions {
        display: inline-block;
        margin-left: 10px;
    }
    
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
    
    .edit-item-btn {
        background: #ffc107;
        color: #212529;
    }
    
    .edit-item-btn:hover {
        background: #e0a800;
    }
    
    .delete-item-btn {
        background: #dc3545;
        color: white;
    }
    
    .delete-item-btn:hover {
        background: #c82333;
    }
`;
document.head.appendChild(style);

console.log('🎯 photo.js 로드 완료');