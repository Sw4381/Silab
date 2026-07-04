// project-editor.js — Publications 수정 폼에서 논문 프로젝트(소개) 페이지를 바로 만들고 편집하는 모달
//   · project.html?id=X 와 완전히 동일한 스키마(projectPages/{id})로 저장한다.
//   · 자체 모달 DOM + 스타일을 주입하므로 별도 HTML/CSS 수정이 필요 없다. (공개 project.html 은 건드리지 않음)
//   · 사용법:  window.ProjectEditor.open({ pageId, defaults, onSaved })
//        - pageId : projectPages/{pageId} 저장 키 (예: 'p179')
//        - defaults : 새 페이지일 때 미리 채울 값 { title, authors, venue, paperUrl }
//        - onSaved(url) : 저장 성공 시 호출. url = 'project.html?id=<pageId>'
//   설정값(Cloudinary 등)은 config.js 참조. firebase 는 페이지에서 이미 초기화되어 있어야 함.
(function () {
    'use strict';

    var BLOCK_META = {
        heading: { label: '소제목', icon: 'fa-heading' },
        text:    { label: '본문',   icon: 'fa-align-left' },
        list:    { label: '목록',   icon: 'fa-list-ul' },
        figure:  { label: '그림',   icon: 'fa-image' },
        metrics: { label: '결과수치', icon: 'fa-chart-simple' }
    };

    var uiReady = false;
    var currentPageId = null;
    var onSavedCb = null;
    var isSaving = false;

    function db() { return firebase.database(); }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function alertMsg(msg, type) {
        if (typeof showAlert === 'function') { showAlert(msg, type); return; }
        alert(msg);
    }

    // ==================== 이미지 압축 + Cloudinary 업로드 ====================
    function compressImage(file) {
        var TARGET = 8 * 1024 * 1024;
        return new Promise(function (resolve) {
            var img = new Image();
            var url = URL.createObjectURL(file);
            img.onload = function () {
                URL.revokeObjectURL(url);
                var canvas = document.createElement('canvas');
                var width = img.width, height = img.height;
                var MAX_PX = 4000;
                if (width > MAX_PX || height > MAX_PX) {
                    var r = Math.min(MAX_PX / width, MAX_PX / height);
                    width = Math.round(width * r); height = Math.round(height * r);
                }
                canvas.width = width; canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                var q = 0.85;
                var tryC = function () {
                    canvas.toBlob(function (blob) {
                        if (!blob) { resolve(file); return; }
                        if (blob.size <= TARGET || q <= 0.3) resolve(new File([blob], file.name, { type: 'image/jpeg' }));
                        else { q -= 0.1; tryC(); }
                    }, 'image/jpeg', q);
                };
                tryC();
            };
            img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
            img.src = url;
        });
    }

    function uploadImage(file) {
        return Promise.resolve()
            .then(function () { return file.size > 10 * 1024 * 1024 ? compressImage(file) : file; })
            .then(function (f) {
                return new Promise(function (resolve, reject) {
                    var fd = new FormData();
                    fd.append('file', f);
                    fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
                    var xhr = new XMLHttpRequest();
                    xhr.open('POST', 'https://api.cloudinary.com/v1_1/' + CLOUDINARY_CLOUD_NAME + '/image/upload');
                    xhr.onload = function () { xhr.status === 200 ? resolve(JSON.parse(xhr.responseText).secure_url) : reject(new Error('업로드 실패')); };
                    xhr.onerror = function () { reject(new Error('네트워크 오류')); };
                    xhr.send(fd);
                });
            });
    }

    // ==================== 구버전(개별 필드) → 블록 배열 변환 (하위 호환) ====================
    function getBlocks(data) {
        if (data && Array.isArray(data.blocks)) return data.blocks;
        var blocks = [];
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
            (data.figures || []).forEach(function (f) { if (f && f.url) blocks.push({ type: 'figure', url: f.url, caption: f.caption || '' }); });
        }
        if ((data.metrics || []).length) {
            blocks.push({ type: 'heading', text: '주요 결과 (Results)' });
            blocks.push({ type: 'metrics', items: data.metrics });
        }
        return blocks;
    }

    // ==================== 블록 카드 편집기 ====================
    function blockBodyHtml(type, value) {
        value = value || {};
        if (type === 'heading')
            return '<input type="text" class="pe-blk-heading" placeholder="소제목 (예: 주요 결과)" value="' + esc(value.text || '') + '">';
        if (type === 'text')
            return '<textarea class="pe-blk-text" rows="4" placeholder="본문 (빈 줄로 문단 구분)">' + esc(value.text || '') + '</textarea>';
        if (type === 'list')
            return '<textarea class="pe-blk-list" rows="4" placeholder="목록 항목 (한 줄에 하나씩)">' + esc((value.items || []).join('\n')) + '</textarea>';
        if (type === 'figure')
            return '<div class="pe-fig-row">' +
                       '<div class="pe-fig-thumb">' + (value.url ? '<img src="' + esc(value.url) + '" alt="">' : '<i class="fas fa-image"></i>') + '</div>' +
                       '<div class="pe-fig-fields">' +
                           '<input type="text" class="pe-blk-figcaption" placeholder="캡션 (예: Figure 1. 제안 프레임워크)" value="' + esc(value.caption || '') + '">' +
                           '<input type="file" class="pe-blk-figfile" accept="image/*">' +
                       '</div>' +
                   '</div>';
        if (type === 'metrics')
            return '<textarea class="pe-blk-metrics" rows="3" placeholder="한 줄에 하나, \'값 | 설명\' 형식&#10;예: 91.73% | 다음 행위 예측 정확도">' +
                   esc((value.items || []).map(function (m) { return m.value + ' | ' + (m.label || ''); }).join('\n')) + '</textarea>';
        return '';
    }

    function setFigThumb(card, src) {
        var thumb = card.querySelector('.pe-fig-thumb');
        if (thumb) thumb.innerHTML = src ? '<img src="' + esc(src) + '" alt="">' : '<i class="fas fa-image"></i>';
    }

    function makeBlockCard(type, value) {
        var meta = BLOCK_META[type] || { label: type, icon: 'fa-square' };
        var card = document.createElement('div');
        card.className = 'pe-block-card';
        card.dataset.type = type;
        if (type === 'figure') card.dataset.url = (value && value.url) || '';
        card.innerHTML =
            '<div class="pe-block-card-head">' +
                '<span class="pe-block-card-type"><i class="fas ' + meta.icon + '"></i> ' + meta.label + '</span>' +
                '<span class="pe-block-card-tools">' +
                    '<button type="button" class="pe-blk-up" title="위로">↑</button>' +
                    '<button type="button" class="pe-blk-down" title="아래로">↓</button>' +
                    '<button type="button" class="pe-blk-del" title="삭제">&times;</button>' +
                '</span>' +
            '</div>' +
            '<div class="pe-block-card-body">' + blockBodyHtml(type, value) + '</div>';

        card.querySelector('.pe-blk-del').addEventListener('click', function () { card.remove(); });
        card.querySelector('.pe-blk-up').addEventListener('click', function () {
            var prev = card.previousElementSibling;
            if (prev) card.parentNode.insertBefore(card, prev);
        });
        card.querySelector('.pe-blk-down').addEventListener('click', function () {
            var next = card.nextElementSibling;
            if (next) card.parentNode.insertBefore(next, card);
        });
        if (type === 'figure') {
            var fileInput = card.querySelector('.pe-blk-figfile');
            fileInput.addEventListener('change', function (e) {
                var file = e.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function (ev) { setFigThumb(card, ev.target.result); };
                reader.readAsDataURL(file);
            });
        }
        return card;
    }

    function addBlock(type, value) {
        document.getElementById('pe-blockList').appendChild(makeBlockCard(type, value));
    }

    // ==================== 모달 DOM + 스타일 주입 ====================
    function injectStyles() {
        if (document.getElementById('pe-styles')) return;
        var css =
            '.pe-modal{display:none;position:fixed;inset:0;z-index:4000;background:rgba(0,0,0,.5);overflow-y:auto;}' +
            '.pe-modal.open{display:block;}' +
            '.pe-box{background:#fff;max-width:760px;margin:40px auto;padding:26px;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);}' +
            '.pe-box h3{margin:0 0 18px;color:#24488c;font-size:1.15rem;display:flex;align-items:center;gap:8px;}' +
            '.pe-box .pe-fg{margin-bottom:16px;}' +
            '.pe-box label{display:block;font-size:.85rem;font-weight:600;color:#333;margin-bottom:6px;}' +
            '.pe-box input,.pe-box textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #cfd6e4;border-radius:8px;font-size:.9rem;font-family:inherit;}' +
            '.pe-box input:focus,.pe-box textarea:focus{outline:none;border-color:#24488c;box-shadow:0 0 0 2px rgba(36,72,140,.15);}' +
            '.pe-block-card{border:1px solid #e2e7f0;border-radius:10px;margin-bottom:10px;background:#f8fafd;}' +
            '.pe-block-card-head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #e9edf5;}' +
            '.pe-block-card-type{font-size:.82em;font-weight:700;color:#24488c;display:inline-flex;align-items:center;gap:6px;}' +
            '.pe-block-card-tools{display:inline-flex;gap:4px;}' +
            '.pe-block-card-tools button{width:26px;height:26px;border:1px solid #cfd6e4;background:#fff;border-radius:6px;cursor:pointer;font-size:.9em;line-height:1;}' +
            '.pe-block-card-tools button:hover{background:#24488c;color:#fff;}' +
            '.pe-block-card-tools .pe-blk-del{color:#b91c1c;border-color:#f1b0b7;}' +
            '.pe-block-card-tools .pe-blk-del:hover{background:#b91c1c;color:#fff;}' +
            '.pe-block-card-body{padding:10px;}' +
            '.pe-block-add-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px;}' +
            '.pe-block-add-bar > span{font-size:.82em;color:#777;font-weight:600;}' +
            '.pe-block-add-btn{border:1px dashed #9db0d4;background:#fff;color:#24488c;border-radius:8px;padding:6px 10px;font-size:.82em;cursor:pointer;display:inline-flex;align-items:center;gap:5px;}' +
            '.pe-block-add-btn:hover{background:#24488c;color:#fff;}' +
            '.pe-fig-row{display:flex;gap:12px;}' +
            '.pe-fig-thumb{width:84px;height:84px;flex:0 0 84px;border:1px solid #cfd6e4;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9aa7bd;background:#fff;overflow:hidden;}' +
            '.pe-fig-thumb img{width:100%;height:100%;object-fit:cover;}' +
            '.pe-fig-fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;}' +
            '.pe-fig-fields input[type="file"]{font-size:12px;padding:4px;}' +
            '.pe-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px;}' +
            '.pe-btn{padding:9px 16px;border-radius:8px;border:none;cursor:pointer;font-size:.9rem;font-weight:600;}' +
            '.pe-btn.cancel{background:#e5e8ee;color:#333;}' +
            '.pe-btn.save{background:#24488c;color:#fff;}' +
            '.pe-btn.save:disabled{opacity:.6;cursor:default;}' +
            '.pe-hint{display:none;color:#1769b0;font-size:.85em;margin-top:8px;}';
        var style = document.createElement('style');
        style.id = 'pe-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ensureUI() {
        if (uiReady) return;
        injectStyles();
        var modal = document.createElement('div');
        modal.id = 'pe-modal';
        modal.className = 'pe-modal';
        modal.innerHTML =
            '<div class="pe-box">' +
                '<h3><i class="fas fa-edit"></i> 프로젝트(논문 소개) 페이지 편집</h3>' +
                '<form id="pe-form">' +
                    '<div class="pe-fg"><label>게재 정보 (상단 뱃지) — 예: IEEE Access · 2025 (SCIE)</label><input type="text" id="pe-venue"></div>' +
                    '<div class="pe-fg"><label>논문 제목 *</label><input type="text" id="pe-title" required></div>' +
                    '<div class="pe-fg"><label>저자 — 예: Tae-Hyun Han, Tae-Jin Lee*</label><input type="text" id="pe-authors"></div>' +
                    '<div class="pe-fg"><label>소속 / 서지 정보 (여러 줄 가능)</label><textarea id="pe-affil" rows="3"></textarea></div>' +
                    '<div class="pe-fg"><label>논문 원문(Paper) URL — 비우면 \'Paper\' 버튼 숨김</label><input type="url" id="pe-paperUrl" placeholder="https://doi.org/..."></div>' +
                    '<div class="pe-fg">' +
                        '<label>본문 구성 — 블록을 추가하고 <b>↑ ↓</b>로 순서를 바꾸세요. 그림은 원하는 위치에 넣을 수 있습니다.</label>' +
                        '<div id="pe-blockList"></div>' +
                        '<div class="pe-block-add-bar">' +
                            '<span>블록 추가:</span>' +
                            '<button type="button" class="pe-block-add-btn" data-type="heading"><i class="fas fa-heading"></i> 소제목</button>' +
                            '<button type="button" class="pe-block-add-btn" data-type="text"><i class="fas fa-align-left"></i> 본문</button>' +
                            '<button type="button" class="pe-block-add-btn" data-type="list"><i class="fas fa-list-ul"></i> 목록</button>' +
                            '<button type="button" class="pe-block-add-btn" data-type="figure"><i class="fas fa-image"></i> 그림</button>' +
                            '<button type="button" class="pe-block-add-btn" data-type="metrics"><i class="fas fa-chart-simple"></i> 결과수치</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="pe-hint" id="pe-hint"><i class="fas fa-spinner fa-spin"></i> 이미지 업로드 및 저장 중...</div>' +
                    '<div class="pe-actions">' +
                        '<button type="button" class="pe-btn cancel" id="pe-cancel">취소</button>' +
                        '<button type="submit" class="pe-btn save" id="pe-save"><i class="fas fa-save"></i> 저장</button>' +
                    '</div>' +
                '</form>' +
            '</div>';
        document.body.appendChild(modal);

        modal.querySelectorAll('.pe-block-add-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                addBlock(btn.dataset.type, {});
                var last = document.getElementById('pe-blockList').lastElementChild;
                if (last) last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        });
        document.getElementById('pe-cancel').addEventListener('click', close);
        document.getElementById('pe-form').addEventListener('submit', save);
        // 편집 모달은 바깥 클릭/ESC 로 닫지 않음 (실수 방지)

        uiReady = true;
    }

    function close() {
        var modal = document.getElementById('pe-modal');
        if (modal) modal.classList.remove('open');
    }

    // ==================== 열기 / 저장 ====================
    function open(opts) {
        opts = opts || {};
        if (!opts.pageId) { alertMsg('프로젝트 페이지 ID가 없습니다. 논문 ID를 먼저 입력하세요.', 'warning'); return; }
        if (typeof firebase === 'undefined' || !firebase.apps.length) { alertMsg('데이터베이스가 준비되지 않았습니다.', 'error'); return; }
        currentPageId = opts.pageId;
        onSavedCb = opts.onSaved || null;
        var defaults = opts.defaults || {};
        ensureUI();

        db().ref('projectPages/' + currentPageId).once('value').then(function (snap) {
            var d = snap.val();
            var isNew = !d;
            d = d || {};
            document.getElementById('pe-venue').value   = d.venue   || defaults.venue   || '';
            document.getElementById('pe-title').value   = d.title   || defaults.title   || '';
            document.getElementById('pe-authors').value = d.authors || defaults.authors || '';
            document.getElementById('pe-affil').value   = d.affil   || '';
            document.getElementById('pe-paperUrl').value = d.paperUrl || defaults.paperUrl || '';

            var list = document.getElementById('pe-blockList');
            list.innerHTML = '';
            var blocks = getBlocks(d);
            if (isNew && !blocks.length) {
                // 새 페이지: 자주 쓰는 골격을 미리 넣어 작성 편의 제공
                blocks = [
                    { type: 'heading', text: '요약 (Summary)' },
                    { type: 'text', text: '' }
                ];
            }
            blocks.forEach(function (b) { addBlock(b.type, b); });

            document.getElementById('pe-modal').classList.add('open');
        }).catch(function (e) {
            console.error(e);
            alertMsg('프로젝트 페이지 로드 실패: ' + e.message, 'error');
        });
    }

    function save(e) {
        e.preventDefault();
        if (isSaving) { alertMsg('저장 중입니다. 잠시만 기다려주세요.', 'warning'); return; }

        var title = document.getElementById('pe-title').value.trim();
        if (!title) { alertMsg('논문 제목을 입력해주세요.', 'warning'); return; }

        var hint = document.getElementById('pe-hint');
        var saveBtn = document.getElementById('pe-save');
        isSaving = true;
        if (saveBtn) saveBtn.disabled = true;
        if (hint) hint.style.display = 'block';

        var cards = Array.prototype.slice.call(document.querySelectorAll('#pe-blockList .pe-block-card'));

        // 그림 업로드를 순차 처리한 뒤 블록 배열 구성
        var blocks = [];
        var chain = Promise.resolve();
        cards.forEach(function (card) {
            chain = chain.then(function () {
                var type = card.dataset.type;
                if (type === 'heading') {
                    var ht = card.querySelector('.pe-blk-heading').value.trim();
                    if (ht) blocks.push({ type: type, text: ht });
                } else if (type === 'text') {
                    var tt = card.querySelector('.pe-blk-text').value.trim();
                    if (tt) blocks.push({ type: type, text: tt });
                } else if (type === 'list') {
                    var items = card.querySelector('.pe-blk-list').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
                    if (items.length) blocks.push({ type: type, items: items });
                } else if (type === 'metrics') {
                    var mitems = card.querySelector('.pe-blk-metrics').value.split('\n').map(function (line) {
                        var parts = line.split('|');
                        return { value: (parts[0] || '').trim(), label: parts.slice(1).join('|').trim() };
                    }).filter(function (m) { return m.value; });
                    if (mitems.length) blocks.push({ type: type, items: mitems });
                } else if (type === 'figure') {
                    var caption = card.querySelector('.pe-blk-figcaption').value.trim();
                    var file = card.querySelector('.pe-blk-figfile').files[0];
                    var url = card.dataset.url || '';
                    if (file) {
                        return uploadImage(file).then(function (u) {
                            if (u) blocks.push({ type: type, url: u, caption: caption });
                        });
                    }
                    if (url) blocks.push({ type: type, url: url, caption: caption });
                }
            });
        });

        chain.then(function () {
            var data = {
                venue: document.getElementById('pe-venue').value.trim(),
                title: title,
                authors: document.getElementById('pe-authors').value.trim(),
                affil: document.getElementById('pe-affil').value.trim(),
                paperUrl: document.getElementById('pe-paperUrl').value.trim(),
                blocks: blocks,
                updatedAt: Date.now()
            };
            return db().ref('projectPages/' + currentPageId).set(data);
        }).then(function () {
            alertMsg('프로젝트 페이지가 저장되었습니다.', 'success');
            close();
            if (typeof onSavedCb === 'function') onSavedCb('project.html?id=' + currentPageId);
        }).catch(function (error) {
            console.error('프로젝트 페이지 저장 실패:', error);
            alertMsg('저장 실패: ' + error.message, 'error');
        }).then(function () {
            isSaving = false;
            if (saveBtn) saveBtn.disabled = false;
            if (hint) hint.style.display = 'none';
        });
    }

    window.ProjectEditor = { open: open };
})();
