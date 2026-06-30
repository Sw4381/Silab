// project.js - 논문 프로젝트(요약) 페이지
//  · 열람: 로그인 불필요 (누구나)
//  · 편집: 관리자 로그인 시에만 (Firebase Realtime DB 저장, Cloudinary 이미지 업로드)
//  · 본문은 '블록'(소제목/본문/목록/그림/결과수치)의 순서 배열 → 그림을 원하는 위치에 삽입 가능
//  설정값은 config.js 참조

// ==================== 전역 ====================
let auth, database;
let currentUser = null;
let isSaving = false;
let pageId = 'ttps';

// 블록 타입 메타 (라벨/아이콘)
const BLOCK_META = {
    heading: { label: '소제목', icon: 'fa-heading' },
    text:    { label: '본문',   icon: 'fa-align-left' },
    list:    { label: '목록',   icon: 'fa-list-ul' },
    figure:  { label: '그림',   icon: 'fa-image' },
    metrics: { label: '결과수치', icon: 'fa-chart-simple' }
};

// ==================== 기본(시드) 콘텐츠 ====================
// DB가 비어 있을 때 표시되는 기본값. 관리자가 편집·저장하면 DB 값이 우선한다.
const DEFAULT_CONTENT = {
    ttps: {
        venue: 'IEEE Access · 2025 (SCIE)',
        title: 'Enhancing Incident Response Through Effective TTPs Analysis: A Design Approach',
        authors: 'Tae-Hyun Han, Sang-Yeon Hwang, Tae-Jin Lee*',
        affil: '가천대학교 스마트보안학과 · 보안 지능 연구실(SILAB)  |  SecuLayer Inc.  |  *교신저자\n'
             + 'IEEE Access, vol. 13, pp. 217,799–217,810, 2025 · DOI: 10.1109/ACCESS.2025.3645226',
        paperUrl: 'https://doi.org/10.1109/ACCESS.2025.3645226',
        blocks: [
            { type: 'heading', text: '요약 (Summary)' },
            { type: 'text', text:
                '공격자의 의도를 이해하고 선제적으로 대응하기 위해서는 침해사고에서 나타나는 공격 패턴을 식별하고 정량화하는 것이 중요하지만, 이는 여전히 매우 어려운 과제이다. '
              + '본 논문은 실제 침해대응(Incident Response) 데이터를 기반으로 TTPs(Tactics, Techniques, and Procedures) 분석을 통한 지식 맵(knowledge map)을 구성하여, 공격 활동 간의 관계를 학습·정량화하는 설계 방법론을 제안한다.\n\n'
              + '임베딩(embedding) 모델로 공격 활동 사이의 관계를 도출·정량화하고, 이를 클러스터링으로 관리하여 공격자의 다음 행위를 예측한다. '
              + '공격 규칙을 명시적으로 정의하는 대신 실제 공격 데이터로부터 관계 구조를 직접 학습함으로써 동적인 TTP 조합 생성을 가능하게 하며, 탐지된 공격 패턴을 기존 방법론과 결합하여 진보된 공격 그룹 식별(attack-group identification) 프레임워크를 제시한다.' },
            { type: 'heading', text: '핵심 기여 (Contributions)' },
            { type: 'list', items: [
                '실제 침해대응 데이터에 기반해 TTPs를 분석하고, 기법 클러스터(technique cluster)와 공격 패턴 행렬(attack pattern matrix)로 구성된 지식 맵을 구축.',
                '임베딩 기반으로 공격 활동 간 관계를 정량화하여, 규칙을 명시적으로 정의하지 않고도 동적 TTP 조합과 공격자의 후속 행위 예측을 가능하게 함.',
                '탐지된 공격 패턴을 기존 방법론과 통합하여 공격 그룹 식별 프레임워크를 설계, 침해대응의 선제적·자동화 가능성을 제시.'
            ] },
            { type: 'heading', text: '제안 방법 (Proposed Approach)' },
            { type: 'text', text:
                '전체 설계는 (1) 침해대응 데이터로부터 공격 활동을 임베딩하고, (2) 기법 클러스터를 형성하여 공격 패턴 행렬을 구성한 뒤, (3) 이를 활용해 다음 행위 예측 및 공격 그룹 식별을 수행하는 흐름으로 구성된다.' },
            { type: 'heading', text: '주요 결과 (Results)' },
            { type: 'metrics', items: [
                { value: '91.73%', label: '공격자 다음 행위 예측 정확도 (next-action prediction)' },
                { value: '93.49%', label: '공격 그룹 식별 정확도 (attack-group identification)' }
            ] }
        ],
        bibtex:
            '@article{han2025ttps,\n'
          + '  title   = {Enhancing Incident Response Through Effective TTPs Analysis: A Design Approach},\n'
          + '  author  = {Han, Tae-Hyun and Hwang, Sang-Yeon and Lee, Tae-Jin},\n'
          + '  journal = {IEEE Access},\n'
          + '  volume  = {13},\n'
          + '  pages   = {217799--217810},\n'
          + '  year    = {2025},\n'
          + '  doi     = {10.1109/ACCESS.2025.3645226}\n'
          + '}'
    }
};

