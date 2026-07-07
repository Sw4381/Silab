// worklog.js - 업무관리 (로그인 전용)
// 교수님 초안(silab-업무관리_1.html) 양식 준용. 저장소는 파일 대신 Firebase RTDB `worklog` 노드.
// 설정값은 config.js 참조 (firebaseConfig, ADMIN_UID, ROOT_UID)

// ==================== 상수 ====================
const WL_ALLOWED = [ADMIN_UID, ROOT_UID];
const WL_PATH = 'worklog';
const WL_PALETTE = ['#4f46e5', '#059669', '#dc2626', '#d97706', '#0891b2', '#7c3aed', '#db2777', '#65a30d'];
// 2차 디자인에서 잠시 쓴 팔레트 → 원래 팔레트 복귀 매핑 (저장된 데이터 색 자동 복원)
const WL_COLOR_MAP = {
    '#24488c': '#4f46e5', '#1e7a5f': '#059669', '#a8402c': '#dc2626', '#b1791f': '#d97706',
    '#0f7a99': '#0891b2', '#6d4a8e': '#7c3aed', '#6a7f1f': '#65a30d', '#a53a62': '#db2777'
};

const WL_DEFAULT = {
    sections: [
        { emoji: '🗓️', name: 'Lab회의', collapsed: false, color: '#4f46e5', items: [] },
        { emoji: '📚', name: 'Lab세미나', collapsed: false, color: '#059669', items: [] },
        { emoji: '⚡', name: '수시업무', collapsed: false, color: '#dc2626', items: [] },
        { emoji: '📁', name: '프로젝트 관리', collapsed: false, color: '#0891b2', items: [] },
        { emoji: '📝', name: '논문/특허', collapsed: false, color: '#d97706', items: [] }
    ],
    people: []
};

// ==================== 전역 상태 ====================
let auth, database;
let currentUser = null;
let data = null;
let dirty = false;
let saveTimer = null;
let saving = false;
const expanded = {};   // 화면 상태(펼침)는 저장하지 않음

let wlApp, authGate, board;

