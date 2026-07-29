// labnote.js - Lab 노트 (로그인 전용, 원포인트 업무 허브)
// 교수님 초안(test.html)의 트리 메뉴 + 텍스트창 양식 준용. 저장소는 Firebase RTDB `labnote` 노드.
// 구조: 메뉴(group) > 서브탭(item) > 세부(sub). 각 단계 모두 본문(자유 텍스트) 보유.
// 설정값은 config.js 참조 (firebaseConfig, ADMIN_UID, ROOT_UID)

// ==================== 상수 ====================
const LN_ALLOWED = [ADMIN_UID, ROOT_UID];
const LN_PATH = 'labnote';
const LN_BUILD = '14';   // 임베드 iframe 캐시 무력화용 버전 (배포 시 올림)
// 폴더 구조 이전: 예전에 저장된 짧은 링크(budget.html 등)를 새 경로로 매핑
const LN_PAGE_MOVES = {
    'worklog.html': '/worklog/worklog.html', 'worklog-eval.html': '/worklog/worklog-eval.html',
    'member-performance.html': '/member-performance/member-performance.html', 'members.html': '/members/members.html',
    'payroll.html': '/payroll/payroll.html', 'budget.html': '/budget/budget.html', 'performance.html': '/performance/performance.html'
};
function resolveLink(url) { return (url && LN_PAGE_MOVES[url]) ? LN_PAGE_MOVES[url] : url; }
const LN_COLORS = ['#4f46e5', '#0891b2', '#7c3aed', '#dc2626', '#d97706', '#059669', '#db2777', '#65a30d'];

// 첫 사용 시 자동 생성되는 기본 메뉴 (이후 추가/이름변경/삭제/순서변경 자유)
// link: 바깥/내부 페이지 주소 (기본은 클릭 시 오른쪽 본문에 iframe 임베드, openNew:true 면 새 창)
// 상위 계정(ROOT)만 편집 가능한 기본 잠금 메뉴 (이름 기준 최초 1회 마이그레이션)
const LN_OWNER_DEFAULT = ['Lab 세미나', 'Lab 연구논의', '실적평가'];
const LN_DEFAULT_GROUPS = [
    { name: 'Lab 세미나', color: '#4f46e5', ownerOnly: true, items: [] },
    { name: 'Lab 주간보고', color: '#0891b2', items: [] },
    { name: 'Lab 연구논의', color: '#7c3aed', ownerOnly: true, items: [] },
    { name: 'Lab 수시업무', color: '#dc2626', items: [] },
    { name: '논문/특허 관리', color: '#d97706', items: [
        { text: '논문 제출처', link: 'https://docs.google.com/spreadsheets/d/1CERDZ18IWs0fec5M8vcrxFjKkGYHyFBSewjK4MKTU2M/edit?gid=155235501#gid=155235501' }
    ] },
    { name: 'Projects', color: '#059669', items: [] },
    { name: '실적평가', color: '#db2777', ownerOnly: true, items: [
        { text: '개인별 평가', link: '/worklog/worklog-eval.html' },
        { text: '개인별 실적 전반', link: '/member-performance/member-performance.html' }
    ] },
    { name: '기타관리', color: '#65a30d', items: [
        { text: 'Lab 운영정책' },
        { text: 'Lab 구성원', link: '/members/members.html' },
        { text: '학생 인건비', link: '/payroll/payroll.html' },
        { text: 'Lab 예산관리', link: '/budget/budget.html' },
        { text: 'Lab 주소록' }
    ] }
];

// 캘린더 일정 유형과 색 (bg=칸 색, fg=글자 색)
const LN_EV_TYPES = {
    '휴가':   { bg: '#facc15', fg: '#3f3000' },   // 노랑
    '출장':   { bg: '#a3e635', fg: '#1a2e05' },   // 연두
    '세미나': { bg: '#2563eb', fg: '#ffffff' },   // 파랑
    '기타':   { bg: '#1f2328', fg: '#ffffff' }    // 검정
};

// ==================== 전역 상태 ====================
let auth, database;
let currentUser = null;
let data = null;            // { groups:[], calendar:[] }
let dirty = false;
let saveTimer = null;
let saving = false;
let cur = null;             // {type:'group'|'item'|'sub'|'calendar', id?}
let renameId = null;        // 인라인 이름변경 중인 노드 id
const openN = {};           // 트리 펼침 상태 (화면 상태 — 저장 안 함)
let dragSrc = null;         // 드래그 중인 노드 {type,id}
let calY, calM;             // 캘린더 표시 연/월
let evPopCtx = null;        // 일정 팝오버 컨텍스트 {mode:'new'|'edit', id?}

let lnApp, authGate, treeEl, bodyEl;