// ==================== 알림 ====================
function showAlert(message, type) {
    const alert = document.createElement('div');
    alert.textContent = message;
    alert.style.cssText = 'position:fixed;top:20px;right:20px;z-index:3000;max-width:400px;padding:15px;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.2);';
    const palette = {
        success: ['#d4edda', '#155724', '#c3e6cb'],
        error:   ['#f8d7da', '#721c24', '#f5c6cb'],
        warning: ['#fff3cd', '#856404', '#ffeaa7']
    }[type] || ['#e2e3e5', '#383d41', '#d6d8db'];
    alert.style.background = palette[0];
    alert.style.color = palette[1];
    alert.style.border = '1px solid ' + palette[2];
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
}

// ==================== 이미지 압축 + Cloudinary 업로드 ====================
async function compressImage(file) {
    const TARGET = 8 * 1024 * 1024;
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            const MAX_PX = 4000;
            if (width > MAX_PX || height > MAX_PX) {
                const r = Math.min(MAX_PX / width, MAX_PX / height);
                width = Math.round(width * r); height = Math.round(height * r);
            }
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            let q = 0.85;
            const tryC = () => canvas.toBlob(blob => {
                if (!blob) { resolve(file); return; }
                if (blob.size <= TARGET || q <= 0.3) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                else { q -= 0.1; tryC(); }
            }, 'image/jpeg', q);
            tryC();
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}

async function uploadImage(file) {
    if (file.size > 10 * 1024 * 1024) file = await compressImage(file);
    return new Promise((resolve, reject) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
        xhr.onload = () => xhr.status === 200 ? resolve(JSON.parse(xhr.responseText).secure_url) : reject(new Error('업로드 실패'));
        xhr.onerror = () => reject(new Error('네트워크 오류'));
        xhr.send(fd);
    });
}

// ==================== 인증 ====================
async function loginUser(email, password) {
    if (ADMIN_EMAILS.indexOf(email) < 0) throw new Error('접근 권한이 없습니다. 연구실 관리자만 사용할 수 있습니다.');
    try {
        return await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (error.code === 'auth/user-not-found') return await auth.createUserWithEmailAndPassword(email, password);
        if (error.code === 'auth/wrong-password') throw new Error('비밀번호가 틀렸습니다.');
        if (error.code === 'auth/invalid-email') throw new Error('이메일 형식이 올바르지 않습니다.');
        throw error;
    }
}

function updateAuthUI() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    const adminBar = document.getElementById('projectAdminBar');
    const isAdmin = !!(currentUser && ADMIN_EMAILS.indexOf(currentUser.email) >= 0);
    if (loginBtn) loginBtn.style.display = isAdmin ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = isAdmin ? 'flex' : 'none';
    if (userInfo) userInfo.style.display = isAdmin ? 'flex' : 'none';
    if (userName && isAdmin) userName.textContent = currentUser.email;
    if (adminBar) adminBar.style.display = isAdmin ? 'flex' : 'none';
}

// ==================== 데이터 정규화 ====================
// 구버전(개별 필드) 데이터를 블록 배열로 변환 (하위 호환)
function getBlocks(data) {
    if (data && Array.isArray(data.blocks)) return data.blocks;
    const blocks = [];
    if (!data) return blocks;
    if (data.summary && data.summary.trim()) {
        blocks.push({ type: 'heading', text: '요약 (Summary)' });
        blocks.push({ type: 'text', text: data.summary });
    }
    if ((data.contributions || []).length) {
        blocks.push({ type: 'heading', text: '핵심 기여 (Contributions)' });
        blocks.push({ type: 'list', items: data.contributions });
    }
    if ((data.method && data.method.trim()) || (data.figures || []).length) {
        blocks.push({ type: 'heading', text: '제안 방법 (Proposed Approach)' });
        if (data.method && data.method.trim()) blocks.push({ type: 'text', text: data.method });
        (data.figures || []).forEach(f => { if (f && f.url) blocks.push({ type: 'figure', url: f.url, caption: f.caption || '' }); });
    }
    if ((data.metrics || []).length) {
        blocks.push({ type: 'heading', text: '주요 결과 (Results)' });
        blocks.push({ type: 'metrics', items: data.metrics });
    }
    return blocks;
}