// ==================== 유틸 ====================
function esc(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let uidSeq = 0;
function newId() { return 'i' + Date.now().toString(36) + (uidSeq++).toString(36); }

function wlAlert(message, type) {
    const el = document.createElement('div');
    el.className = 'wl-alert ' + (type || 'info');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function toArr(v) {
    if (Array.isArray(v)) return v.filter(x => x != null);
    if (v && typeof v === 'object') return Object.values(v).filter(x => x != null);   // Firebase가 배열을 객체로 줄 때
    return [];
}

// 초안 파일(silab-업무관리-data.json) 및 Firebase 저장분 공통 정규화
function normalize() {
    if (!data || typeof data !== 'object') data = JSON.parse(JSON.stringify(WL_DEFAULT));
    const checked = data.checked || {};   // 초안 스키마: 완료 여부가 별도 맵
    data.sections = toArr(data.sections);
    if (!data.sections.length) data.sections = JSON.parse(JSON.stringify(WL_DEFAULT.sections));
    data.sections.forEach((sec, si) => {
        if (!sec.id || !/^[A-Za-z0-9_-]+$/.test(sec.id)) sec.id = 's' + newId();
        if (!sec.emoji) sec.emoji = '📌';
        if (!sec.name) sec.name = '(이름없음)';
        if (!sec.color) sec.color = WL_PALETTE[si % WL_PALETTE.length];
        if (WL_COLOR_MAP[sec.color]) sec.color = WL_COLOR_MAP[sec.color];
        sec.collapsed = !!sec.collapsed;
        sec.items = toArr(sec.items).map(it => {
            const o = (typeof it === 'string') ? { text: it } : it;
            if (!o.id || !/^[A-Za-z0-9_-]+$/.test(o.id)) o.id = newId();
            o.text = String(o.text || '');
            // 초안 스키마: details(줄 배열) → note, owner(문자열) → owners(배열)
            const details = toArr(o.details);
            if (details.length && !o.note) o.note = details.join('\n');
            delete o.details;
            if (typeof o.note !== 'string') o.note = '';
            if (!o.owners) o.owners = String(o.owner || '').split(/[,·/]/).map(s => s.trim()).filter(Boolean);
            o.owners = toArr(o.owners).map(String);
            delete o.owner;
            o.subs = toArr(o.subs).map(s => ({
                id: (s.id && /^[A-Za-z0-9_-]+$/.test(s.id)) ? s.id : newId(),
                text: String(s.text || ''),
                done: !!s.done
            }));
            o.done = ('done' in o) ? !!o.done : !!checked[o.id];
            if (!Number.isFinite(o.pct)) o.pct = 0;
            o.focus = !!o.focus;
            return o;
        });
    });
    delete data.checked;
    data.people = toArr(data.people).map(String).filter(Boolean);
}

function findSec(sid) { return data.sections.find(s => s.id === sid); }
function findItem(sid, iid) { return findSec(sid).items.find(x => x.id === iid); }

// 항목 진척율: 세부 항목(미션)이 있으면 완료 비율로 자동 계산, 없으면 수동 설정값
function itemPct(it) {
    if (it.done) return 100;
    if (it.subs && it.subs.length) return Math.round(it.subs.filter(s => s.done).length / it.subs.length * 100);
    return it.pct;
}

// ==================== 이름 인라인 수정 (항목/세부/카테고리 공용) ====================
// prompt() 대신 그 자리에서 입력칸 + [저장]/[취소] 버튼으로 수정 (Enter=저장, Esc=취소)
let editing = null;   // { type: 'item'|'sub'|'sec', id, sid, iid }

function isEditing(type, id) { return !!(editing && editing.type === type && editing.id === id); }

function editorHtml(value) {
    return `<span class="edit-wrap" onclick="event.stopPropagation()">
        <input class="edit-inp" type="text" value="${esc(value)}" onkeydown="editorKey(event)">
        <button class="edit-save" title="저장 (Enter)" onclick="commitEdit()">저장</button>
        <button class="edit-cancel" title="취소 (Esc)" onclick="cancelEdit()">취소</button></span>`;
}
function editorKey(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
}
function commitEdit() {
    if (!editing) return;
    const inp = document.querySelector('.edit-inp');
    const v = inp ? inp.value.trim() : '';
    if (v) {
        if (editing.type === 'sec') findSec(editing.id).name = v;
        else if (editing.type === 'item') findItem(editing.sid, editing.id).text = v;
        else if (editing.type === 'sub') {
            const s = findItem(editing.sid, editing.iid).subs.find(x => x.id === editing.id);
            if (s) s.text = v;
        }
        touch();
    }
    editing = null;
    render();
}
function cancelEdit() { editing = null; render(); }

// ==================== 저장 (Firebase, 자동) ====================
function setSaveStat(cls, text) {
    const dot = document.getElementById('saveDot'), t = document.getElementById('saveText');
    if (dot) dot.className = 'wl-dot' + (cls ? ' ' + cls : '');
    if (t) t.textContent = text;
}

function touch() {
    dirty = true;
    setSaveStat('dirty', '저장 중...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 800);
}

async function saveNow() {
    if (!currentUser || !data || saving) return;
    saving = true;
    try {
        await database.ref(WL_PATH).set(data);
        dirty = false;
        const now = new Date();
        setSaveStat('linked', '저장됨 ' + String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0'));
    } catch (err) {
        setSaveStat('dirty', '저장 실패');
        wlAlert('저장 실패: ' + err.message, 'error');
    } finally {
        saving = false;
        if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400); }
    }
}

async function loadData() {
    setSaveStat('', '불러오는 중...');
    const snap = await database.ref(WL_PATH).once('value');
    data = snap.val() || JSON.parse(JSON.stringify(WL_DEFAULT));
    normalize();
    dirty = false;
    setSaveStat('linked', '동기화됨');
    render();
}

// ==================== 렌더 ====================
function render() {
    if (!board || !data) return;
    closePops();
    board.innerHTML = '';
    data.sections.forEach(sec => {
        const el = document.createElement('div');
        el.className = 'wl-section' + (sec.collapsed ? ' collapsed' : '');
        el.style.setProperty('--sec-color', sec.color);
        const doneCount = sec.items.filter(it => it.done).length;
        const allDone = sec.items.length > 0 && doneCount === sec.items.length;
        const secNameHtml = isEditing('sec', sec.id)
            ? editorHtml(sec.name)
            : `<h2 title="더블클릭하여 이름 수정" ondblclick="editSectionName('${sec.id}',event)">${esc(sec.name)}</h2>`;
        // 접힌 상태 요약: 미완료 항목만 한 줄씩 (★/이름/담당자/진척율). 클릭하면 해당 항목으로 펼침.
        let digestHtml = '';
        if (sec.collapsed) {
            const pending = sec.items.filter(it => !it.done);
            const rows = pending.map(it => {
                const owners = it.owners.length ? ` <span class="d-owner">(${esc(it.owners.join('·'))})</span>` : '';
                return `<div class="digest-row${it.focus ? ' focused' : ''}" title="클릭하면 펼치기" onclick="openFromDigest('${sec.id}','${it.id}',event)">
                    <span class="d-star">${it.focus ? '★' : '·'}</span>
                    <span class="d-txt">${esc(it.text)}${owners}</span>
                    <span class="d-pct">${itemPct(it)}%</span></div>`;
            }).join('');
            digestHtml = `<div class="digest">${rows || `<div class="digest-empty">${sec.items.length ? '모두 완료 ✓' : '항목 없음'}</div>`}</div>`;
        }
        el.innerHTML = `
            <div class="sec-head" onclick="toggleSection('${sec.id}',event)">
                <span class="sec-drag" draggable="true" title="드래그하여 카테고리 순서 변경"
                    ondragstart="secDragStart('${sec.id}',event)" ondragend="dragEnd()">⠿</span>
                <span class="emoji" title="클릭하여 이모지 변경" onclick="editSectionEmoji('${sec.id}',event)">${sec.emoji}</span>
                ${secNameHtml}
                <span class="count${allDone ? ' all-done' : ''}">${doneCount}/${sec.items.length}${allDone ? ' 완료' : ''}</span>
                <span class="mini sec-edit" title="카테고리 이름 수정" onclick="editSectionName('${sec.id}',event)">✏️</span>
                <span class="mini sec-del" title="카테고리 삭제" onclick="deleteSection('${sec.id}',event)">🗑</span>
                <span class="caret">▾</span>
            </div>${digestHtml}<div class="items"></div>`;
        el.ondragover = e => secDragOver(sec.id, e);
        el.ondrop = e => secDrop(sec.id, e);
        const box = el.querySelector('.items');
        box.ondragover = e => listDragOver(sec.id, e);
        box.ondrop = e => listDrop(sec.id, e);
        sec.items.forEach(it => {
            const isOpen = !!expanded[it.id];
            const pct = itemPct(it);
            const wrap = document.createElement('div');
            wrap.className = 'item-wrap' + (isOpen ? ' open' : '') + (it.focus ? ' focused' : '');
            wrap.dataset.iid = it.id;
            wrap.ondragover = e => wrapDragOver(sec.id, it.id, e);
            wrap.ondrop = e => wrapDrop(sec.id, it.id, e);

            const R = 17.5, C = 2 * Math.PI * R;
            const off = C * (1 - pct / 100);
            const ringCls = 'pct-ring' + (pct >= 100 ? ' p100' : '') + (pct <= 0 ? ' p0' : '');
            const ring = `<div class="${ringCls}" title="진척율 설정" onclick="openPct('${sec.id}','${it.id}',event)">
                <svg width="40" height="40" viewBox="0 0 40 40">
                    <circle class="pct-bg" cx="20" cy="20" r="${R}"></circle>
                    <circle class="pct-fg" cx="20" cy="20" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
                </svg><span class="pct-num">${pct}%</span></div>`;

            // 담당자는 이름마다 개별 칩 — 칸을 넘어가면 자동 줄바꿈
            const ownerTag = it.owners.map(o =>
                `<span class="owner-tag" title="담당자 변경" onclick="openOwnerPop('${sec.id}','${it.id}',event)">${esc(o)}</span>`).join('');
            const subDone = it.subs.filter(s => s.done).length;
            const subBadge = it.subs.length
                ? `<span class="sub-badge${subDone === it.subs.length ? ' all-done' : ''}" title="세부 항목 ${subDone}/${it.subs.length} 완료">☑ ${subDone}/${it.subs.length}</span>` : '';

            // 세부영역: 보기 모드(깔끔) / 편집 모드(추가칸·삭제·메모 입력칸 표시)
            const isDE = !!detailEdit[it.id];
            const subsHtml = it.subs.map(s => {
                let body;
                if (isEditing('sub', s.id)) body = editorHtml(s.text);
                else if (isDE) body = `<span class="sub-txt" title="클릭하여 수정" onclick="editSub('${sec.id}','${it.id}','${s.id}')">${esc(s.text)}</span>
                       <button class="sub-del" title="삭제" onclick="delSub('${sec.id}','${it.id}','${s.id}')">✕</button>`;
                else body = `<span class="sub-txt" title="클릭하여 완료 체크" onclick="toggleSub('${sec.id}','${it.id}','${s.id}')">${esc(s.text)}</span>`;
                return `
                <div class="sub-item${s.done ? ' done' : ''}">
                    <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSub('${sec.id}','${it.id}','${s.id}')">
                    ${body}
                </div>`;
            }).join('');

            const txtHtml = isEditing('item', it.id)
                ? editorHtml(it.text)
                : `<span class="txt" onclick="toggleExpand('${it.id}')">${esc(it.text)}${ownerTag}${subBadge}<span class="tcaret">▸</span></span>
                    <span class="item-actions">
                        <button class="mini" title="담당자 지정" onclick="openOwnerPop('${sec.id}','${it.id}',event)">👤</button>
                        <button class="mini" title="항목명 수정" onclick="editItem('${sec.id}','${it.id}')">✏️</button>
                        <button class="mini" title="항목 삭제" onclick="deleteItem('${sec.id}','${it.id}')">✕</button>
                    </span>`;
            wrap.innerHTML = `
                <div class="item${it.done ? ' done' : ''}" draggable="true"
                    ondragstart="dragStart('${sec.id}','${it.id}',event)" ondragend="dragEnd()">
                    <span class="item-drag" title="드래그하여 순서 변경">⠿</span>
                    <span class="focus-star${it.focus ? ' on' : ''}" title="오늘 집중할 대상" onclick="toggleFocus('${sec.id}','${it.id}')">${it.focus ? '★' : '☆'}</span>
                    <input type="checkbox" ${it.done ? 'checked' : ''} onchange="toggleCheck('${sec.id}','${it.id}')">
                    ${ring}
                    ${txtHtml}
                </div>
                <div class="detail-box">
                    <div class="detail-tools">
                        <button class="detail-edit-btn${isDE ? ' on' : ''}" onclick="toggleDetailEdit('${it.id}')">${isDE ? '✔ 편집 완료' : '✏️ 편집'}</button>
                    </div>
                    <div class="sub-list">${subsHtml}</div>
                    ${isDE ? `
                    <div class="sub-add">
                        <input type="text" placeholder="+ 세부 항목 추가" onkeydown="if(event.key==='Enter')addSub('${sec.id}','${it.id}',this)">
                        <button onclick="addSub('${sec.id}','${it.id}',this.previousElementSibling)">추가</button>
                    </div>
                    <textarea class="detail-area" placeholder="자유 메모 (여러 줄 가능)"
                        oninput="autoGrow(this)"
                        onchange="saveNote('${sec.id}','${it.id}',this.value)"
                        onblur="saveNote('${sec.id}','${it.id}',this.value)">${esc(it.note)}</textarea>`
                    : (it.note.trim()
                        ? `<div class="note-view" title="클릭하여 편집" onclick="toggleDetailEdit('${it.id}')">${esc(it.note)}</div>`
                        : (it.subs.length ? '' : `<div class="detail-hint" onclick="toggleDetailEdit('${it.id}')">✏️ 편집을 눌러 세부 항목·메모를 추가하세요</div>`))}
                </div>`;
            box.appendChild(wrap);
        });
        const add = document.createElement('div');
        add.className = 'add-row';
        add.innerHTML = `<input type="text" placeholder="+ 항목 추가" onkeydown="if(event.key==='Enter')addItem('${sec.id}',this)">
            <button onclick="addItem('${sec.id}',this.previousElementSibling)">추가</button>`;
        box.appendChild(add);
        board.appendChild(el);
    });
    // 펼쳐진 항목의 메모 높이 맞추기
    board.querySelectorAll('.item-wrap.open .detail-area').forEach(autoGrow);
    // 인라인 수정 중이면 입력칸에 포커스
    const einp = board.querySelector('.edit-inp');
    if (einp) {
        einp.focus();
        const L = einp.value.length;
        try { einp.setSelectionRange(L, L); } catch (_) { }
    }
}

// 접힌 카드의 요약 줄 클릭 → 카테고리를 펼치고 해당 항목의 세부까지 열기
function openFromDigest(sid, iid, e) {
    e.stopPropagation();
    findSec(sid).collapsed = false;
    expanded[iid] = true;
    touch();
    render();
    const el = board.querySelector(`.item-wrap[data-iid="${iid}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePops() { document.querySelectorAll('.pct-pop, .owner-pop').forEach(p => p.remove()); }

// 팝오버를 화면(뷰포트) 기준으로 고정 배치 — 어느 위치·어느 단(column)에서 열어도 화면 밖으로 안 나감
// (카드 안 absolute 배치는 CSS 다단 경계에서 좌표가 틀어져 화면 위로 튀는 문제가 있었음 → body + fixed)
function placePopFixed(pop, anchor) {
    const ar = anchor.getBoundingClientRect();
    let left = ar.left, top = ar.bottom + 4;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    const r = pop.getBoundingClientRect();
    if (r.right > window.innerWidth - 8) left -= r.right - (window.innerWidth - 8);
    if (left < 8) left = 8;
    if (r.bottom > window.innerHeight - 8) {
        top = ar.top - r.height - 4;                                        // 아래 공간 부족 → 앵커 위로
        if (top < 8) top = Math.max(8, window.innerHeight - 8 - r.height);  // 위도 부족 → 화면 안쪽으로
    }
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
}

// 바깥 클릭/페이지 스크롤 시 팝오버 닫기 (팝오버 내부 스크롤은 예외)
function attachPopClose(pop, onClose) {
    function done() {
        pop.remove();
        document.removeEventListener('click', clickClose, true);
        window.removeEventListener('scroll', scrollClose, true);
        if (onClose) onClose();
    }
    function clickClose(ev) { if (!pop.contains(ev.target)) done(); }
    function scrollClose(ev) { if (pop.contains(ev.target)) return; done(); }
    setTimeout(() => {
        document.addEventListener('click', clickClose, true);
        window.addEventListener('scroll', scrollClose, true);
    }, 0);
    return done;
}

// ==================== 드래그 앤 드롭 (항목/카테고리 순서 변경) ====================
let dragState = null;   // { type:'item', sid, iid } | { type:'sec', sid }

function dragStart(sid, iid, e) {
    dragState = { type: 'item', sid: sid, iid: iid };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', iid); } catch (_) { }   // Firefox 필수
    const wrap = board.querySelector(`.item-wrap[data-iid="${iid}"]`);
    if (wrap) setTimeout(() => wrap.classList.add('dragging'), 0);
}
function secDragStart(sid, e) {
    e.stopPropagation();
    dragState = { type: 'sec', sid: sid };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', sid); } catch (_) { }
}
function clearDropMarks() {
    document.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach(el =>
        el.classList.remove('drop-above', 'drop-below', 'drop-into'));
}
function dragEnd() {
    dragState = null;
    clearDropMarks();
    document.querySelectorAll('.item-wrap.dragging').forEach(el => el.classList.remove('dragging'));
}

// 항목 위로 드래그: 마우스 위치에 따라 위/아래 삽입선 표시
function wrapDragOver(sid, iid, e) {
    if (!dragState || dragState.type !== 'item') return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    clearDropMarks();
    e.currentTarget.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
}
function wrapDrop(sid, iid, e) {
    if (!dragState || dragState.type !== 'item') return;
    e.preventDefault(); e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const above = e.clientY < r.top + r.height / 2;
    const idx = findSec(sid).items.findIndex(x => x.id === iid);
    moveDraggedItem(sid, idx + (above ? 0 : 1));
}

// 항목 목록의 빈 공간(추가줄 포함)으로 드롭: 맨 뒤에 추가
function listDragOver(sid, e) {
    if (!dragState || dragState.type !== 'item') return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    e.currentTarget.classList.add('drop-into');
}
function listDrop(sid, e) {
    if (!dragState || dragState.type !== 'item') return;
    e.preventDefault(); e.stopPropagation();
    moveDraggedItem(sid, findSec(sid).items.length);
}

function moveDraggedItem(dstSid, dstIndex) {
    const st = dragState;
    if (!st) return;
    const src = findSec(st.sid), dst = findSec(dstSid);
    const idx = src.items.findIndex(x => x.id === st.iid);
    if (idx < 0) { dragEnd(); return; }
    if (st.sid === dstSid && idx < dstIndex) dstIndex--;
    const moved = src.items.splice(idx, 1)[0];
    dstIndex = Math.max(0, Math.min(dstIndex, dst.items.length));
    dst.items.splice(dstIndex, 0, moved);
    dragEnd();
    touch(); render();
}

// 카테고리 카드 레벨: 카테고리 드래그면 순서 변경, 항목 드래그면(접힌 카드 등) 그 카테고리 맨 뒤로
function secDragOver(sid, e) {
    if (!dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarks();
    if (dragState.type === 'sec') {
        if (dragState.sid === sid) return;
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
    } else {
        e.currentTarget.classList.add('drop-into');
    }
}
function secDrop(sid, e) {
    if (!dragState) return;
    e.preventDefault();
    if (dragState.type === 'sec') {
        if (dragState.sid === sid) { dragEnd(); return; }
        const r = e.currentTarget.getBoundingClientRect();
        const above = e.clientY < r.top + r.height / 2;
        const from = data.sections.findIndex(s => s.id === dragState.sid);
        let to = data.sections.findIndex(s => s.id === sid) + (above ? 0 : 1);
        if (from < to) to--;
        const moved = data.sections.splice(from, 1)[0];
        data.sections.splice(to, 0, moved);
        dragEnd();
        touch(); render();
    } else {
        moveDraggedItem(sid, findSec(sid).items.length);
    }
}

// ==================== 카테고리 ====================
function toggleSection(sid, e) {
    if (e.target.closest('.mini') || e.target.closest('.emoji') || e.target.closest('.edit-wrap')) return;
    const s = findSec(sid); s.collapsed = !s.collapsed; touch(); render();
}
function expandAll(open) { data.sections.forEach(s => s.collapsed = !open); touch(); render(); }
function addSection() {
    const inp = document.getElementById('newSectionName');
    const n = inp.value.trim(); if (!n) return;
    data.sections.push({ id: 's' + newId(), emoji: '📌', name: n, collapsed: false, color: WL_PALETTE[data.sections.length % WL_PALETTE.length], items: [] });
    inp.value = ''; touch(); render();
    setAddSectionForm(false);
}

// 카테고리 추가 폼: 평소엔 버튼만 보이고, 누를 때만 입력칸 표시
function setAddSectionForm(open) {
    const openBtn = document.getElementById('addSectionOpenBtn');
    const form = document.getElementById('addSectionForm');
    if (!openBtn || !form) return;
    openBtn.style.display = open ? 'none' : '';
    form.style.display = open ? 'flex' : 'none';
    if (open) document.getElementById('newSectionName').focus();
    else document.getElementById('newSectionName').value = '';
}
function editSectionName(sid, e) {
    e.stopPropagation();
    editing = { type: 'sec', id: sid };
    render();
}
function editSectionEmoji(sid, e) {
    e.stopPropagation();
    const s = findSec(sid);
    const v = prompt('이모지 수정 (예: 📁 🗓️ 📝):', s.emoji);
    if (v !== null && v.trim()) { s.emoji = v.trim(); touch(); render(); }
}
function deleteSection(sid, e) {
    e.stopPropagation();
    const s = findSec(sid);
    if (confirm(`'${s.name}' 카테고리를 삭제할까요? (안의 항목도 모두 삭제)`)) {
        data.sections = data.sections.filter(x => x.id !== sid);
        touch(); render();
    }
}

// ==================== 항목 ====================
function addItem(sid, inp) {
    const v = inp.value.trim(); if (!v) return;
    const it = { id: newId(), text: v, owners: [], note: '', subs: [], pct: 0, focus: false, done: false };
    findSec(sid).items.push(it);
    inp.value = '';
    touch(); render();
    // 연속 입력할 수 있게 방금 쓴 카테고리의 입력칸에 포커스 유지
    const secEl = board.querySelectorAll('.wl-section')[data.sections.findIndex(s => s.id === sid)];
    const inp2 = secEl && secEl.querySelector('.add-row input');
    if (inp2) inp2.focus();
}
function editItem(sid, iid) {
    editing = { type: 'item', id: iid, sid: sid };
    render();
}
function deleteItem(sid, iid) {
    const s = findSec(sid);
    s.items = s.items.filter(x => x.id !== iid);
    delete expanded[iid];
    delete detailEdit[iid];
    touch(); render();
}
function toggleCheck(sid, iid) {
    const it = findItem(sid, iid);
    it.done = !it.done;   // 표시상 완료 시 100%, 해제하면 원래 진척율로 복귀
    touch(); render();
}
function toggleFocus(sid, iid) { const it = findItem(sid, iid); it.focus = !it.focus; touch(); render(); }

// ==================== 진척율 ====================
function openPct(sid, iid, e) {
    e.stopPropagation();
    closePops();
    const it = findItem(sid, iid);
    const cur = itemPct(it);
    const ring = e.currentTarget;
    const pop = document.createElement('div');
    pop.className = 'pct-pop';
    pop.onclick = ev => ev.stopPropagation();
    if (it.subs.length) {
        // 세부 항목(미션)이 있으면 완료 비율로 자동 계산 — 수동 조절 없음
        const doneCnt = it.subs.filter(s => s.done).length;
        pop.innerHTML = `
            <div class="pct-pop-head"><span>진척율</span><span class="pct-pop-val">${cur}%</span></div>
            <div class="pct-auto-hint">세부 항목 체크에 따라 자동 계산됩니다.<br>(${doneCnt}/${it.subs.length} 완료)</div>`;
    } else {
        pop.innerHTML = `
        <div class="pct-pop-head"><span>진척율</span><span class="pct-pop-val">${cur}%</span></div>
        <input type="range" min="0" max="100" step="5" value="${cur}"
            oninput="this.previousElementSibling.querySelector('.pct-pop-val').textContent=this.value+'%'"
            onchange="setPct('${sid}','${iid}',+this.value)">
        <div class="pct-quick">
            <button onclick="setPct('${sid}','${iid}',0)">0</button>
            <button onclick="setPct('${sid}','${iid}',25)">25</button>
            <button onclick="setPct('${sid}','${iid}',50)">50</button>
            <button onclick="setPct('${sid}','${iid}',75)">75</button>
            <button onclick="setPct('${sid}','${iid}',100)">100</button>
        </div>`;
    }
    document.body.appendChild(pop);
    placePopFixed(pop, ring);
    attachPopClose(pop);
}
function setPct(sid, iid, v) {
    const it = findItem(sid, iid);
    it.pct = v;
    it.done = (v >= 100);
    touch(); render();
}

// ==================== 담당자 (미리 등록한 명단에서 클릭 지정) ====================
function openOwnerPop(sid, iid, e) {
    e.stopPropagation();
    closePops();
    const it = findItem(sid, iid);
    let pending = it.owners.slice();   // [확인]을 누르기 전에는 반영하지 않음
    const newPeople = [];              // 직접 입력한 이름 — 확인 시 명단에도 등록

    const pop = document.createElement('div');
    pop.className = 'owner-pop';
    pop.onclick = ev => ev.stopPropagation();

    function chipsHtml() {
        const ppl = data.people.concat(newPeople.filter(p => data.people.indexOf(p) < 0));
        if (!ppl.length) return '<div class="owner-pop-empty">등록된 명단이 없습니다.<br>아래 \'명단 편집\'에서 먼저 등록하세요.</div>';
        return ppl.map(p =>
            `<button class="owner-chip${pending.includes(p) ? ' on' : ''}" data-name="${esc(p)}">${esc(p)}</button>`).join('');
    }
    pop.innerHTML = `
        <div class="owner-pop-head">담당자 지정 <span style="font-weight:400;color:#6b7280;">(클릭으로 선택 후 확인)</span></div>
        <div class="owner-chips">${chipsHtml()}</div>
        <div class="owner-pop-foot">
            <input type="text" placeholder="직접 입력 후 Enter">
            <button title="목록에 추가">+</button>
        </div>
        <div class="owner-pop-actions">
            <button class="owner-pop-edit">명단 편집</button>
            <span style="flex:1"></span>
            <button class="op-cancel">취소</button>
            <button class="op-ok">확인</button>
        </div>`;

    pop.querySelector('.owner-chips').addEventListener('click', ev => {
        const chip = ev.target.closest('.owner-chip'); if (!chip) return;
        const name = chip.dataset.name;
        if (pending.includes(name)) { pending = pending.filter(x => x !== name); chip.classList.remove('on'); }
        else { pending.push(name); chip.classList.add('on'); }
    });
    const inp = pop.querySelector('.owner-pop-foot input');
    function addCustom() {
        const v = inp.value.trim(); if (!v) return;
        if (!pending.includes(v)) pending.push(v);
        if (!data.people.includes(v) && !newPeople.includes(v)) newPeople.push(v);
        inp.value = '';
        pop.querySelector('.owner-chips').innerHTML = chipsHtml();
    }
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addCustom(); } });
    pop.querySelector('.owner-pop-foot button').addEventListener('click', addCustom);

    document.body.appendChild(pop);
    placePopFixed(pop, e.currentTarget);
    const close = attachPopClose(pop);   // 바깥 클릭·스크롤 = 취소 (반영 안 함)

    pop.querySelector('.op-cancel').addEventListener('click', () => close());
    pop.querySelector('.op-ok').addEventListener('click', () => {
        it.owners = pending;
        newPeople.forEach(p => { if (!data.people.includes(p)) data.people.push(p); });
        close();
        touch(); render();
    });
    pop.querySelector('.owner-pop-edit').addEventListener('click', () => { close(); openPeopleModal(); });
}

// ----- 명단 편집 모달 -----
function openPeopleModal() {
    document.getElementById('peopleArea').value = data.people.join('\n');
    document.getElementById('peopleModal').classList.add('open');
}
function closePeopleModal() { document.getElementById('peopleModal').classList.remove('open'); }
function savePeople() {
    const lines = document.getElementById('peopleArea').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    data.people = [...new Set(lines)];
    touch(); closePeopleModal(); render();
    wlAlert('담당자 명단이 저장되었습니다.', 'success');
}
async function loadMembersToPeople() {
    try {
        const snap = await database.ref('members').once('value');
        const all = snap.val() || {};
        const names = [];
        ['professor', 'phd', 'ms', 'bs', 'parttime'].forEach(g => {
            toArr(all[g]).forEach(m => {
                const raw = String((m && m.name) || '').trim();
                if (!raw) return;
                const kor = raw.split('(')[0].trim();   // "홍길동 (Gil-dong Hong)" → "홍길동"
                if (kor) names.push(kor);
            });
        });
        if (!names.length) { wlAlert('멤버 데이터를 찾지 못했습니다.', 'error'); return; }
        const area = document.getElementById('peopleArea');
        const cur = area.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        area.value = [...new Set([...cur, ...names])].join('\n');
        wlAlert(names.length + '명을 불러왔습니다. 저장을 눌러 반영하세요.', 'success');
    } catch (err) {
        wlAlert('멤버 불러오기 실패: ' + err.message, 'error');
    }
}

// ==================== 세부사항 (하위 항목 + 자유 메모) ====================
const detailEdit = {};   // 세부영역 편집 모드 (화면 상태, 저장 안 함)

function toggleExpand(iid) {
    if (expanded[iid]) { delete expanded[iid]; delete detailEdit[iid]; }
    else expanded[iid] = true;
    render();
}

function toggleDetailEdit(iid) {
    if (detailEdit[iid]) delete detailEdit[iid];
    else { detailEdit[iid] = true; expanded[iid] = true; }
    render();
}
function saveNote(sid, iid, val) {
    const it = findItem(sid, iid);
    if (it.note !== val) { it.note = val; touch(); }
}
function autoGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

function addSub(sid, iid, inp) {
    const v = inp.value.trim(); if (!v) return;
    findItem(sid, iid).subs.push({ id: newId(), text: v, done: false });
    touch(); render();
    const again = board.querySelector(`.item-wrap[data-iid="${iid}"] .sub-add input`);
    if (again) again.focus();
}
function toggleSub(sid, iid, subId) {
    const s = findItem(sid, iid).subs.find(x => x.id === subId);
    s.done = !s.done; touch(); render();
}
function editSub(sid, iid, subId) {
    editing = { type: 'sub', id: subId, sid: sid, iid: iid };
    expanded[iid] = true;   // 수정 중 항목이 접히지 않게
    render();
}
function delSub(sid, iid, subId) {
    const it = findItem(sid, iid);
    it.subs = it.subs.filter(x => x.id !== subId);
    touch(); render();
}

// ==================== 백업 (내보내기 / 불러오기) ====================
function exportData() {
    const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'silab-업무관리-data_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
}
function importData(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
        try {
            const parsed = JSON.parse(ev.target.result);
            if (!confirm('현재 내용을 불러온 파일로 교체할까요? (기존 초안 파일 형식도 지원)')) return;
            data = parsed; normalize(); touch(); render();
            wlAlert('불러오기 완료!', 'success');
        } catch (err) { wlAlert('불러오기 실패: ' + err.message, 'error'); }
    };
    r.readAsText(f);
    e.target.value = '';
}

// ==================== 인증 ====================
async function loginUser(email, password) {
    try {
        return await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
        if (error.code === 'auth/user-not-found') throw new Error('등록되지 않은 계정입니다.');
        if (error.code === 'auth/wrong-password') throw new Error('비밀번호가 틀렸습니다.');
        if (error.code === 'auth/invalid-email') throw new Error('이메일 형식이 올바르지 않습니다.');
        throw error;
    }
}

function updateAuthUI() {
    const authed = !!currentUser;
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userInfo = document.getElementById('userInfo');
    const userName = document.getElementById('userName');
    if (loginBtn) loginBtn.style.display = authed ? 'none' : 'flex';
    if (logoutBtn) logoutBtn.style.display = authed ? 'flex' : 'none';
    if (userInfo) userInfo.style.display = authed ? 'flex' : 'none';
    if (userName && currentUser) userName.textContent = currentUser.email;
    if (authGate) authGate.style.display = authed ? 'none' : 'flex';
    if (wlApp) wlApp.style.display = authed ? 'block' : 'none';
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    wlApp = document.getElementById('wlApp');
    authGate = document.getElementById('authGate');
    board = document.getElementById('board');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
    } catch (err) {
        console.error('Firebase 초기화 실패', err);
        return;
    }

    auth.onAuthStateChanged(async (user) => {
        if (user && WL_ALLOWED.includes(user.uid)) {
            currentUser = user;
        } else {
            currentUser = null;
            if (user && WL_ALLOWED.indexOf(user.uid) < 0) await auth.signOut();
        }
        updateAuthUI();
        if (currentUser) {
            try { await loadData(); } catch (e) { console.error(e); setSaveStat('dirty', '로드 실패'); wlAlert('데이터 로드 실패: ' + e.message, 'error'); }
        }
    });

    // 로그인 모달
    const loginModal = document.getElementById('loginModal');
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const gateLoginBtn = document.getElementById('gateLoginBtn');
    const loginClose = document.getElementById('loginClose');
    const logoutBtn = document.getElementById('logoutBtn');
    loginBtn && loginBtn.addEventListener('click', () => loginModal.classList.add('open'));
    gateLoginBtn && gateLoginBtn.addEventListener('click', () => loginModal.classList.add('open'));
    loginClose && loginClose.addEventListener('click', () => loginModal.classList.remove('open'));
    loginModal && loginModal.addEventListener('click', e => { if (e.target === loginModal) loginModal.classList.remove('open'); });
    logoutBtn && logoutBtn.addEventListener('click', async () => { await auth.signOut(); wlAlert('로그아웃되었습니다.', 'success'); });
    loginForm && loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await loginUser(document.getElementById('email').value.trim(), document.getElementById('password').value);
            loginModal.classList.remove('open');
            loginForm.reset();
            wlAlert('로그인되었습니다.', 'success');
        } catch (err) { wlAlert(err.message || '로그인 실패', 'error'); }
    });

    // 상단 바
    const saveBtn = document.getElementById('saveBtn');
    saveBtn && saveBtn.addEventListener('click', async () => {
        if (!currentUser) return;
        clearTimeout(saveTimer);
        await saveNow();
        if (!dirty) wlAlert('저장되었습니다.', 'success');
    });
    document.getElementById('expandAllBtn').addEventListener('click', () => expandAll(true));
    document.getElementById('collapseAllBtn').addEventListener('click', () => expandAll(false));
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', importData);
    document.getElementById('addSectionBtn').addEventListener('click', addSection);
    document.getElementById('addSectionOpenBtn').addEventListener('click', () => setAddSectionForm(true));
    document.getElementById('addSectionCancelBtn').addEventListener('click', () => setAddSectionForm(false));
    document.getElementById('newSectionName').addEventListener('keydown', e => {
        if (e.key === 'Enter') addSection();
        else if (e.key === 'Escape') setAddSectionForm(false);
    });

    // 담당자 명단 모달
    document.getElementById('peopleBtn').addEventListener('click', openPeopleModal);
    document.getElementById('peopleClose').addEventListener('click', closePeopleModal);
    document.getElementById('peopleCancelBtn').addEventListener('click', closePeopleModal);
    document.getElementById('peopleSaveBtn').addEventListener('click', savePeople);
    document.getElementById('loadMembersBtn').addEventListener('click', loadMembersToPeople);
    document.getElementById('peopleModal').addEventListener('click', e => { if (e.target === e.currentTarget) closePeopleModal(); });

    // 저장 전에 떠나면 경고
    window.addEventListener('beforeunload', e => {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
});