// ==================== 유틸 ====================
function esc(s) {
    return (typeof escHtml === 'function') ? escHtml(s)
        : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let uidSeq = 0;
function newId(p) { return (p || 'n') + Date.now().toString(36) + (uidSeq++).toString(36); }

function lnAlert(message, type) {
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

function todayStr() {
    const n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}
const LN_DAYS = ['일', '월', '화', '수', '목', '금', '토'];

function stripHtml(h) {
    const d = document.createElement('div');
    d.innerHTML = h || '';
    return (d.innerText || d.textContent || '').trim();
}

// ==================== 정규화 ====================
function normalize() {
    if (!data || typeof data !== 'object') data = {};
    data.groups = toArr(data.groups);
    if (!data.groups.length) data.groups = JSON.parse(JSON.stringify(LN_DEFAULT_GROUPS));
    data.groups.forEach((g, i) => {
        if (!g.id) g.id = newId('g');
        if (!g.name) g.name = '(이름없음)';
        if (!g.color) g.color = LN_COLORS[i % LN_COLORS.length];
        if (typeof g.body !== 'string') g.body = '';
        // 상위 계정 전용 잠금: 값이 없으면 기본 잠금 메뉴 이름으로 최초 1회 판정
        if (typeof g.ownerOnly !== 'boolean') g.ownerOnly = LN_OWNER_DEFAULT.includes(g.name);
        g.items = toArr(g.items).map(it => {
            const o = (typeof it === 'string') ? { text: it } : it;
            if (!o.id) o.id = newId('i');
            o.text = String(o.text || '제목 없음');
            if (typeof o.body !== 'string') o.body = '';
            if (typeof o.link !== 'string') o.link = '';
            // 링크는 기본적으로 본문(iframe)에 표시. openNew=true 인 것만 새 창으로 이동.
            // (구버전 embed 플래그: embed=false 였던 것도 이제 본문 표시가 기본이라 무시)
            o.openNew = !!o.openNew;
            delete o.embed;
            o.subs = toArr(o.subs).map(s => {
                const x = (typeof s === 'string') ? { text: s } : s;
                return { id: x.id || newId('s'), text: String(x.text || ''), name: x.name ? String(x.name) : '', link: (typeof x.link === 'string') ? x.link : '', openNew: !!x.openNew };
            });
            return o;
        });
    });
    const dre = /^\d{4}-\d{2}-\d{2}$/;
    data.calendar = toArr(data.calendar)
        .map(e => {
            const date = (typeof e.date === 'string' && dre.test(e.date)) ? e.date : '';
            let end = (typeof e.end === 'string' && dre.test(e.end)) ? e.end : date;
            if (date && end < date) end = date;   // 종료일이 시작보다 앞이면 보정
            return { id: e.id || newId('e'), date, end, title: String(e.title || ''), type: LN_EV_TYPES[e.type] ? e.type : '기타' };
        })
        .filter(e => e.date && e.title);
}

// ==================== 조회 ====================
function findGroup(id) { return data.groups.find(g => g.id === id); }
function findItem(id) { for (const g of data.groups) { const it = g.items.find(x => x.id === id); if (it) return { g, it }; } return null; }
function findSub(id) { for (const g of data.groups) for (const it of g.items) { const s = it.subs.find(x => x.id === id); if (s) return { g, it, s }; } return null; }

// ==================== 권한(상위 계정 전용 잠금) ====================
// '나'(편집자) = ROOT_UID. 잠긴 메뉴(ownerOnly)는 그 외 계정에게 보기 전용(UI 레벨).
function isOwner() { return !!(currentUser && currentUser.uid === ROOT_UID); }
function groupOfNode(type, id) {
    if (type === 'group') return findGroup(id);
    if (type === 'item') { const r = findItem(id); return r && r.g; }
    const r = findSub(id); return r && r.g;
}
// 이 노드를 지금 사용자가 편집할 수 없으면 true (잠긴 메뉴인데 상위 계정이 아님)
function isLocked(type, id) {
    if (isOwner()) return false;
    const g = groupOfNode(type, id);
    return !!(g && g.ownerOnly);
}
function subName(s) { return s.name || stripHtml(s.text).split('\n')[0].trim() || '세부'; }

// ==================== 저장 / 불러오기 ====================
// [동시편집 충돌 방지] 본문 내용은 노드 id별 경로(labnote/bodies/{id})에 개별 저장한다.
// 여러 명이 서로 다른 서브탭을 편집해도 서로 다른 경로에 기록되므로 덮어쓰기가 없다.
//  - 본문(그룹/서브탭 body, 세부 text)  → touchBody(id) → labnote/bodies/{id}
//  - 트리 뼈대(이름·순서·색·링크·잠금)   → touchStruct() → labnote/groups (본문 텍스트 제외)
//  - 캘린더                              → touchCal()   → labnote/calendar
const pendingBodies = new Set();   // 저장 대기 중인 본문 노드 id
let structDirty = false;           // 트리 뼈대 변경 대기
let calDirty = false;              // 캘린더 변경 대기

function setSaveStat(state, text) {
    const dot = document.getElementById('saveDot');
    const t = document.getElementById('saveText');
    if (dot) dot.className = 'wl-dot' + (state ? ' ' + state : '');
    if (t) t.textContent = text;
}
function hhmm(n) { return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0'); }

// 본문 텍스트를 뺀 트리 뼈대 (구조 저장용) — 본문은 bodies 경로에 따로 있으므로 여기서 제외
function skeleton() {
    return data.groups.map(g => ({
        id: g.id, name: g.name, color: g.color, ownerOnly: !!g.ownerOnly,
        items: g.items.map(it => ({
            id: it.id, text: it.text, link: it.link || '', openNew: !!it.openNew,
            subs: it.subs.map(s => ({ id: s.id, name: s.name || '', link: s.link || '', openNew: !!s.openNew }))
        }))
    }));
}
// 노드 id → 현재 본문 텍스트 (그룹/서브탭은 body, 세부는 text)
function bodyText(id) {
    for (const g of data.groups) {
        if (g.id === id) return g.body || '';
        for (const it of g.items) {
            if (it.id === id) return it.body || '';
            for (const s of it.subs) if (s.id === id) return s.text || '';
        }
    }
    return null;
}
// 전체 본문 맵 (마이그레이션·불러오기 교체용)
function bodiesMap() {
    const m = {};
    data.groups.forEach(g => {
        m[g.id] = g.body || '';
        g.items.forEach(it => { m[it.id] = it.body || ''; it.subs.forEach(s => m[s.id] = s.text || ''); });
    });
    return m;
}
// 삭제될 노드와 그 하위의 모든 id (bodies 정리용) — 삭제 전에 호출
function subtreeIds(type, id) {
    const ids = [];
    if (type === 'group') { const g = findGroup(id); if (g) { ids.push(g.id); g.items.forEach(it => { ids.push(it.id); it.subs.forEach(s => ids.push(s.id)); }); } }
    else if (type === 'item') { const r = findItem(id); if (r) { ids.push(r.it.id); r.it.subs.forEach(s => ids.push(s.id)); } }
    else { const r = findSub(id); if (r) ids.push(r.s.id); }
    return ids;
}

function scheduleSave() {
    dirty = pendingBodies.size > 0 || structDirty || calDirty;
    if (dirty) setSaveStat('dirty', '저장 중...');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
}
function touchBody(id) { if (id) pendingBodies.add(id); scheduleSave(); }   // 본문 내용 편집
function touchStruct() { structDirty = true; scheduleSave(); }               // 트리 구조 변경
function touchCal() { calDirty = true; scheduleSave(); }                     // 캘린더 변경
function touch() { touchStruct(); }   // 구조 변경 호출부 호환용 별칭

// 예약된 변경분을 경로별로 한 번의 update로 기록 (본문은 id별 경로라 서로 안 덮어씀)
async function flushSave() {
    if (!currentUser || !data || saving) return;
    if (!pendingBodies.size && !structDirty && !calDirty) return;
    saving = true;
    const bodyIds = [...pendingBodies]; pendingBodies.clear();
    const doStruct = structDirty; structDirty = false;
    const doCal = calDirty; calDirty = false;
    const upd = {};
    bodyIds.forEach(id => { const t = bodyText(id); if (t !== null) upd['bodies/' + id] = t; });
    if (doStruct) upd['groups'] = skeleton();
    if (doCal) upd['calendar'] = data.calendar || [];
    try {
        await database.ref(LN_PATH).update(upd);
        dirty = pendingBodies.size > 0 || structDirty || calDirty;   // 저장 중 새로 생긴 변경분
        if (!dirty) setSaveStat('linked', '저장됨 ' + hhmm(new Date()));
    } catch (err) {
        bodyIds.forEach(id => pendingBodies.add(id));   // 실패분 되돌려 재시도
        if (doStruct) structDirty = true;
        if (doCal) calDirty = true;
        dirty = true;
        setSaveStat('dirty', '저장 실패');
        lnAlert('저장 실패: ' + err.message, 'error');
    } finally {
        saving = false;
        if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 800); }
    }
}

// 불러오기로 전체 교체 시: 뼈대·본문·캘린더를 통째로 기록 (구버전 데이터 정리 포함)
async function saveEverything() {
    if (!currentUser || !data) return;
    try {
        await database.ref(LN_PATH).update({ groups: skeleton(), bodies: bodiesMap(), calendar: data.calendar || [], bodiesMigrated: true });
        pendingBodies.clear(); structDirty = false; calDirty = false; dirty = false;
        setSaveStat('linked', '저장됨 ' + hhmm(new Date()));
    } catch (err) {
        setSaveStat('dirty', '저장 실패');
        lnAlert('저장 실패: ' + err.message, 'error');
    }
}

// 최초 1회: 트리 안에 들어있던 본문을 id별 bodies 경로로 안전 복사 (데이터 손실 없음)
async function migrateBodies() {
    try { await database.ref(LN_PATH).update({ bodies: bodiesMap(), bodiesMigrated: true }); }
    catch (e) { console.error('bodies 마이그레이션 실패', e); }
}
// bodies 맵을 인메모리 노드 본문에 병합 (id별 본문 우선, 없으면 뼈대에 남은 구버전 본문 유지)
function mergeBodies(bodies) {
    if (!bodies || typeof bodies !== 'object') return;
    data.groups.forEach(g => {
        if (typeof bodies[g.id] === 'string') g.body = bodies[g.id];
        g.items.forEach(it => {
            if (typeof bodies[it.id] === 'string') it.body = bodies[it.id];
            it.subs.forEach(s => { if (typeof bodies[s.id] === 'string') s.text = bodies[s.id]; });
        });
    });
}

async function loadData() {
    setSaveStat('', '불러오는 중...');
    // 경로별 개별 읽기 — 본문(bodies)은 id별로 저장되므로 groups(뼈대)와 나눠 읽고 병합
    const [gSnap, bSnap, cSnap, mSnap] = await Promise.all([
        database.ref(LN_PATH + '/groups').once('value'),
        database.ref(LN_PATH + '/bodies').once('value'),
        database.ref(LN_PATH + '/calendar').once('value'),
        database.ref(LN_PATH + '/bodiesMigrated').once('value')
    ]);
    data = { groups: gSnap.val(), calendar: cSnap.val() };
    normalize();
    mergeBodies(bSnap.val());
    // 아직 마이그레이션 전이면 현재 본문을 bodies 경로로 1회 복사 (이후 구조 저장이 본문을 지워도 안전)
    if (!mSnap.val()) await migrateBodies();
    dirty = false;
    setSaveStat('linked', '동기화됨');
    // 처음엔 메뉴(그룹)만 펼쳐 전체가 한눈에 들어오게
    data.groups.forEach(g => { if (!(g.id in openN)) openN[g.id] = true; });
    // 첫 화면도 메뉴를 클릭한 것과 같은 크기로 — 첫 메뉴를 자동 선택
    if (!cur && data.groups[0]) cur = { type: 'group', id: data.groups[0].id };
    render();
    showBody();
}

// ==================== 트리 렌더 ====================
function render() {
    if (!treeEl) return;
    treeEl.innerHTML = '';
    if (!data || !data.groups.length) {
        treeEl.innerHTML = '<div class="ln-menu-empty">＋ 메뉴 추가로 시작하세요.</div>';
        return;
    }
    data.groups.forEach((g, gi) => {
        const gLocked = !!g.ownerOnly && !isOwner();   // 이 메뉴가 지금 사용자에게 잠겼는가
        const gEl = document.createElement('div');
        gEl.className = 'ln-grp' + (openN[g.id] !== false ? ' open' : '');
        gEl.appendChild(rowEl({
            type: 'group', node: g, cls: 'ln-g-head', sel: cur && cur.type === 'group' && cur.id === g.id,
            label: g.name, num: String(gi + 1), count: g.items.length, locked: gLocked, ownerOnly: g.ownerOnly,
            onToggle: () => toggleN(g.id), onSelect: () => select('group', g.id)
        }));
        const cg = document.createElement('div'); cg.className = 'ln-children-g';
        g.items.forEach((it, ii) => {
            const iEl = document.createElement('div'); iEl.className = 'ln-itm' + (openN[it.id] ? ' open' : '');
            iEl.appendChild(rowEl({
                type: 'item', node: it, cls: 'ln-i-head', sel: cur && cur.type === 'item' && cur.id === it.id,
                label: it.text, num: (gi + 1) + '-' + (ii + 1), count: it.subs.length, link: it.link, openNew: it.openNew, locked: gLocked,
                onToggle: () => toggleN(it.id), onSelect: () => select('item', it.id)
            }));
            const ci = document.createElement('div'); ci.className = 'ln-children-i';
            it.subs.forEach((s, si) => {
                ci.appendChild(rowEl({
                    type: 'sub', node: s, cls: 'ln-s-head', sel: cur && cur.type === 'sub' && cur.id === s.id,
                    label: subName(s), num: (gi + 1) + '-' + (ii + 1) + '-' + (si + 1), leaf: true, link: s.link, openNew: s.openNew, locked: gLocked,
                    onSelect: () => select('sub', s.id)
                }));
            });
            iEl.appendChild(ci); cg.appendChild(iEl);
        });
        gEl.appendChild(cg); treeEl.appendChild(gEl);
    });
    // 하단 고정 메뉴(캘린더) 활성 표시
    const calBtn = document.getElementById('calendarMenuBtn');
    if (calBtn) calBtn.classList.toggle('active', !!(cur && cur.type === 'calendar'));
}

function rowEl(o) {
    const row = document.createElement('div');
    row.className = 'ln-row ' + o.cls + (o.sel ? ' active' : '')
        + ((!o.leaf && o.type === 'group' && openN[o.node.id] !== false) ? ' open' : '')
        + ((!o.leaf && o.type === 'item' && openN[o.node.id]) ? ' open' : '');
    row.dataset.type = o.type; row.dataset.id = o.node.id;

    // 드래그 (이름변경 중이 아니고, 잠기지 않은 경우만)
    if (renameId !== o.node.id && !o.locked) {
        row.draggable = true;
        row.ondragstart = e => { dragSrc = { type: o.type, id: o.node.id }; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.node.id); };
        row.ondragend = () => { row.classList.remove('dragging'); clearDropMarks(); };
        row.ondragover = e => onDragOver(e, row, o.type, o.node.id);
        row.ondragleave = () => row.classList.remove('drop-before', 'drop-after', 'drop-into');
        row.ondrop = e => onDrop(e, row, o.type, o.node.id);
    }

    // caret (leaf 제외)
    if (!o.leaf) {
        const c = document.createElement('span'); c.className = 'caret'; c.textContent = '▶';
        c.onclick = e => { e.stopPropagation(); o.onToggle(); };
        row.appendChild(c);
    } else {
        const sp = document.createElement('span'); sp.className = 'caret'; sp.style.visibility = 'hidden'; sp.textContent = '•'; row.appendChild(sp);
    }
    // 번호 (1 / 1-1 / 1-1-1) — 점 대신 순서 번호
    if (o.num) { const nm = document.createElement('span'); nm.className = 'ln-num'; nm.textContent = o.num; row.appendChild(nm); }

    // 라벨 또는 이름변경 입력칸
    if (renameId === o.node.id) {
        const inp = document.createElement('input'); inp.className = 'ln-rename'; inp.value = o.label;
        inp.onclick = e => e.stopPropagation();
        inp.onkeydown = e => { if (e.key === 'Enter') commitRename(o.type, o.node.id, inp.value); if (e.key === 'Escape') { renameId = null; render(); } };
        inp.onblur = () => commitRename(o.type, o.node.id, inp.value);
        row.appendChild(inp);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
    } else {
        const lb = document.createElement('span'); lb.className = 'label';
        lb.textContent = o.label;
        if (o.link) { const ic = document.createElement('i'); ic.className = o.openNew ? 'fas fa-external-link-alt' : 'fas fa-desktop'; lb.appendChild(ic); }
        // 링크: 기본은 본문에 표시(select), openNew면 새 창/페이지 이동
        lb.onclick = () => { if (o.link && o.openNew) openLink(o.link); else o.onSelect(); };
        row.appendChild(lb);
        if (o.count !== undefined) { const cnt = document.createElement('span'); cnt.className = 'cnt'; cnt.textContent = o.count; cnt.onclick = o.onSelect; row.appendChild(cnt); }
    }

    // 잠금 메뉴(상위 계정 전용, 비소유자): 편집 ⋯메뉴 숨김. 아이콘은 메뉴 머리행에만.
    if (o.locked) {
        if (o.type === 'group') {
            const lk = document.createElement('span'); lk.className = 'ln-lock'; lk.title = '상위 계정만 편집 가능 (보기 전용)';
            lk.innerHTML = '<i class="fas fa-lock"></i>';
            row.appendChild(lk);
        }
        return row;
    }
    // 소유자에게는 잠긴 메뉴 머리행에 표시 아이콘 (편집은 가능)
    if (o.ownerOnly && o.type === 'group' && isOwner()) {
        const lk = document.createElement('span'); lk.className = 'ln-lock owner'; lk.title = '상위 계정 전용 메뉴 (다른 관리자는 보기 전용)';
        lk.innerHTML = '<i class="fas fa-lock"></i>';
        row.appendChild(lk);
    }

    // ... 메뉴
    const kb = document.createElement('button'); kb.className = 'ln-kebab'; kb.textContent = '⋯'; kb.title = '메뉴';
    kb.onclick = e => { e.stopPropagation(); openPop(e.currentTarget, o.type, o.node.id); };
    row.appendChild(kb);
    return row;
}