// ==================== 로드 & 렌더 ====================
async function loadAndRender() {
    let data = null;
    try {
        const snap = await database.ref('projectPages/' + pageId).once('value');
        data = snap.val();
    } catch (e) { console.warn('DB 로드 실패, 기본값 사용:', e); }
    if (!data) data = DEFAULT_CONTENT[pageId] || null;
    renderContent(data);
}

function paraHtml(text) {
    return String(text || '').split(/\n\s*\n/).filter(p => p.trim())
        .map(p => `<p>${escHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

function renderBlockInner(b) {
    if (b.type === 'text') return paraHtml(b.text);
    if (b.type === 'list') {
        const items = (b.items || []).filter(x => x && x.trim());
        return items.length ? `<ul>${items.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>` : '';
    }
    if (b.type === 'figure') {
        if (!b.url) return '';
        return `<figure class="project-figure">
            <img src="${escHtml(b.url)}" alt="figure" loading="lazy">
            ${b.caption ? `<figcaption>${escHtml(b.caption)}</figcaption>` : ''}
        </figure>`;
    }
    if (b.type === 'metrics') {
        const items = (b.items || []).filter(m => m && m.value);
        if (!items.length) return '';
        return `<div class="project-metrics">${items.map(m => `
            <div class="metric-card">
                <div class="metric-value">${escHtml(m.value)}</div>
                <div class="metric-label">${escHtml(m.label || '').replace(/\n/g, '<br>')}</div>
            </div>`).join('')}</div>`;
    }
    return '';
}

function renderContent(data) {
    const root = document.getElementById('projectContent');
    if (!root) return;

    if (!data || !data.title) {
        root.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-file-lines"></i>
                <h3>아직 등록된 내용이 없습니다</h3>
                <p>관리자로 로그인한 뒤 <b>‘이 페이지 편집’</b>으로 내용을 추가하세요.</p>
            </div>`;
        return;
    }

    const venue = data.venue ? `<span class="project-venue">${escHtml(data.venue)}</span>` : '';
    const authors = data.authors ? `<p class="project-authors">${escHtml(data.authors)}</p>` : '';
    const affil = data.affil ? `<p class="project-affil">${escHtml(data.affil).replace(/\n/g, '<br>')}</p>` : '';

    const links = [];
    if (data.paperUrl) links.push(`<a href="${escHtml(data.paperUrl)}" target="_blank" rel="noopener"><i class="fas fa-file-alt"></i> Paper</a>`);
    if (data.bibtex) links.push(`<a href="#bibtex"><i class="fas fa-quote-right"></i> BibTeX</a>`);
    links.push(`<a href="./Publication.html"><i class="fas fa-list"></i> 전체 논문 목록</a>`);

    let html = `
        <section class="project-hero">
            ${venue}
            <h1 class="project-title">${escHtml(data.title)}</h1>
            ${authors}
            ${affil}
            <div class="project-links">${links.join('')}</div>
        </section>`;

    // 본문 블록 → 소제목마다 섹션 카드로 묶어 렌더
    const blocks = getBlocks(data);
    let sectionOpen = false;
    const closeSection = () => { if (sectionOpen) { html += '</section>'; sectionOpen = false; } };
    const openSection = (titleText) => {
        closeSection();
        html += `<section class="project-section">`;
        if (titleText) html += `<h2><i class="fas fa-angle-right"></i> ${escHtml(titleText)}</h2>`;
        sectionOpen = true;
    };
    blocks.forEach(b => {
        if (b.type === 'heading') {
            openSection(b.text || '');
        } else {
            if (!sectionOpen) openSection('');
            html += renderBlockInner(b);
        }
    });
    closeSection();

    if (data.bibtex && data.bibtex.trim()) {
        html += `<section class="project-section">
            <h2><i class="fas fa-quote-right"></i> 인용 (BibTeX)</h2>
            <pre class="project-bibtex" id="bibtex">${escHtml(data.bibtex)}</pre>
        </section>`;
    }

    root.innerHTML = html;
}

// ==================== 편집 모달: 블록 카드 ====================
function setFigThumb(card, src) {
    const thumb = card.querySelector('.fig-thumb');
    if (thumb) thumb.innerHTML = src ? `<img src="${escHtml(src)}" alt="">` : '<i class="fas fa-image"></i>';
}

function blockBodyHtml(type, value) {
    value = value || {};
    if (type === 'heading')
        return `<input type="text" class="blk-heading" placeholder="소제목 (예: 주요 결과)" value="${escHtml(value.text || '')}">`;
    if (type === 'text')
        return `<textarea class="blk-text" rows="4" placeholder="본문 (빈 줄로 문단 구분)">${escHtml(value.text || '')}</textarea>`;
    if (type === 'list')
        return `<textarea class="blk-list" rows="4" placeholder="목록 항목 (한 줄에 하나씩)">${escHtml((value.items || []).join('\n'))}</textarea>`;
    if (type === 'figure')
        return `<div class="fig-row">
                    <div class="fig-thumb">${value.url ? `<img src="${escHtml(value.url)}" alt="">` : '<i class="fas fa-image"></i>'}</div>
                    <div class="fig-fields">
                        <input type="text" class="blk-figcaption" placeholder="캡션 (예: Figure 1. 제안 프레임워크)" value="${escHtml(value.caption || '')}">
                        <input type="file" class="blk-figfile" accept="image/*">
                    </div>
                </div>`;
    if (type === 'metrics')
        return `<textarea class="blk-metrics" rows="3" placeholder="한 줄에 하나, '값 | 설명' 형식&#10;예: 91.73% | 다음 행위 예측 정확도">${escHtml((value.items || []).map(m => `${m.value} | ${m.label || ''}`).join('\n'))}</textarea>`;
    return '';
}

function makeBlockCard(type, value) {
    const meta = BLOCK_META[type] || { label: type, icon: 'fa-square' };
    const card = document.createElement('div');
    card.className = 'block-card';
    card.dataset.type = type;
    if (type === 'figure') card.dataset.url = (value && value.url) || '';
    card.innerHTML = `
        <div class="block-card-head">
            <span class="block-card-type"><i class="fas ${meta.icon}"></i> ${meta.label}</span>
            <span class="block-card-tools">
                <button type="button" class="blk-up" title="위로">↑</button>
                <button type="button" class="blk-down" title="아래로">↓</button>
                <button type="button" class="blk-del" title="삭제">&times;</button>
            </span>
        </div>
        <div class="block-card-body">${blockBodyHtml(type, value)}</div>`;

    card.querySelector('.blk-del').addEventListener('click', () => card.remove());
    card.querySelector('.blk-up').addEventListener('click', () => {
        const prev = card.previousElementSibling;
        if (prev) card.parentNode.insertBefore(card, prev);
    });
    card.querySelector('.blk-down').addEventListener('click', () => {
        const next = card.nextElementSibling;
        if (next) card.parentNode.insertBefore(next, card);
    });

    if (type === 'figure') {
        const fileInput = card.querySelector('.blk-figfile');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => setFigThumb(card, ev.target.result);
            reader.readAsDataURL(file);
        });
    }
    return card;
}

