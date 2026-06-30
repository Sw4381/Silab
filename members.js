// members.js - Firebase Realtime Database 기반 멤버 관리
// 설정값은 config.js 참조

// ==================== 전역 변수 ====================
let auth, database;
let currentUser = null;
let editMode = false;
let deleteMode = false;
let editingKey = null;
let editingSection = null;
let editingAlumniKey = null;
let isMutatingMember = false; // 추가/수정/삭제 동시 실행·더블 클릭 방지 가드

// ==================== DOM 요소 ====================
let loginBtn, logoutBtn, loginModal, loginClose, loginForm;
let userInfo, userName, adminPanel;
let addStudentBtn, addAlumniBtn, editProfessorBtn, memberEditModeBtn, memberDeleteModeBtn;
let memberModal, memberForm, memberModalClose, memberModalTitle;
let alumniModal, alumniForm, alumniModalClose;
let professorModal, professorForm, professorModalClose;

// ==================== showAlert ====================
function showAlert(message, type) {
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.textContent = message;
    alert.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 2000; max-width: 400px;
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
async function uploadMemberPhoto(file, onProgress) {
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) file = await compressImage(file);

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

// ==================== 교수님 로드/렌더/저장 ====================
async function loadAndRenderProfessor() {
    if (!database) return;
    try {
        const snap = await database.ref('members/professor').once('value');
        const data = snap.val();
        if (data) {
            renderProfessorSection(data);
        }
    } catch (e) {
        console.error('교수님 정보 로드 실패:', e);
    }
}

function renderProfessorSection(p) {
    const section = document.getElementById('professor-section');
    if (!section) return;
    section.innerHTML = `
        <h2 class="professor-title section-title">Professor</h2>
        <div class="professor-content">
            <div class="professor-card">
                <img src="${p.photo || './members_img/tjlee.jpg'}" alt="Professor Photo" onerror="this.src='./members_img/tjlee.jpg'">
                <h3>${escHtml(p.name)}</h3>
                <p><strong>${escHtml(p.title)}</strong></p>
                <p><strong>${escHtml(p.department)}</strong></p>
                <p><strong>${escHtml(p.university)}</strong></p>
            </div>
            <div class="professor-history">
                <h3><i class="fas fa-graduation-cap"></i> Academic Background & Experience</h3>
                <div class="bio-details">
                    <p class="full-bio text-box">${(p.bio || '').replace(/\n/g, '<br>')}</p>
                </div>
                <hr>
                <h3><i class="fas fa-flask"></i> Research Focus</h3>
                <p class="research-desc text-box">
                    <strong>${(p.research || '').replace(/\n/g, '<br>')}</strong>
                </p>
            </div>
        </div>
    `;
}

function openProfessorModal() {
    database.ref('members/professor').once('value').then(snap => {
        const p = snap.val() || {};
        document.getElementById('profName').value = p.name || '';
        document.getElementById('profTitle').value = p.title || '';
        document.getElementById('profEmail').value = p.email || '';
        document.getElementById('profDept').value = p.department || '';
        document.getElementById('profUniv').value = p.university || '';
        document.getElementById('profBio').value = p.bio || '';
        document.getElementById('profResearch').value = p.research || '';
        document.getElementById('profPhoto').value = '';
        const preview = document.getElementById('profPhotoPreview');
        if (preview) preview.innerHTML = p.photo
            ? `<img src="${p.photo}" style="max-width:100px;max-height:100px;border-radius:8px;border:2px solid #4facfe;" onerror="this.style.display='none'">`
            : '';
        if (professorModal) professorModal.style.display = 'block';
    });
}

async function saveProfessor(e) {
    e.preventDefault();
    // --- 사전 검증 (await 이전에 동기적으로 처리하여 더블 클릭을 확실히 차단) ---
    if (!database) { showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error'); return; }
    if (!currentUser) { showAlert('로그인이 필요합니다.', 'error'); return; }
    if (isMutatingMember) { showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning'); return; }

    const profName = document.getElementById('profName').value.trim();
    if (!profName) { showAlert('교수님 성함을 입력해주세요.', 'warning'); return; }

    const saveBtn = document.getElementById('profSaveBtn');
    if (saveBtn) saveBtn.disabled = true;

    isMutatingMember = true;
    try {
        const photoFile = document.getElementById('profPhoto').files[0];
        const snap = await database.ref('members/professor').once('value');
        const existing = snap.val() || {};
        let photoUrl = existing.photo || '';

        if (photoFile) {
            const progressBar = document.getElementById('profProgressBar');
            const progressWrap = document.getElementById('profUploadProgress');
            if (progressWrap) progressWrap.style.display = 'block';
            photoUrl = await uploadMemberPhoto(photoFile, pct => {
                if (progressBar) progressBar.style.width = pct + '%';
            });
            if (progressWrap) progressWrap.style.display = 'none';
        }

        const data = {
            name: profName,
            title: document.getElementById('profTitle').value.trim(),
            email: document.getElementById('profEmail').value.trim(),
            department: document.getElementById('profDept').value.trim(),
            university: document.getElementById('profUniv').value.trim(),
            bio: document.getElementById('profBio').value.trim(),
            research: document.getElementById('profResearch').value.trim(),
            photo: photoUrl
        };

        await database.ref('members/professor').set(data);
        showAlert('교수님 정보가 수정되었습니다.', 'success');
        if (professorModal) professorModal.style.display = 'none';
        renderProfessorSection(data);
    } catch (error) {
        showAlert('저장 실패: ' + error.message, 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
        isMutatingMember = false;
    }
}

// ==================== 데이터 로드 및 렌더링 ====================
async function loadAndRenderMembers() {
    if (!database) return;
    // 로딩 스켈레톤 표시
    ['phd-list', 'ms-list', 'bs-list', 'parttime-list'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = [1,2].map(() => `
                <div class="skeleton-card" style="display:flex;gap:20px;margin-bottom:20px;border-radius:16px;">
                    <div class="skeleton" style="width:110px;height:120px;border-radius:50%;flex-shrink:0;"></div>
                    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:10px;">
                        <div class="skeleton skeleton-line short" style="height:20px;"></div>
                        <div class="skeleton skeleton-line medium"></div>
                        <div class="skeleton skeleton-line full"></div>
                    </div>
                </div>
            `).join('');
        }
    });
    try {
        const snapshot = await database.ref('members').once('value');
        const data = snapshot.val();
        renderAllSections(data || {});
    } catch (error) {
        console.error('멤버 로드 실패:', error);
        showAlert('멤버 데이터 로드 실패: ' + error.message, 'error');
    }
}

function renderAllSections(data) {
    renderStudentSection('phd', data.phd || {});
    renderStudentSection('ms', data.ms || {});
    renderStudentSection('bs', data.bs || {});
    renderStudentSection('parttime', data.parttime || {});
    renderAlumniSection(data.alumni || {});
}

function renderStudentSection(section, members) {
    const container = document.getElementById(`${section}-list`);
    if (!container) return;
    container.innerHTML = '';

    const sorted = Object.entries(members)
        .sort(([, a], [, b]) => (a.order || 0) - (b.order || 0));

    if (sorted.length === 0) {
        const sectionLabels = { phd: '박사과정', ms: '석사과정', bs: '학부생', parttime: '파트타임' };
        container.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <i class="fas fa-user-graduate"></i>
                <h3>${sectionLabels[section] || '구성원'}이 없습니다</h3>
                <p>관리자가 로그인하여 구성원을 추가할 수 있습니다.</p>
            </div>`;
        return;
    }

    sorted.forEach(([key, member]) => {
        container.appendChild(createStudentCard(section, key, member));
    });
}

function createStudentCard(section, key, member) {
    const div = document.createElement('div');
    div.className = 'student-item';
    div.setAttribute('data-key', key);
    div.setAttribute('data-section', section);

    const photoSrc = member.photo || './members_img/f4.png';

    const showActions = currentUser && (editMode || deleteMode);
    const showEdit = currentUser && editMode;
    const showDelete = currentUser && deleteMode;

    div.innerHTML = `
        <img src="${escHtml(photoSrc)}" class="student-photo" alt="${escHtml(member.name)}" loading="lazy" onerror="this.src='./members_img/f4.png'">
        <div class="student-info">
            <div class="student-name">${escHtml(member.name)}</div>
            <div class="student-details">
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-id-badge"></i> 직책</span>
                    <span class="detail-value">${escHtml(member.role)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-flask"></i> 연구분야</span>
                    <span class="detail-value Re">${escHtml(member.research)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label"><i class="fas fa-graduation-cap"></i> 학위</span>
                    <span class="detail-value degree">${escHtml(member.degree)}</span>
                </div>
            </div>
            <div class="member-actions" style="display:${showActions ? 'flex' : 'none'}; gap:8px; margin-top:12px; flex-wrap:wrap;">
                <button class="admin-btn edit" style="display:${showEdit ? 'flex' : 'none'}; padding:6px 12px; font-size:0.85em;" onclick="openEditModal('${section}', '${key}')">
                    <i class="fas fa-edit"></i> 수정
                </button>
                <button class="admin-btn delete" style="display:${showDelete ? 'flex' : 'none'}; padding:6px 12px; font-size:0.85em;" onclick="deleteMember('${section}', '${key}')">
                    <i class="fas fa-trash"></i> 삭제
                </button>
            </div>
        </div>
    `;
    return div;
}

function renderAlumniSection(alumni) {
    const container = document.getElementById('alumni-list');
    if (!container) return;
    container.innerHTML = '';

    const sorted = Object.entries(alumni)
        .sort(([, a], [, b]) => {
            const aYear = a.period ? parseInt(a.period.replace(/[^0-9]/g, '').substring(0, 4)) : 0;
            const bYear = b.period ? parseInt(b.period.replace(/[^0-9]/g, '').substring(0, 4)) : 0;
            return bYear - aYear;
        });

    sorted.forEach(([key, alum]) => {
        const p = document.createElement('p');
        p.className = 'alumni-entry';
        p.setAttribute('data-key', key);

        const showDelete = currentUser && deleteMode;
        const deleteBtn = showDelete
            ? `<button class="admin-btn delete" style="padding:4px 10px; font-size:0.8em; margin-left:auto; flex-shrink:0;" onclick="deleteAlumni('${key}')"><i class="fas fa-trash"></i> 삭제</button>`
            : '';

        const editBtn = currentUser && editMode
            ? `<button class="admin-btn edit" style="padding:4px 10px; font-size:0.8em; flex-shrink:0;" onclick="openEditAlumniModal('${key}')"><i class="fas fa-edit"></i> 수정</button>`
            : '';

        p.innerHTML = `
            <span class="alumni-name">${escHtml(alum.name)}</span>
            <span class="alumni-year">${escHtml(alum.period)}</span>
            <span class="alumni-info">, ${escHtml(alum.info)}</span>
            ${editBtn}${deleteBtn}
        `;
        container.appendChild(p);
    });
}

// ==================== 인증 관련 ====================
async function loginUser(email, password) {
    if (ADMIN_EMAILS.indexOf(email) < 0) {
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
    const contentSection = document.querySelector('.content-section');
    if (currentUser) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'flex';
        if (userInfo) userInfo.style.display = 'flex';
        if (userName) userName.textContent = currentUser.email;
        if (adminPanel) adminPanel.style.display = 'block';
        if (contentSection) contentSection.style.paddingTop = '40px';
    } else {
        if (loginBtn) loginBtn.style.display = 'flex';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (userInfo) userInfo.style.display = 'none';
        if (adminPanel) adminPanel.style.display = 'none';
        if (contentSection) contentSection.style.paddingTop = '10px';
        editMode = false;
        deleteMode = false;
        if (memberEditModeBtn) memberEditModeBtn.classList.remove('active');
        if (memberDeleteModeBtn) memberDeleteModeBtn.classList.remove('active');
    }
    updateMemberButtons();
}

function updateMemberButtons() {
    // 현재 렌더링된 모든 member-actions와 버튼 업데이트
    document.querySelectorAll('.member-actions').forEach(el => {
        el.style.display = (currentUser && (editMode || deleteMode)) ? 'flex' : 'none';
    });
    document.querySelectorAll('.member-actions .admin-btn.edit').forEach(btn => {
        btn.style.display = (currentUser && editMode) ? 'flex' : 'none';
    });
    document.querySelectorAll('.member-actions .admin-btn.delete').forEach(btn => {
        btn.style.display = (currentUser && deleteMode) ? 'flex' : 'none';
    });
}

// ==================== 모달 열기/닫기 ====================
window.openEditModal = function(section, key) {
    if (!currentUser || !editMode) {
        showAlert('수정 모드를 활성화해주세요.', 'warning');
        return;
    }
    database.ref(`members/${section}/${key}`).once('value').then(snap => {
        const member = snap.val();
        if (!member) return;
        openMemberModal('edit', section, key, member);
    });
};

function openMemberModal(mode, section, key, member) {
    editingKey = key || null;
    editingSection = section || null;

    if (memberModalTitle) memberModalTitle.textContent = mode === 'edit' ? '멤버 수정' : '멤버 추가';

    document.getElementById('memberSection').value = section || 'phd';
    document.getElementById('memberName').value = member ? member.name || '' : '';
    document.getElementById('memberRole').value = member ? member.role || '' : '';
    document.getElementById('memberEmail').value = member ? member.email || '' : '';
    document.getElementById('memberResearch').value = member ? member.research || '' : '';
    document.getElementById('memberDegree').value = member ? member.degree || '' : '';
    document.getElementById('memberPhoto').value = '';

    const preview = document.getElementById('memberPhotoPreview');
    if (preview) {
        preview.innerHTML = member && member.photo
            ? `<img src="${member.photo}" style="max-width:100px; max-height:100px; border-radius:8px; border:2px solid #4facfe;" onerror="this.style.display='none'">`
            : '';
    }

    if (memberModal) memberModal.style.display = 'block';
}

function closeModal() {
    if (memberModal) memberModal.style.display = 'none';
    if (memberForm) memberForm.reset();
    const preview = document.getElementById('memberPhotoPreview');
    if (preview) preview.innerHTML = '';
    editingKey = null;
    editingSection = null;
}

function closeAlumniModal() {
    if (alumniModal) alumniModal.style.display = 'none';
    if (alumniForm) alumniForm.reset();
    editingAlumniKey = null;
}

window.openEditAlumniModal = function(key) {
    if (!currentUser || !editMode) {
        showAlert('수정 모드를 활성화해주세요.', 'warning');
        return;
    }
    database.ref(`members/alumni/${key}`).once('value').then(snap => {
        const alum = snap.val();
        if (!alum) return;
        editingAlumniKey = key;
        const title = document.getElementById('alumniModalTitle');
        if (title) title.textContent = '졸업생 수정';
        document.getElementById('alumniName').value = alum.name || '';
        document.getElementById('alumniPeriod').value = alum.period || '';
        document.getElementById('alumniInfo').value = alum.info || '';
        if (alumniModal) alumniModal.style.display = 'block';
    });
};

// ==================== CRUD ====================
async function saveMember(e) {
    e.preventDefault();
    // --- 사전 검증 (await 이전에 동기적으로 처리하여 더블 클릭을 확실히 차단) ---
    if (!database) {
        showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'error');
        return;
    }
    if (isMutatingMember) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }

    const section = document.getElementById('memberSection').value;
    const name = document.getElementById('memberName').value.trim();
    const role = document.getElementById('memberRole').value.trim();
    const email = document.getElementById('memberEmail').value.trim();
    const research = document.getElementById('memberResearch').value.trim();
    const degree = document.getElementById('memberDegree').value.trim();
    const photoFile = document.getElementById('memberPhoto').files[0];

    if (!name) {
        showAlert('이름을 입력해주세요.', 'warning');
        return;
    }

    const saveBtn = document.getElementById('memberSaveBtn');
    if (saveBtn) saveBtn.disabled = true;

    isMutatingMember = true;
    try {
        let photoUrl = '';

        // 기존 사진 유지 (수정 모드)
        if (editingKey && editingSection) {
            const snap = await database.ref(`members/${editingSection}/${editingKey}`).once('value');
            const existing = snap.val();
            photoUrl = existing ? existing.photo || '' : '';
        }

        // 새 사진 업로드
        if (photoFile) {
            const progressBar = document.getElementById('memberProgressBar');
            const progressContainer = document.getElementById('memberUploadProgress');
            if (progressContainer) progressContainer.style.display = 'block';

            photoUrl = await uploadMemberPhoto(photoFile, (pct) => {
                if (progressBar) progressBar.style.width = pct + '%';
            });

            if (progressContainer) progressContainer.style.display = 'none';
        }

        // order 계산
        let order = 1;
        const sectionChanged = editingKey && editingSection && editingSection !== section;

        if (!editingKey) {
            // 신규 추가: 대상 섹션의 마지막 order
            const snap = await database.ref(`members/${section}`).once('value');
            const existing = snap.val();
            if (existing) {
                const maxOrder = Math.max(...Object.values(existing).map(m => m.order || 0));
                order = maxOrder + 1;
            }
        } else if (sectionChanged) {
            // 섹션 이동: 이동할 섹션의 마지막 order
            const snap = await database.ref(`members/${section}`).once('value');
            const existing = snap.val();
            if (existing) {
                const maxOrder = Math.max(...Object.values(existing).map(m => m.order || 0));
                order = maxOrder + 1;
            }
        } else {
            // 같은 섹션 내 수정: 기존 order 유지
            const snap = await database.ref(`members/${editingSection}/${editingKey}`).once('value');
            const existing = snap.val();
            order = existing ? existing.order || 1 : 1;
        }

        const data = { name, role, email, research, degree, photo: photoUrl, order };

        if (editingKey && editingSection) {
            if (sectionChanged) {
                // 이동 전 기존 항목 존재 확인 (이미 삭제된 경우 유령 항목 생성 방지)
                const oldSnap = await database.ref(`members/${editingSection}/${editingKey}`).once('value');
                if (!oldSnap.exists()) {
                    throw new Error('기존 멤버를 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.');
                }
                // 데이터 유실 방지: 새 섹션에 먼저 추가한 뒤 기존 섹션에서 삭제
                await database.ref(`members/${section}`).push(data);
                await database.ref(`members/${editingSection}/${editingKey}`).remove();
                showAlert(`섹션이 이동되었습니다. (${editingSection} → ${section})`, 'success');
            } else {
                await database.ref(`members/${editingSection}/${editingKey}`).update(data);
                showAlert('멤버 정보가 수정되었습니다.', 'success');
            }
        } else {
            await database.ref(`members/${section}`).push(data);
            showAlert('멤버가 추가되었습니다.', 'success');
        }

        closeModal();
        await loadAndRenderMembers();
    } catch (error) {
        console.error('저장 실패:', error);
        showAlert('저장 실패: ' + error.message, 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
        isMutatingMember = false;
    }
}

window.deleteMember = async function(section, key) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    if (!database) {
        showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }
    if (!section || !key) {
        showAlert('삭제할 멤버 식별자가 없습니다.', 'error');
        return;
    }
    if (isMutatingMember) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }
    if (!confirm('이 멤버를 삭제하시겠습니까?')) return;
    isMutatingMember = true;
    try {
        await database.ref(`members/${section}/${key}`).remove();
        showAlert('멤버가 삭제되었습니다.', 'success');
        await loadAndRenderMembers();
    } catch (error) {
        showAlert('삭제 실패: ' + error.message, 'error');
    } finally {
        isMutatingMember = false;
    }
};

async function saveAlumni(e) {
    e.preventDefault();
    // --- 사전 검증 (await 이전에 동기적으로 처리하여 더블 클릭을 확실히 차단) ---
    if (!database) {
        showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }
    if (!currentUser) {
        showAlert('로그인이 필요합니다.', 'error');
        return;
    }
    if (isMutatingMember) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }

    const name = document.getElementById('alumniName').value.trim();
    const period = document.getElementById('alumniPeriod').value.trim();
    const info = document.getElementById('alumniInfo').value.trim();

    if (!name) {
        showAlert('졸업생 이름을 입력해주세요.', 'warning');
        return;
    }

    const data = { name, period, info };

    isMutatingMember = true;
    try {
        if (editingAlumniKey) {
            await database.ref(`members/alumni/${editingAlumniKey}`).update(data);
            showAlert('졸업생 정보가 수정되었습니다.', 'success');
        } else {
            await database.ref('members/alumni').push(data);
            showAlert('졸업생이 추가되었습니다.', 'success');
        }
        closeAlumniModal();
        await loadAndRenderMembers();
    } catch (error) {
        showAlert('저장 실패: ' + error.message, 'error');
    } finally {
        isMutatingMember = false;
    }
}

window.deleteAlumni = async function(key) {
    if (!currentUser || !deleteMode) {
        showAlert('삭제 모드가 활성화되지 않았거나 로그인이 필요합니다.', 'warning');
        return;
    }
    if (!database) {
        showAlert('데이터베이스가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.', 'error');
        return;
    }
    if (!key) {
        showAlert('삭제할 졸업생 식별자가 없습니다.', 'error');
        return;
    }
    if (isMutatingMember) {
        showAlert('이전 작업을 처리 중입니다. 잠시만 기다려주세요.', 'warning');
        return;
    }
    if (!confirm('이 졸업생을 삭제하시겠습니까?')) return;
    isMutatingMember = true;
    try {
        await database.ref(`members/alumni/${key}`).remove();
        showAlert('졸업생이 삭제되었습니다.', 'success');
        await loadAndRenderMembers();
    } catch (error) {
        showAlert('삭제 실패: ' + error.message, 'error');
    } finally {
        isMutatingMember = false;
    }
};

// ==================== 스크롤 애니메이션 ====================
function setupScrollAnimation() {
    const hiddenElements = document.querySelectorAll('.hidden');
    const handleScroll = () => {
        hiddenElements.forEach(el => {
            const top = el.getBoundingClientRect().top;
            if (top < window.innerHeight - 50) {
                el.classList.add('visible');
            } else {
                el.classList.remove('visible');
            }
        });
    };
    window.addEventListener('scroll', handleScroll);
    handleScroll();
}

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

    // 관리자 패널 버튼들
    if (addStudentBtn) {
        addStudentBtn.addEventListener('click', () => {
            openMemberModal('add', 'phd', null, null);
        });
    }

    if (addAlumniBtn) {
        addAlumniBtn.addEventListener('click', () => {
            editingAlumniKey = null;
            const title = document.getElementById('alumniModalTitle');
            if (title) title.textContent = '졸업생 추가';
            if (alumniForm) alumniForm.reset();
            if (alumniModal) alumniModal.style.display = 'block';
        });
    }

    if (memberEditModeBtn) {
        memberEditModeBtn.addEventListener('click', () => {
            editMode = !editMode;
            if (editMode) deleteMode = false;
            memberEditModeBtn.classList.toggle('active', editMode);
            if (memberDeleteModeBtn) memberDeleteModeBtn.classList.remove('active');
            loadAndRenderMembers();
        });
    }

    if (memberDeleteModeBtn) {
        memberDeleteModeBtn.addEventListener('click', () => {
            deleteMode = !deleteMode;
            if (deleteMode) editMode = false;
            memberDeleteModeBtn.classList.toggle('active', deleteMode);
            if (memberEditModeBtn) memberEditModeBtn.classList.remove('active');
            loadAndRenderMembers();
        });
    }

    // 멤버 모달 닫기
    if (memberModalClose) memberModalClose.addEventListener('click', closeModal);
    if (memberModal) {
        memberModal.addEventListener('click', (e) => {
            /* 편집 모달: 바깥 클릭 닫힘 비활성화 (입력 중 실수 닫힘 방지) */
        });
    }

    // 멤버 폼 제출
    if (memberForm) memberForm.addEventListener('submit', saveMember);

    // 사진 미리보기
    const photoInput = document.getElementById('memberPhoto');
    if (photoInput) {
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const preview = document.getElementById('memberPhotoPreview');
            if (file && preview) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    preview.innerHTML = `<img src="${ev.target.result}" style="max-width:100px; max-height:100px; border-radius:8px; border:2px solid #4facfe; margin-top:4px;">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // 졸업생 모달 닫기
    if (alumniModalClose) alumniModalClose.addEventListener('click', closeAlumniModal);
    if (alumniModal) {
        alumniModal.addEventListener('click', (e) => {
            /* 편집 모달: 바깥 클릭 닫힘 비활성화 (입력 중 실수 닫힘 방지) */
        });
    }

    // 졸업생 폼 제출
    if (alumniForm) alumniForm.addEventListener('submit', saveAlumni);

    // 교수님 수정 버튼
    if (editProfessorBtn) editProfessorBtn.addEventListener('click', openProfessorModal);
    if (professorModalClose) professorModalClose.addEventListener('click', () => {
        if (professorModal) professorModal.style.display = 'none';
    });
    if (professorModal) {
        professorModal.addEventListener('click', (e) => {
            /* 편집 모달: 바깥 클릭 닫힘 비활성화 (입력 중 실수 닫힘 방지) */
        });
    }
    if (professorForm) professorForm.addEventListener('submit', saveProfessor);

    // 교수님 사진 미리보기
    const profPhotoInput = document.getElementById('profPhoto');
    if (profPhotoInput) {
        profPhotoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            const preview = document.getElementById('profPhotoPreview');
            if (file && preview) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    preview.innerHTML = `<img src="${ev.target.result}" style="max-width:100px;max-height:100px;border-radius:8px;border:2px solid #4facfe;margin-top:4px;">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }
}

// ==================== DOMContentLoaded ====================
document.addEventListener('DOMContentLoaded', async () => {
    // DOM 요소 바인딩
    loginBtn = document.getElementById('loginBtn');
    logoutBtn = document.getElementById('logoutBtn');
    loginModal = document.getElementById('loginModal');
    loginClose = document.getElementById('loginClose');
    loginForm = document.getElementById('loginForm');
    userInfo = document.getElementById('userInfo');
    userName = document.getElementById('userName');
    adminPanel = document.getElementById('memberAdminPanel');
    addStudentBtn = document.getElementById('addStudentBtn');
    addAlumniBtn = document.getElementById('addAlumniBtn');
    editProfessorBtn = document.getElementById('editProfessorBtn');
    memberEditModeBtn = document.getElementById('memberEditModeBtn');
    memberDeleteModeBtn = document.getElementById('memberDeleteModeBtn');
    professorModal = document.getElementById('professorModal');
    professorForm = document.getElementById('professorForm');
    professorModalClose = document.getElementById('professorModalClose');
    memberModal = document.getElementById('memberModal');
    memberForm = document.getElementById('memberForm');
    memberModalClose = document.getElementById('memberModalClose');
    memberModalTitle = document.getElementById('memberModalTitle');
    alumniModal = document.getElementById('alumniModal');
    alumniForm = document.getElementById('alumniForm');
    alumniModalClose = document.getElementById('alumniModalClose');

    // Firebase 초기화
    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();

        auth.onAuthStateChanged(async (user) => {
            currentUser = user;
            updateAuthUI();
            await loadAndRenderProfessor();
            await loadAndRenderMembers();
        });
    } catch (error) {
        console.error('Firebase 초기화 실패:', error);
        showAlert('Firebase 초기화 실패: ' + error.message, 'error');
    }

    setupEventListeners();
    setupScrollAnimation();
});

// 애니메이션 스타일 추가
const memberStyle = document.createElement('style');
memberStyle.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(100px); }
        to   { opacity: 1; transform: translateX(0); }
    }
`;
document.head.appendChild(memberStyle);