// 링크 열기: 외부(http)는 새 탭, 내부 페이지는 현재 탭에서 이동
function openLink(url) {
    url = resolveLink(url);
    if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
}

// 임베드용 주소: 외부는 그대로, 내부 페이지는 ?embed=1(네비/푸터 숨김) + _v(캐시 무력화)
function embedSrc(url) {
    url = resolveLink(url);
    if (/^https?:\/\//i.test(url)) return url;
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    const q = 'embed=1&_v=' + LN_BUILD;
    const h = url.indexOf('#');
    return h >= 0 ? url.slice(0, h) + sep + q + url.slice(h) : url + sep + q;
}

function toggleN(id) { openN[id] = (openN[id] === false) ? true : !openN[id]; if (openN[id] === undefined) openN[id] = true; render(); }
function expandAll(open) { data.groups.forEach(g => { openN[g.id] = open; g.items.forEach(it => openN[it.id] = open); }); render(); }

// ==================== 팝업(...) 메뉴 ====================
function openPop(btn, type, id) {
    const pop = document.getElementById('lnPop'); pop.innerHTML = '';
    const add = (label, fn, cls) => { const b = document.createElement('button'); if (cls) b.className = cls; b.innerHTML = label; b.onclick = () => { closePop(); fn(); }; pop.appendChild(b); };
    const sep = () => { const s = document.createElement('div'); s.className = 'sep'; pop.appendChild(s); };

    if (isLocked(type, id)) return;   // 잠긴 메뉴는 편집 팝업 자체를 열지 않음
    const node = type === 'group' ? findGroup(id) : type === 'item' ? (findItem(id) || {}).it : (findSub(id) || {}).s;
    if (!node) return;

    // 상위 계정만: 메뉴 잠금/해제 토글
    if (type === 'group' && isOwner()) {
        add(node.ownerOnly ? '🔓 공동 편집으로 (잠금 해제)' : '🔒 나만 편집 (잠금)', () => {
            node.ownerOnly = !node.ownerOnly; touch(); render();
        });
        sep();
    }

    if (type === 'group') add('➕ 서브탭 추가', () => addChild('group', id));
    if (type === 'item') add('➕ 세부 추가', () => addChild('item', id));
    add('✏️ 이름 바꾸기', () => startRename(id));
    if (type !== 'group') {
        add(node.link ? '🔗 링크 수정' : '🔗 링크 지정', () => setLink(type, id));
        if (node.link) {
            add(node.openNew ? '🖥️ 본문에 표시로 전환' : '↗️ 새 창으로 열기로 전환', () => {
                node.openNew = !node.openNew; touch(); render(); if (cur && cur.id === id) showBody();
            });
            add('⛓️ 링크 해제', () => { node.link = ''; node.openNew = false; touch(); render(); if (cur && cur.id === id) showBody(); });
        }
    }
    sep();
    add('🗑️ 삭제', () => del(type, id), 'danger');

    const r = btn.getBoundingClientRect();
    pop.style.display = 'block';
    let left = r.right - 4, top = r.bottom + 4;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    if (left + pw > window.innerWidth - 8) left = r.left - pw + 22;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 4;
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = Math.max(8, top) + 'px';
}
function closePop() { document.getElementById('lnPop').style.display = 'none'; }

// 링크 지정: 외부 URL 또는 내부 페이지(예: budget.html)
function setLink(type, id) {
    const node = type === 'item' ? findItem(id).it : findSub(id).s;
    const v = prompt('연결할 주소를 입력하세요.\n(외부: https://... / 내부 페이지: budget.html 등, 비우면 해제)', node.link || '');
    if (v === null) return;
    node.link = v.trim();
    touch(); render();
    if (cur && cur.id === id) showBody();
}

// ==================== 편집 동작 ====================
function addGroup() {
    const g = { id: newId('g'), name: '새 메뉴', color: LN_COLORS[data.groups.length % LN_COLORS.length], items: [], body: '' };
    data.groups.push(g); openN[g.id] = true; touch(); startRename(g.id); render();
}
function addChild(type, id) {
    if (type === 'group') {
        const g = findGroup(id);
        const it = { id: newId('i'), text: '새 서브탭', body: '', link: '', subs: [] };
        g.items.push(it); openN[g.id] = true; openN[it.id] = true; touch(); startRename(it.id); render();
    } else {
        const r = findItem(id);
        const s = { id: newId('s'), name: '새 세부', text: '', link: '' };
        r.it.subs.push(s); openN[r.it.id] = true; touch(); startRename(s.id); render();
    }
}
function startRename(id) { renameId = id; render(); }
function commitRename(type, id, val) {
    val = (val || '').trim(); renameId = null;
    if (val) {
        if (type === 'group') findGroup(id).name = val;
        else if (type === 'item') findItem(id).it.text = val;
        else findSub(id).s.name = val;
        touch();
    }
    render();
    if (cur && cur.id === id) showBody();
}
function del(type, id) {
    const kind = type === 'group' ? '메뉴' : type === 'item' ? '서브탭' : '세부';
    if (!confirm('이 ' + kind + '을(를) 삭제할까요? 하위 내용과 본문도 함께 삭제됩니다.')) return;
    const gone = subtreeIds(type, id);   // 삭제 전에 하위 id 수집 (bodies 정리용)
    if (type === 'group') data.groups = data.groups.filter(g => g.id !== id);
    else if (type === 'item') { const r = findItem(id); r.g.items = r.g.items.filter(x => x.id !== id); }
    else { const r = findSub(id); r.it.subs = r.it.subs.filter(x => x.id !== id); }
    // 삭제된 노드들의 본문(bodies/{id})도 제거해 잔여 데이터가 남지 않게
    gone.forEach(bid => { pendingBodies.delete(bid); database.ref(LN_PATH + '/bodies/' + bid).remove().catch(() => {}); });
    if (cur && cur.id === id) { cur = null; showBody(); }
    touch(); render();
}

// ==================== 드래그 순서변경 ====================
function clearDropMarks() { document.querySelectorAll('.ln-row.drop-before,.ln-row.drop-after,.ln-row.drop-into').forEach(r => r.classList.remove('drop-before', 'drop-after', 'drop-into')); }
function locate(type, id) {
    if (type === 'group') { const arr = data.groups; const i = arr.findIndex(x => x.id === id); return i < 0 ? null : { arr, idx: i, node: arr[i] }; }
    if (type === 'item') { const r = findItem(id); if (!r) return null; const arr = r.g.items; return { arr, idx: arr.indexOf(r.it), node: r.it }; }
    const r = findSub(id); if (!r) return null; const arr = r.it.subs; return { arr, idx: arr.indexOf(r.s), node: r.s };
}
function dropKind(dragType, rowType) {
    if (dragType === rowType) return 'reorder';
    if (dragType === 'item' && rowType === 'group') return 'into';   // 서브탭을 다른 메뉴로
    if (dragType === 'sub' && rowType === 'item') return 'into';     // 세부를 다른 서브탭으로
    return null;
}
function onDragOver(e, row, rowType, rowId) {
    if (!dragSrc) return;
    const kind = dropKind(dragSrc.type, rowType);
    if (!kind) return;
    if (dragSrc.type === rowType && dragSrc.id === rowId) return;   // 자기 자신
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    row.classList.remove('drop-before', 'drop-after', 'drop-into');
    if (kind === 'into') row.classList.add('drop-into');
    else { const r = row.getBoundingClientRect(); row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before'); }
}
function onDrop(e, row, rowType, rowId) {
    if (!dragSrc) return;
    const kind = dropKind(dragSrc.type, rowType); if (!kind) { clearDropMarks(); return; }
    e.preventDefault(); e.stopPropagation();
    const after = row.classList.contains('drop-after');
    clearDropMarks();
    const src = locate(dragSrc.type, dragSrc.id); if (!src) { dragSrc = null; return; }
    const node = src.node;
    if (kind === 'into') {
        let destArr;
        if (rowType === 'group') { const g = findGroup(rowId); if (!g) return; destArr = g.items; openN[g.id] = true; }
        else { const r = findItem(rowId); if (!r) return; destArr = r.it.subs; openN[r.it.id] = true; }
        if (destArr === src.arr) { dragSrc = null; return; }   // 같은 부모면 무시
        src.arr.splice(src.idx, 1);
        destArr.push(node);
    } else {
        src.arr.splice(src.idx, 1);
        const tgt = locate(rowType, rowId); if (!tgt) { src.arr.splice(src.idx, 0, node); dragSrc = null; return; }
        tgt.arr.splice(tgt.idx + (after ? 1 : 0), 0, node);
    }
    dragSrc = null; touch(); render();
}

// ==================== 본문 (텍스트 편집창) ====================
function select(type, id) { cur = { type, id }; showBody(); render(); }

function bodyOf() {
    if (!cur || cur.type === 'calendar') return null;
    if (cur.type === 'group') { const g = findGroup(cur.id); return g && { crumb: '', title: g.name, link: '', openNew: false, val: g.body || '', set: v => g.body = v }; }
    if (cur.type === 'item') { const r = findItem(cur.id); return r && { crumb: r.g.name, title: r.it.text, link: r.it.link, openNew: r.it.openNew, val: r.it.body || '', set: v => r.it.body = v }; }
    const r = findSub(cur.id); return r && { crumb: r.g.name + ' › ' + r.it.text, title: subName(r.s), link: r.s.link, openNew: r.s.openNew, val: r.s.text || '', set: v => r.s.text = v };
}

// 편집창 글자 크기 (브라우저 확대/축소와 별개로 편집창만 조절, 기기별 저장)
function edFontSize() { const v = Number(localStorage.getItem('ln_edfs')); return (v >= 12 && v <= 24) ? v : 15; }
function setEdFontSize(px) {
    px = Math.min(24, Math.max(12, px));
    try { localStorage.setItem('ln_edfs', String(px)); } catch (e) {}
    const ed = document.getElementById('lnEditor');
    if (ed) ed.style.fontSize = px + 'px';
    const lb = document.getElementById('edFsLbl');
    if (lb) lb.textContent = px + 'px';
}

function showBody() {
    if (!bodyEl) return;
    // 임베드 전체 폭 상태 초기화 (텍스트/캘린더로 가면 원래 폭 복귀)
    const app = document.getElementById('lnApp');
    if (app) app.classList.remove('ln-embed-full');
    document.body.classList.remove('ln-embed-body');
    if (cur && cur.type === 'calendar') { renderCalendar(); return; }
    const b = bodyOf();
    if (!b) { bodyEl.innerHTML = '<div class="ln-placeholder">왼쪽 메뉴에서 항목을 선택하세요.</div>'; return; }

    // 링크 항목: 기본은 본문에 iframe 임베드(브라우저 전체 폭), openNew면 바로가기 카드('열기' 버튼)
    if (b.link && !b.openNew) {
        if (app) app.classList.add('ln-embed-full');   // 메뉴 유지 + 전체 폭
        document.body.classList.add('ln-embed-body');
        bodyEl.innerHTML =
            '<div class="ln-title ln-title-row"><span>' + esc(b.title) + '</span>' +
            '<button class="wl-btn" id="lnFs" title="브라우저 전체 화면으로 크게 보기"><i class="fas fa-expand"></i> 전체화면</button>' +
            '<button class="wl-btn" id="lnNewTab" title="새 탭으로 열기"><i class="fas fa-external-link-alt"></i> 새 탭</button></div>' +
            '<div class="ln-embed-wrap" id="lnEmbedWrap">' +
            '  <button class="wl-btn ln-fs-close" id="lnFsClose" title="전체화면 닫기"><i class="fas fa-compress"></i> 닫기</button>' +
            '  <iframe class="ln-embed" id="lnEmbed" src="' + esc(embedSrc(b.link)) + '" referrerpolicy="no-referrer-when-downgrade"></iframe>' +
            '</div>' +
            '<div class="ln-embed-note">화면이 비어 있으면(외부 사이트 보안 정책) <a href="#" id="lnNote">새 탭으로 열기</a>를 눌러주세요.</div>';
        const wrap = document.getElementById('lnEmbedWrap');
        document.getElementById('lnFs').onclick = () => wrap.classList.add('fs');
        document.getElementById('lnFsClose').onclick = () => wrap.classList.remove('fs');
        document.getElementById('lnNewTab').onclick = () => openLink(b.link);
        document.getElementById('lnNote').onclick = e => { e.preventDefault(); openLink(b.link); };
        return;
    }
    if (b.link) {
        bodyEl.innerHTML =
            (b.crumb ? '<div class="ln-crumb">' + esc(b.crumb) + '</div>' : '') +
            '<div class="ln-title">' + esc(b.title) + '</div>' +
            '<div class="ln-linkbox"><i class="fas fa-external-link-alt"></i> 이 항목은 바로가기 링크입니다.' +
            '<br><a href="#" id="lnLinkGo">열기</a>' +
            '<span class="url">' + esc(b.link) + '</span></div>';
        document.getElementById('lnLinkGo').onclick = e => { e.preventDefault(); openLink(b.link); };
        return;
    }

    // 잠긴 메뉴(상위 계정 전용, 비소유자): 보기 전용 — 툴바/입력 없이 내용만 표시
    if (cur && isLocked(cur.type, cur.id)) {
        bodyEl.innerHTML =
            (b.crumb ? '<div class="ln-crumb">' + esc(b.crumb) + '</div>' : '') +
            '<div class="ln-title">' + esc(b.title) + ' <span class="ln-ro-badge"><i class="fas fa-lock"></i> 보기 전용</span></div>' +
            '<div class="ln-readonly">' + (b.val || '<span class="ln-ro-empty">내용 없음</span>') + '</div>';
        return;
    }

    bodyEl.innerHTML =
        (b.crumb ? '<div class="ln-crumb">' + esc(b.crumb) + '</div>' : '') +
        '<div class="ln-title ln-title-row"><span>' + esc(b.title) + '</span>' +
        '  <span class="wl-savestat" id="bodySaveStat"></span>' +
        '  <button class="wl-btn primary" id="lnSaveOne" title="이 항목 내용만 저장 (다른 사람 작업과 충돌 없이)"><i class="fas fa-save"></i> 저장</button></div>' +
        '<div class="ln-toolbar">' +
        '  <button class="ln-tb date-btn" title="맨 위에 오늘 날짜 머리글 추가 (최근 날짜가 위로)" data-cmd="date">📅 오늘 날짜</button>' +
        '  <span class="ln-sep"></span>' +
        '  <button class="ln-tb" title="굵게" data-cmd="bold"><b>B</b></button>' +
        '  <button class="ln-tb" title="밑줄" data-cmd="underline"><u>U</u></button>' +
        '  <button class="ln-tb" title="취소선" data-cmd="strikeThrough"><s>S</s></button>' +
        '  <span class="ln-sep"></span>' +
        '  <span class="ln-lbl">크기</span>' +
        '  <select class="ln-tb-sel" id="fontSel" title="선택한 글자 크기">' +
        '    <option value="2">작게</option><option value="3" selected>보통</option><option value="4">크게</option><option value="5">아주 크게</option>' +
        '  </select>' +
        '  <span class="ln-sep"></span>' +
        '  <span class="ln-lbl">글자</span>' +
        '  <button class="ln-tb swatch" style="background:#1f2328" title="검정" data-color="#1f2328">.</button>' +
        '  <button class="ln-tb swatch" style="background:#2563eb" title="파랑" data-color="#2563eb">.</button>' +
        '  <button class="ln-tb swatch" style="background:#dc2626" title="빨강" data-color="#dc2626">.</button>' +
        '  <span class="ln-sep"></span>' +
        '  <span class="ln-lbl">배경</span>' +
        '  <button class="ln-tb swatch" style="background:#fef08a" title="노랑" data-bg="#fef08a">.</button>' +
        '  <button class="ln-tb swatch" style="background:#d9f99d" title="연두" data-bg="#d9f99d">.</button>' +
        '  <button class="ln-tb swatch" style="background:#ffffff;border-color:#cbd5e1" title="지움(흰색)" data-bg="#ffffff">.</button>' +
        '  <span class="ln-sep"></span>' +
        '  <button class="ln-tb" title="서식 지우기" data-cmd="removeFormat">서식↺</button>' +
        '  <span class="wl-spacer"></span>' +
        '  <span class="ln-lbl">편집창</span>' +
        '  <button class="ln-tb" title="편집창 글자 작게" data-cmd="zoomOut">A−</button>' +
        '  <span class="ln-lbl" id="edFsLbl"></span>' +
        '  <button class="ln-tb" title="편집창 글자 크게" data-cmd="zoomIn">A＋</button>' +
        '</div>' +
        '<div class="ln-editor" id="lnEditor" contenteditable="true" spellcheck="false" data-ph="내용을 자유롭게 기재하세요. (서식·글자크기는 붙여넣기 시에도 유지됩니다)"></div>';

    const ed = document.getElementById('lnEditor');
    ed.innerHTML = b.val || '';
    ed.style.fontSize = edFontSize() + 'px';
    setEdFontSize(edFontSize());
    ed.oninput = () => { b.set(ed.innerHTML); touchBody(cur && cur.id); if (cur && cur.type === 'sub') refreshLabel(); };

    // 이 항목만 저장 (해당 노드의 본문 경로만 기록 — 다른 사람이 편집 중인 서브탭과 충돌 없음)
    const saveOne = document.getElementById('lnSaveOne');
    if (saveOne) saveOne.onclick = async () => {
        if (!currentUser || !cur || !cur.id) return;
        b.set(ed.innerHTML);
        pendingBodies.add(cur.id);
        clearTimeout(saveTimer);
        const stat = document.getElementById('bodySaveStat');
        if (stat) stat.textContent = '저장 중...';
        await flushSave();
        if (stat) stat.textContent = pendingBodies.has(cur.id) ? '저장 실패' : '저장됨 ' + hhmm(new Date());
        if (!pendingBodies.has(cur.id)) lnAlert('저장되었습니다.', 'success');
    };

    // 툴바 동작
    bodyEl.querySelector('.ln-toolbar').addEventListener('mousedown', e => {
        if (e.target.closest('.ln-tb')) e.preventDefault();   // 에디터 선택영역 유지
    });
    bodyEl.querySelector('.ln-toolbar').addEventListener('click', e => {
        const btn = e.target.closest('.ln-tb'); if (!btn) return;
        const cmd = btn.dataset.cmd;
        if (cmd === 'date') return insertDateHeading();
        if (cmd === 'zoomIn') return setEdFontSize(edFontSize() + 1);
        if (cmd === 'zoomOut') return setEdFontSize(edFontSize() - 1);
        ed.focus();
        if (btn.dataset.color) { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, btn.dataset.color); }
        else if (btn.dataset.bg) { document.execCommand('styleWithCSS', false, true); if (!document.execCommand('hiliteColor', false, btn.dataset.bg)) document.execCommand('backColor', false, btn.dataset.bg); }
        else if (cmd) document.execCommand(cmd, false, null);
        rtSync();
    });
    document.getElementById('fontSel').addEventListener('change', e => {
        ed.focus();
        document.execCommand('styleWithCSS', false, false);
        document.execCommand('fontSize', false, e.target.value);
        rtSync();
    });
}

// 오늘 날짜 머리글을 본문 맨 위에 삽입 — 주간보고 등에서 '최근 날짜가 위로' 규칙 유지용
function insertDateHeading() {
    const ed = document.getElementById('lnEditor'); if (!ed) return;
    const n = new Date();
    const label = todayStr() + ' (' + LN_DAYS[n.getDay()] + ')';
    const hadContent = !!ed.firstChild;
    const head = document.createElement('div');
    head.innerHTML = '<b>■ ' + esc(label) + '</b>';
    const line = document.createElement('div');   // 날짜 아래 빈 줄 (여기에 커서)
    line.innerHTML = '<br>';
    ed.insertBefore(head, ed.firstChild);         // 맨 위에 날짜 머리글
    ed.insertBefore(line, head.nextSibling);      // 그 아래 빈 줄
    if (hadContent) {                             // 기존 내용이 있으면 구분 빈 줄 하나 더
        const gap = document.createElement('div'); gap.innerHTML = '<br>';
        ed.insertBefore(gap, line.nextSibling);
    }
    ed.focus();
    const sel = window.getSelection(); const rg = document.createRange();
    rg.setStart(line, 0); rg.collapse(true);
    sel.removeAllRanges(); sel.addRange(rg);
    rtSync();
}

function rtSync() {
    const ed = document.getElementById('lnEditor'); const b = bodyOf();
    if (ed && b) { b.set(ed.innerHTML); touchBody(cur && cur.id); if (cur && cur.type === 'sub') refreshLabel(); }
}

// 세부 이름이 본문 첫 줄에서 파생될 때 메뉴 라벨만 갱신 (에디터 포커스 유지)
let _lblTimer = null;
function refreshLabel() {
    clearTimeout(_lblTimer);
    _lblTimer = setTimeout(() => {
        const r = findSub(cur.id); if (!r || r.s.name) return;
        document.querySelectorAll('#lnTree .ln-row.ln-s-head.active .label').forEach(l => l.textContent = subName(r.s));
    }, 400);
}

// ==================== Lab 캘린더 ====================
function selectCalendar() {
    cur = { type: 'calendar' };
    const n = new Date();
    if (calY == null) { calY = n.getFullYear(); calM = n.getMonth(); }
    showBody(); render();
}

function calMove(d) {
    calM += d;
    if (calM < 0) { calM = 11; calY--; }
    if (calM > 11) { calM = 0; calY++; }
    renderCalendar();
}

function renderCalendar() {
    const today = todayStr();
    const first = new Date(calY, calM, 1);
    const startDow = first.getDay();
    const dim = new Date(calY, calM + 1, 0).getDate();
    const dimPrev = new Date(calY, calM, 0).getDate();

    let legend = '';
    Object.keys(LN_EV_TYPES).forEach(t => { legend += '<span class="lg"><i style="background:' + LN_EV_TYPES[t].bg + '"></i>' + t + '</span>'; });

    let html =
        '<div class="ln-cal-head">' +
        '  <button class="ln-cal-nav" id="calPrev" title="이전 달">◀</button>' +
        '  <h2>' + calY + '년 ' + (calM + 1) + '월</h2>' +
        '  <button class="ln-cal-nav" id="calNext" title="다음 달">▶</button>' +
        '  <button class="wl-btn" id="calToday" style="padding:5px 11px;font-size:12.5px;">오늘</button>' +
        '  <div class="ln-cal-legend">' + legend + '</div>' +
        '</div>' +
        '<div class="ln-cal-hint">날짜 칸을 클릭하면 일정을 추가하고(시작일~종료일 지정 가능), 일정을 클릭하면 수정/삭제할 수 있습니다.</div>' +
        '<table class="ln-cal"><thead><tr>';
    LN_DAYS.forEach((d, i) => { html += '<th class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + d + '</th>'; });
    html += '</tr></thead><tbody>';

    // 시작일 순으로 정렬 (여러 날 일정은 걸치는 날마다 표시)
    const cal = (data.calendar || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

    let day = 1 - startDow;
    for (let w = 0; w < 6; w++) {
        if (day > dim) break;
        html += '<tr>';
        for (let dow = 0; dow < 7; dow++, day++) {
            let y = calY, m = calM, d = day, out = false;
            if (day < 1) { out = true; m = calM - 1; if (m < 0) { m = 11; y--; } d = dimPrev + day; }
            else if (day > dim) { out = true; m = calM + 1; if (m > 11) { m = 0; y++; } d = day - dim; }
            const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
            const evs = cal.filter(e => e.date <= ds && e.end >= ds);   // 이 날에 걸치는 일정
            let cell = '<span class="dnum">' + d + '</span>';
            evs.slice(0, 3).forEach(e => {
                const c = LN_EV_TYPES[e.type] || LN_EV_TYPES['기타'];
                const multi = e.date !== e.end;
                const rangeTxt = multi ? ' (' + e.date + ' ~ ' + e.end + ')' : '';
                cell += '<span class="ln-ev" data-ev="' + esc(e.id) + '" style="background:' + c.bg + ';color:' + c.fg + '" title="[' + esc(e.type) + '] ' + esc(e.title) + esc(rangeTxt) + '">' + esc(e.title) + '</span>';
            });
            if (evs.length > 3) cell += '<span class="ln-ev-more">+' + (evs.length - 3) + '건 더</span>';
            html += '<td class="' + (out ? 'out ' : '') + (dow === 0 ? 'sun ' : dow === 6 ? 'sat ' : '') + (ds === today ? 'today' : '') + '" data-date="' + ds + '">' + cell + '</td>';
        }
        html += '</tr>';
    }
    html += '</tbody></table>';

    bodyEl.innerHTML = '<div class="ln-title"><i class="fas fa-calendar-alt" style="color:#4f46e5;margin-right:6px;"></i>Lab 캘린더</div>' + html;

    document.getElementById('calPrev').onclick = () => calMove(-1);
    document.getElementById('calNext').onclick = () => calMove(1);
    document.getElementById('calToday').onclick = () => { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); renderCalendar(); };
    bodyEl.querySelector('.ln-cal tbody').addEventListener('click', e => {
        const chip = e.target.closest('.ln-ev');
        if (chip) { e.stopPropagation(); openEvPop(chip, 'edit', chip.dataset.ev); return; }
        const td = e.target.closest('td[data-date]');
        if (td) openEvPop(td, 'new', td.dataset.date);
    });
}

// 일정 추가/수정 팝오버
function openEvPop(anchor, mode, key) {
    const pop = document.getElementById('evPop');
    evPopCtx = { mode, id: mode === 'edit' ? key : null };
    const ev = mode === 'edit' ? data.calendar.find(x => x.id === key) : null;
    if (mode === 'edit' && !ev) return;
    const date = mode === 'edit' ? ev.date : key;
    const end = mode === 'edit' ? (ev.end || ev.date) : key;

    let typeOpts = '';
    Object.keys(LN_EV_TYPES).forEach(t => { typeOpts += '<option value="' + t + '"' + ((ev ? ev.type : '기타') === t ? ' selected' : '') + '>' + t + '</option>'; });

    pop.innerHTML =
        '<h4>' + (mode === 'edit' ? '일정 수정' : '일정 추가') + '</h4>' +
        '<input type="text" id="evTitle" placeholder="일정 내용 (예: 홍길동 휴가)" value="' + esc(ev ? ev.title : '') + '">' +
        '<label class="ev-lbl">시작일</label>' +
        '<input type="date" id="evDate" value="' + esc(date) + '">' +
        '<label class="ev-lbl">종료일 <span>(하루면 시작일과 같게)</span></label>' +
        '<input type="date" id="evEnd" value="' + esc(end) + '">' +
        '<select id="evType">' + typeOpts + '</select>' +
        '<div class="ev-actions">' +
        (mode === 'edit' ? '<button class="wl-btn ev-del" id="evDelBtn"><i class="fas fa-trash"></i></button>' : '') +
        '<span class="wl-spacer"></span>' +
        '<button class="wl-btn" id="evCancelBtn">취소</button>' +
        '<button class="wl-btn primary" id="evOkBtn">' + (mode === 'edit' ? '수정' : '추가') + '</button>' +
        '</div>';

    const r = anchor.getBoundingClientRect();
    pop.style.display = 'block';
    let left = r.left, top = r.bottom + 6;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (top + ph > window.innerHeight - 8) top = r.top - ph - 6;
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = Math.max(8, top) + 'px';

    document.getElementById('evCancelBtn').onclick = closeEvPop;
    document.getElementById('evOkBtn').onclick = saveEvPop;
    document.getElementById('evTitle').onkeydown = e => { if (e.key === 'Enter') saveEvPop(); if (e.key === 'Escape') closeEvPop(); };
    const delBtn = document.getElementById('evDelBtn');
    if (delBtn) delBtn.onclick = () => {
        if (!confirm('이 일정을 삭제할까요?')) return;
        data.calendar = data.calendar.filter(x => x.id !== evPopCtx.id);
        closeEvPop(); touchCal(); renderCalendar();
    };
    setTimeout(() => document.getElementById('evTitle').focus(), 0);
}
function saveEvPop() {
    const title = document.getElementById('evTitle').value.trim();
    const date = document.getElementById('evDate').value;
    let end = document.getElementById('evEnd').value;
    const type = document.getElementById('evType').value;
    if (!title) { lnAlert('일정 내용을 입력하세요.', 'error'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { lnAlert('시작일을 선택하세요.', 'error'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) end = date;
    if (end < date) end = date;   // 종료일이 시작보다 앞이면 하루짜리로
    if (evPopCtx.mode === 'edit') {
        const ev = data.calendar.find(x => x.id === evPopCtx.id);
        if (ev) { ev.title = title; ev.date = date; ev.end = end; ev.type = type; }
    } else {
        data.calendar.push({ id: newId('e'), date, end, title, type });
    }
    closeEvPop(); touchCal(); renderCalendar();
}
function closeEvPop() { document.getElementById('evPop').style.display = 'none'; evPopCtx = null; }

// ==================== 백업 (내보내기 / 불러오기) ====================
function exportData() {
    const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = 'silab-lab노트-data_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
}
function importData(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
        try {
            const parsed = JSON.parse(ev.target.result);
            if (!confirm('현재 내용을 불러온 파일로 교체할까요? (교수님 초안 test.json 형식도 지원)')) return;
            // 교수님 초안(test.html)의 {knowledge:{groups}} 형식 호환
            data = parsed.knowledge ? { groups: parsed.knowledge.groups, calendar: (data && data.calendar) || [] } : parsed;
            normalize(); cur = null; render(); showBody();
            saveEverything();   // 전체 교체이므로 뼈대·본문·캘린더를 통째로 기록
            lnAlert('불러오기 완료!', 'success');
        } catch (err) { lnAlert('불러오기 실패: ' + err.message, 'error'); }
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
    if (lnApp) lnApp.style.display = authed ? 'block' : 'none';
}

// ==================== 초기화 ====================
document.addEventListener('DOMContentLoaded', function () {
    lnApp = document.getElementById('lnApp');
    authGate = document.getElementById('authGate');
    treeEl = document.getElementById('lnTree');
    bodyEl = document.getElementById('lnBody');

    try {
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        database = firebase.database();
    } catch (err) {
        console.error('Firebase 초기화 실패', err);
        return;
    }

    auth.onAuthStateChanged(async (user) => {
        if (user && LN_ALLOWED.includes(user.uid)) {
            currentUser = user;
        } else {
            currentUser = null;
            if (user && LN_ALLOWED.indexOf(user.uid) < 0) await auth.signOut();
        }
        updateAuthUI();
        if (currentUser) {
            try { await loadData(); } catch (e) { console.error(e); setSaveStat('dirty', '로드 실패'); lnAlert('데이터 로드 실패: ' + e.message, 'error'); }
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
    logoutBtn && logoutBtn.addEventListener('click', async () => { await auth.signOut(); lnAlert('로그아웃되었습니다.', 'success'); });
    loginForm && loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await loginUser(document.getElementById('email').value.trim(), document.getElementById('password').value);
            loginModal.classList.remove('open');
            loginForm.reset();
            lnAlert('로그인되었습니다.', 'success');
        } catch (err) { lnAlert(err.message || '로그인 실패', 'error'); }
    });

    // 상단 바
    // 상단 전체 저장 버튼은 제거됨 — 본문은 서브탭별 [저장] 버튼, 나머지는 자동 저장(디바운스)으로 처리
    document.getElementById('expandAllBtn').addEventListener('click', () => expandAll(true));
    document.getElementById('collapseAllBtn').addEventListener('click', () => expandAll(false));
    document.getElementById('exportBtn').addEventListener('click', exportData);
    document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
    document.getElementById('importFile').addEventListener('change', importData);
    document.getElementById('addGroupBtn').addEventListener('click', addGroup);
    document.getElementById('calendarMenuBtn').addEventListener('click', selectCalendar);

    // 팝업/팝오버 바깥 클릭 시 닫기
    document.addEventListener('click', e => {
        if (!e.target.closest('.ln-popmenu') && !e.target.classList.contains('ln-kebab')) closePop();
        if (!e.target.closest('.ln-evpop') && !e.target.closest('.ln-ev') && !e.target.closest('.ln-cal td')) closeEvPop();
    });
    window.addEventListener('resize', () => { closePop(); closeEvPop(); });

    // 저장 전에 떠나면 경고
    window.addEventListener('beforeunload', e => {
        if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });
});