function addBlock(type, value) {
    document.getElementById('blockList').appendChild(makeBlockCard(type, value));
}

// ==================== 편집 모달 열기/닫기 ====================
function openEditModal() {
    const modal = document.getElementById('projectEditModal');
    database.ref('projectPages/' + pageId).once('value').then(snap => {
        const d = snap.val() || DEFAULT_CONTENT[pageId] || {};
        document.getElementById('pf-venue').value = d.venue || '';
        document.getElementById('pf-title').value = d.title || '';
        document.getElementById('pf-authors').value = d.authors || '';
        document.getElementById('pf-affil').value = d.affil || '';
        document.getElementById('pf-paperUrl').value = d.paperUrl || '';
        document.getElementById('pf-bibtex').value = d.bibtex || '';

        const list = document.getElementById('blockList');
        list.innerHTML = '';
        getBlocks(d).forEach(b => addBlock(b.type, b));

        modal.classList.add('open');
    });
}

function closeEditModal() {
    document.getElementById('projectEditModal').classList.remove('open');
}

async function saveProject(e) {
    e.preventDefault();
    if (!currentUser) { showAlert('로그인이 필요합니다.', 'error'); return; }
    if (isSaving) { showAlert('저장 중입니다. 잠시만 기다려주세요.', 'warning'); return; }

    const title = document.getElementById('pf-title').value.trim();
    if (!title) { showAlert('논문 제목을 입력해주세요.', 'warning'); return; }

    const hint = document.getElementById('projectUploadHint');
    const saveBtn = document.getElementById('projectSaveBtn');
    isSaving = true;
    if (saveBtn) saveBtn.disabled = true;
    if (hint) hint.style.display = 'block';

    try {
        const blocks = [];
        const cards = document.querySelectorAll('#blockList .block-card');
        for (const card of cards) {
            const type = card.dataset.type;
            if (type === 'heading') {
                const text = card.querySelector('.blk-heading').value.trim();
                if (text) blocks.push({ type, text });
            } else if (type === 'text') {
                const text = card.querySelector('.blk-text').value.trim();
                if (text) blocks.push({ type, text });
            } else if (type === 'list') {
                const items = card.querySelector('.blk-list').value.split('\n').map(s => s.trim()).filter(Boolean);
                if (items.length) blocks.push({ type, items });
            } else if (type === 'figure') {
                const caption = card.querySelector('.blk-figcaption').value.trim();
                const file = card.querySelector('.blk-figfile').files[0];
                let url = card.dataset.url || '';
                if (file) url = await uploadImage(file);
                if (url) blocks.push({ type, url, caption });
            } else if (type === 'metrics') {
                const items = card.querySelector('.blk-metrics').value.split('\n').map(line => {
                    const parts = line.split('|');
                    return { value: (parts[0] || '').trim(), label: parts.slice(1).join('|').trim() };
                }).filter(m => m.value);
                if (items.length) blocks.push({ type, items });
            }
        }

        const data = {
            venue: document.getElementById('pf-venue').value.trim(),
            title: title,
            authors: document.getElementById('pf-authors').value.trim(),
            affil: document.getElementById('pf-affil').value.trim(),
            paperUrl: document.getElementById('pf-paperUrl').value.trim(),
            bibtex: document.getElementById('pf-bibtex').value.trim(),
            blocks: blocks,
            updatedAt: Date.now()
        };

        await database.ref('projectPages/' + pageId).set(data);
        showAlert('저장되었습니다.', 'success');
        closeEditModal();
        renderContent(data);
    } catch (error) {
        console.error('저장 실패:', error);
        showAlert('저장 실패: ' + error.message, 'error');
    } finally {
        isSaving = false;
        if (saveBtn) saveBtn.disabled = false;
        if (hint) hint.style.display = 'none';
    }
}

// ==================== 이벤트 ====================
function setupEvents() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const loginModal = document.getElementById('loginModal');
    const loginClose = document.getElementById('loginClose');
    const loginForm = document.getElementById('loginForm');

    if (loginBtn) loginBtn.addEventListener('click', () => loginModal && (loginModal.style.display = 'block'));
    if (loginClose) loginClose.addEventListener('click', () => loginModal && (loginModal.style.display = 'none'));
    if (loginModal) loginModal.addEventListener('click', (e) => { if (e.target === loginModal) loginModal.style.display = 'none'; });
    if (logoutBtn) logoutBtn.addEventListener('click', async () => { await auth.signOut(); showAlert('로그아웃되었습니다.', 'success'); });

    if (loginForm) loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const result = await loginUser(document.getElementById('email').value, document.getElementById('password').value);
            currentUser = result.user;
            updateAuthUI();
            showAlert('로그인 성공!', 'success');
            if (loginModal) loginModal.style.display = 'none';
            loginForm.reset();
        } catch (error) { showAlert('로그인 실패: ' + error.message, 'error'); }
    });

    const editBtn = document.getElementById('projectEditBtn');
    if (editBtn) editBtn.addEventListener('click', openEditModal);

    const cancelBtn = document.getElementById('projectEditCancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditModal);

    // 편집 모달은 바깥 클릭으로 닫지 않음 (입력 중 실수로 닫힘 방지) — 취소/저장 버튼으로만 닫힘

    document.querySelectorAll('.block-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            addBlock(btn.dataset.type, {});
            const list = document.getElementById('blockList');
            const last = list.lastElementChild;
            if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    });

    const form = document.getElementById('projectForm');
    if (form) form.addEventListener('submit', saveProject);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { if (loginModal) loginModal.style.display = 'none'; } // 편집 모달은 ESC로 닫지 않음
    });
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    pageId = (params.get('id') || 'ttps').trim();

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
        auth.onAuthStateChanged((user) => {
            currentUser = user;
            updateAuthUI();
        });
    } catch (error) {
        console.error('Firebase 초기화 실패:', error);
    }

    setupEvents();
    loadAndRender();
});
