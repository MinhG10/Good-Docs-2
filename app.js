
'use strict';

(() => {
  // GOOD DOCS v5.2.3
  const $ = id => document.getElementById(id);
  const cloud = window.GoodDocsCloud;

  const st = {
    notes: [],
    folders: [],
    dictionary: [],
    revision: 0,
    current: null,
    mode: 'empty',
    connected: false,
    dirty: false,
    blocked: false,
    saving: false,
    editDictionary: false,
    dictDraft: [],
    dictFont: 16,
    seq: 0
  };

  let timer = null;
  let toastTimer = null;
  let selectedWord = '';
  let selectedDictCell = null;
  const collapsedFolders = new Set();

  // ==========================================
  // COMMON HELPERS
  // ==========================================

  function uid() {
    return crypto.randomUUID?.() ||
      (Date.now() + '-' + Math.random().toString(36).slice(2));
  }

  function toast(message) {
    $('toast').textContent = String(message);
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $('toast').classList.add('hidden');
    }, 4200);
  }

  function status(message) {
    $('saveState').textContent = message;
    $('syncLabel').textContent = message;
  }

  function enable(ready) {
    for (const id of ['newNote', 'newFolder']) {
      $(id).disabled = !ready;
    }
    $('noteTitle').disabled = !ready;
    $('noteEditor').contentEditable = ready ? 'true' : 'false';
    $('dictionaryNav').disabled = !ready;
  }

  function closeSidebar() {
    $('sidebar').classList.remove('open');
  }

  function note() {
    return st.notes.find(n => n.id === st.current);
  }

  // ==========================================
  // HTML SANITIZER
  // Preserve font-size, spacing and dividers.
  // ==========================================

  function sanitize(html) {
    const doc = new DOMParser().parseFromString(
      '<div id="gd-source">' + String(html || '') + '</div>',
      'text/html'
    );

    const source = doc.getElementById('gd-source');
    if (!source) return '';

    const allowedTags = new Set([
      'P', 'DIV', 'SPAN', 'BR',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'B', 'STRONG', 'I', 'EM', 'U', 'S',
      'SMALL', 'MARK',
      'UL', 'OL', 'LI',
      'BLOCKQUOTE', 'PRE', 'CODE',
      'TABLE', 'THEAD', 'TBODY', 'TFOOT',
      'TR', 'TH', 'TD',
      'A', 'HR', 'SUB', 'SUP'
    ]);

    const blockedTags = new Set([
      'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT',
      'EMBED', 'SVG', 'MATH', 'FORM',
      'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA',
      'TEMPLATE', 'LINK', 'META', 'BASE',
      'VIDEO', 'AUDIO', 'SOURCE', 'CANVAS',
      'NOSCRIPT', 'PICTURE'
    ]);

    const output = document.createElement('div');

    function safeLength(value, min = 0, max = 100) {
      const raw = String(value || '').trim().toLowerCase();

      if (raw === '0') return '0';

      const match = raw.match(
        /^(\d+(?:\.\d+)?)(px|pt|em|rem)$/
      );

      if (!match) return null;

      const number = Number(match[1]);
      const unit = match[2];
      const factor = {
        px: 1, pt: 4 / 3, em: 16, rem: 16
      }[unit];

      const pixels = number * factor;

      if (!Number.isFinite(pixels) ||
          pixels < min || pixels > max) return null;

      return number + unit;
    }

    function safeFontSize(value) {
      const size = safeLength(value, 6, 96);
      if (size) return size;

      const match = String(value || '').trim()
        .match(/^(\d+(?:\.\d+)?)%$/);

      if (match) {
        const n = Number(match[1]);
        if (n >= 50 && n <= 300) return n + '%';
      }

      return null;
    }

    function copyNode(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.appendChild(
          document.createTextNode(node.nodeValue)
        );
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const tag = node.tagName.toUpperCase();

      if (blockedTags.has(tag)) return;

      if (!allowedTags.has(tag)) {
        for (const child of [...node.childNodes]) {
          copyNode(child, parent);
        }
        return;
      }

      const clean = document.createElement(tag.toLowerCase());
      const style = node.style;
      const safe = [];

      // Font size.
      const size = safeFontSize(style.fontSize);
      if (size) safe.push(`font-size:${size}`);

      // Font weight.
      const weight = style.fontWeight.trim();
      if (/^(normal|bold|bolder|lighter|[1-9]00)$/i
          .test(weight)) {
        safe.push(`font-weight:${weight}`);
      }

      // Font style.
      const fontStyle = style.fontStyle.trim();
      if (/^(normal|italic|oblique)$/i.test(fontStyle)) {
        safe.push(`font-style:${fontStyle}`);
      }

      // Text decoration.
      const decoration = style.textDecorationLine.trim();
      if (/^(none|underline|line-through|overline)$/i
          .test(decoration)) {
        safe.push(`text-decoration-line:${decoration}`);
      }

      // Line height.
      const lineHeight = style.lineHeight.trim();

      if (/^\d+(?:\.\d+)?$/.test(lineHeight)) {
        const n = Number(lineHeight);
        if (n >= 1 && n <= 3) {
          safe.push(`line-height:${n}`);
        }
      } else if (/^\d+(?:\.\d+)?%$/.test(lineHeight)) {
        const n = parseFloat(lineHeight);
        if (n >= 100 && n <= 300) {
          safe.push(`line-height:${n}%`);
        }
      } else {
        const line = safeLength(lineHeight, 8, 150);
        if (line) safe.push(`line-height:${line}`);
      }

      // Margins and padding, including zero.
      const spacing = [
        ['marginTop', 'margin-top'],
        ['marginRight', 'margin-right'],
        ['marginBottom', 'margin-bottom'],
        ['marginLeft', 'margin-left'],
        ['paddingTop', 'padding-top'],
        ['paddingRight', 'padding-right'],
        ['paddingBottom', 'padding-bottom'],
        ['paddingLeft', 'padding-left']
      ];

      for (const [jsProp, cssProp] of spacing) {
        const value = safeLength(style[jsProp], 0, 100);
        if (value !== null) {
          safe.push(`${cssProp}:${value}`);
        }
      }

      // Preserve horizontal dividers.
      const borderStyles = [
        ['borderTopWidth', 'borderTopStyle', 'border-top'],
        ['borderBottomWidth', 'borderBottomStyle', 'border-bottom']
      ];

      for (const [widthProp, typeProp, cssProp] of borderStyles) {
        const width = safeLength(style[widthProp], 0.5, 3);
        const type = style[typeProp].trim();

        if (width && ['solid', 'dashed', 'dotted'].includes(type)) {
          safe.push(
            `${cssProp}:${width} ${type} #3b414a`
          );
        }
      }

      // Text alignment.
      const align = style.textAlign.trim();

      if (/^(left|right|center|justify|start|end)$/i
          .test(align)) {
        safe.push(`text-align:${align}`);
      }

      // Text indentation.
      const indent = safeLength(style.textIndent, 0, 80);
      if (indent !== null) {
        safe.push(`text-indent:${indent}`);
      }

      // Letter spacing.
      const letterSpacing = safeLength(
        style.letterSpacing, 0, 12
      );

      if (letterSpacing !== null) {
        safe.push(`letter-spacing:${letterSpacing}`);
      }

      // Preserve only basic display values.
      const display = style.display.trim();

      if (/^(block|inline|inline-block|list-item)$/i
          .test(display)) {
        safe.push(`display:${display}`);
      }

      // Preserve white space where explicitly specified.
      const whiteSpace = style.whiteSpace.trim();

      if (/^(normal|pre|pre-wrap|pre-line|break-spaces)$/i
          .test(whiteSpace)) {
        safe.push(`white-space:${whiteSpace}`);
      }

      if (safe.length) {
        clean.setAttribute('style', safe.join(';'));
      }

      // Keep safe hyperlinks.
      if (tag === 'A') {
        const href = node.getAttribute('href');

        if (href) {
          try {
            const url = new URL(href, window.location.href);

            if (['https:', 'http:', 'mailto:']
                .includes(url.protocol)) {
              clean.href = url.href;
              clean.target = '_blank';
              clean.rel = 'noopener noreferrer';
            }
          } catch (_) {}
        }
      }

      // Preserve numbering for ordered lists.
      if (tag === 'OL') {
        const start = Number(node.getAttribute('start'));
        if (Number.isInteger(start) && start > 0 &&
            start <= 10000) {
          clean.setAttribute('start', String(start));
        }
      }

      // Preserve simple table spans.
      if (tag === 'TD' || tag === 'TH') {
        for (const attr of ['colspan', 'rowspan']) {
          const value = Number(node.getAttribute(attr));
          if (Number.isInteger(value) &&
              value >= 1 && value <= 20) {
            clean.setAttribute(attr, String(value));
          }
        }
      }

      for (const child of [...node.childNodes]) {
        copyNode(child, clean);
      }

      parent.appendChild(clean);
    }

    for (const child of [...source.childNodes]) {
      copyNode(child, output);
    }

    return output.innerHTML;
  }

  function syncEditor() {
    if (st.mode === 'note' && note()) {
      note().html = sanitize($('noteEditor').innerHTML);
    }
  }

  // ==========================================
  // FOLDERS AND TABS
  // ==========================================

  function list() {
    const host = $('noteList');
    host.replaceChildren();

    function addNoteButton(n, parent) {
      const btn = document.createElement('button');
      btn.type = 'button';

      btn.className = 'note-row' +
        (st.mode === 'note' && st.current === n.id
          ? ' active' : '');

      btn.textContent = '▤  ' + (n.title || 'Untitled');
      btn.onclick = () => openNote(n.id);
      parent.append(btn);
    }

    for (const folder of st.folders) {
      const section = document.createElement('div');
      section.className = 'folder-section';

      const heading = document.createElement('div');
      heading.className = 'folder-heading';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'folder-toggle';

      toggle.textContent =
        (collapsedFolders.has(folder.id) ? '▸' : '▾') +
        ' 📁 ' + folder.name;

      toggle.title = 'Mở / thu gọn folder';
      toggle.onclick = () => {
        if (collapsedFolders.has(folder.id)) {
          collapsedFolders.delete(folder.id);
        } else {
          collapsedFolders.add(folder.id);
        }
        list();
      };

      function action(symbol, title, callback) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'folder-action';
        btn.textContent = symbol;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.onclick = callback;
        return btn;
      }

      heading.append(
        toggle,
        action('＋', 'Tạo tab trong ' + folder.name,
          () => createNote(folder.id)),
        action('✎', 'Đổi tên folder',
          () => renameFolder(folder.id)),
        action('×', 'Xóa folder',
          () => deleteFolder(folder.id))
      );

      section.append(heading);

      if (!collapsedFolders.has(folder.id)) {
        const children = document.createElement('div');
        children.className = 'folder-children';

        st.notes
          .filter(n => n.folderId === folder.id)
          .forEach(n => addNoteButton(n, children));

        section.append(children);
      }

      host.append(section);
    }

    const root = document.createElement('div');
    root.className = 'root-notes';

    const folderIds = new Set(st.folders.map(f => f.id));

    st.notes
      .filter(n => !n.folderId || !folderIds.has(n.folderId))
      .forEach(n => addNoteButton(n, root));

    host.append(root);

    $('dictionaryNav').classList.toggle(
      'active', st.mode === 'dictionary'
    );
  }

  function show(mode) {
    st.mode = mode;

    for (const id of ['emptyView', 'noteView', 'dictView']) {
      $(id).classList.add('hidden');
    }

    const target = mode === 'note' ? 'noteView' :
      mode === 'dictionary' ? 'dictView' : 'emptyView';

    $(target).classList.remove('hidden');
    list();
    closeSidebar();
  }

  function openNote(id) {
    if (st.editDictionary &&
        !confirm('Dictionary đang ở Edit ON. Bỏ thay đổi chưa Save?')) {
      return;
    }

    syncEditor();
    st.editDictionary = false;

    const n = st.notes.find(x => x.id === id);
    if (!n) return;

    st.current = id;
    $('pageTitle').textContent = n.title;
    $('noteTitle').value = n.title;
    $('noteEditor').innerHTML = sanitize(n.html);

    const fontSize = n.fontSize || 16;
    $('noteEditor').style.fontSize = fontSize + 'px';
    $('noteFontSize').textContent = fontSize + 'px';

    show('note');
  }

  function openDict() {
    if (st.editDictionary &&
        !confirm('Bỏ thay đổi Dictionary chưa Save?')) {
      return;
    }

    syncEditor();
    st.editDictionary = false;
    st.dictDraft = structuredClone(st.dictionary);

    $('pageTitle').textContent = 'Dictionary';
    $('editToggle').textContent = 'Edit OFF';
    $('dictSave').disabled = true;
    $('addRow').disabled = true;

    renderDict();
    show('dictionary');
  }

  // ==========================================
  // AUTO SAVE AND LOAD
  // ==========================================

  function mark() {
    st.seq++;
    st.dirty = true;

    if (st.blocked) {
      status('Xung đột — cần tải lại trang');
      return;
    }

    status('Có thay đổi chưa lưu');
    clearTimeout(timer);
    timer = setTimeout(saveNow, 1400);
  }

  async function saveNow() {
    clearTimeout(timer);

    if (!st.connected || !st.dirty || st.blocked) return;

    if (st.saving) {
      timer = setTimeout(saveNow, 1000);
      return;
    }

    syncEditor();

    const snapshot = {
      notes: structuredClone(st.notes),
      folders: structuredClone(st.folders),
      dictionary: structuredClone(st.dictionary)
    };

    const savedSeq = st.seq;
    st.saving = true;
    status('Đang lưu lên Google Sheets...');

    try {
      const revision = await cloud.save(snapshot, st.revision);
      st.revision = revision;

      if (st.seq === savedSeq) {
        st.dirty = false;
        status('Đã đồng bộ Google Sheets ✓');
      } else {
        status('Có thay đổi mới...');
        timer = setTimeout(saveNow, 250);
      }
    } catch (e) {
      if (e.conflict) st.blocked = true;

      status(e.conflict
        ? 'Xung đột dữ liệu — cần tải lại'
        : 'Lưu thất bại — kiểm tra kết nối');

      toast(e.message || 'Không thể lưu dữ liệu');
    } finally {
      st.saving = false;
    }
  }

  function applyData(data) {
    Object.assign(st, {
      notes: Array.isArray(data.notes) ? data.notes : [],
      folders: Array.isArray(data.folders) ? data.folders : [],
      dictionary: Array.isArray(data.dictionary)
        ? data.dictionary : [],
      revision: data.revision,
      connected: true,
      dirty: false,
      blocked: false
    });

    st.editDictionary = false;
    st.mode = 'empty';
    collapsedFolders.clear();

    if (st.current &&
        st.notes.some(n => n.id === st.current)) {
      openNote(st.current);
    } else if (st.notes.length) {
      openNote(st.notes[0].id);
    } else {
      openDict();
    }
  }

  async function connect() {
    try {
      status('Đang kết nối cơ sở dữ liệu...');
      await cloud.connect();
      const data = await cloud.load();

      applyData(data);
      enable(true);
      status('Đã đồng bộ Google Sheets ✓');
    } catch (e) {
      status('Không tải được dữ liệu');
      toast(e.message || 'Lỗi kết nối');
    }
  }

  // ==========================================
  // FOLDER MANAGEMENT
  // ==========================================

  function createFolder() {
    if (!st.connected || st.blocked)
      return toast('Chưa thể chỉnh sửa dữ liệu.');

    if (st.folders.length >= 100)
      return toast('Tối đa 100 folder.');

    const raw = prompt('Tên folder mới:', 'English');
    if (raw === null) return;

    const name = raw.trim().slice(0, 100);
    if (!name) return toast('Tên folder không được trống.');

    const folder = { id: uid(), name };
    st.folders.unshift(folder);
    collapsedFolders.delete(folder.id);

    list();
    mark();
  }

  function renameFolder(id) {
    if (st.blocked)
      return toast('Cần tải lại dữ liệu trước khi sửa.');

    const folder = st.folders.find(f => f.id === id);
    if (!folder) return;

    const raw = prompt('Đổi tên folder:', folder.name);
    if (raw === null) return;

    const name = raw.trim().slice(0, 100);
    if (!name) return toast('Tên folder không được trống.');

    folder.name = name;
    list();
    mark();
  }

  function deleteFolder(id) {
    if (st.blocked)
      return toast('Cần tải lại dữ liệu trước khi xóa.');

    const folder = st.folders.find(f => f.id === id);
    if (!folder) return;

    if (!confirm(
      `Xóa folder “${folder.name}”? Các tab bên trong sẽ được giữ lại.`
    )) return;

    st.notes.forEach(n => {
      if (n.folderId === id) n.folderId = null;
    });

    st.folders = st.folders.filter(f => f.id !== id);
    collapsedFolders.delete(id);

    list();
    mark();
  }

  // ==========================================
  // NOTES
  // ==========================================

  function createNote(folderId = null) {
    if (!st.connected || st.blocked)
      return toast('Chưa thể chỉnh sửa dữ liệu.');

    if (st.notes.length >= 250)
      return toast('Tối đa 250 ghi chú.');

    if (folderId &&
        !st.folders.some(f => f.id === folderId)) return;

    if (st.editDictionary &&
        !confirm('Bỏ thay đổi Dictionary chưa Save?')) return;

    const title = prompt('Tên tab mới:', 'Ghi chú mới');
    if (title === null) return;

    syncEditor();

    const n = {
      id: uid(),
      folderId,
      title: title.trim().slice(0, 160) || 'Ghi chú mới',
      html: '',
      fontSize: 16
    };

    st.notes.unshift(n);
    if (folderId) collapsedFolders.delete(folderId);

    openNote(n.id);
    mark();
  }

  function deleteNote() {
    const n = note();
    if (!n || st.blocked) return;

    if (!confirm(`Xóa tab “${n.title}”?`)) return;

    st.notes = st.notes.filter(x => x.id !== n.id);
    st.current = null;
    st.mode = 'empty';

    if (st.notes.length) openNote(st.notes[0].id);
    else openDict();

    mark();
  }

  function execBold() {
    if (st.mode !== 'note') return;
    $('noteEditor').focus();
    document.execCommand('bold', false);
    syncEditor();
    mark();
  }

  function fontNote(step) {
    const n = note();
    if (!n) return;

    n.fontSize = Math.min(
      32, Math.max(12, (n.fontSize || 16) + step)
    );

    $('noteEditor').style.fontSize = n.fontSize + 'px';
    $('noteFontSize').textContent = n.fontSize + 'px';
    mark();
  }

  // ==========================================
  // DICTIONARY
  // ==========================================

  function renderDict() {
    const host = $('dictBody');
    host.replaceChildren();

    const q = $('searchWord').value.trim().toLocaleLowerCase();
    const words = st.editDictionary
      ? st.dictDraft : st.dictionary;

    let count = 0;

    for (const w of words) {
      if (q && !`${w.english} ${w.vietnamese}`
          .toLocaleLowerCase().includes(q)) continue;

      count++;

      const tr = document.createElement('tr');

      for (const key of ['english', 'vietnamese']) {
        const td = document.createElement('td');
        const div = document.createElement('div');

        div.textContent = w[key] || '';
        div.contentEditable = st.editDictionary ? 'true' : 'false';
        div.style.fontSize = st.dictFont + 'px';
        div.style.fontWeight = w[key + 'Bold'] ? '700' : '400';
        div.dataset.id = w.id;
        div.dataset.key = key;

        div.addEventListener('focus', () => {
          selectedDictCell = { id: w.id, key };
        });

        div.addEventListener('input', () => {
          w[key] = div.innerText;
        });

        div.addEventListener('paste', e => {
          if (!st.editDictionary) return;
          e.preventDefault();
          document.execCommand(
            'insertText', false,
            e.clipboardData.getData('text/plain')
          );
        });

        td.append(div);
        tr.append(td);
      }

      const action = document.createElement('td');

      if (st.editDictionary) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'remove-word';
        btn.textContent = '✕';
        btn.title = 'Xóa hàng';

        btn.onclick = () => {
          st.dictDraft = st.dictDraft.filter(x => x.id !== w.id);
          renderDict();
        };

        action.append(btn);
      }

      tr.append(action);
      host.append(tr);
    }

    $('dictCount').textContent = count + ' từ';
    $('dictFontSize').textContent = st.dictFont + 'px';
  }

  function toggleEdit() {
    if (!st.connected || st.blocked)
      return toast('Chưa thể chỉnh sửa dữ liệu.');

    if (st.editDictionary &&
        !confirm('Tắt Edit sẽ bỏ thay đổi chưa Save. Tiếp tục?')) {
      return;
    }

    st.editDictionary = !st.editDictionary;
    st.dictDraft = structuredClone(st.dictionary);

    $('editToggle').textContent =
      st.editDictionary ? 'Edit ON' : 'Edit OFF';

    $('dictSave').disabled = !st.editDictionary;
    $('addRow').disabled = !st.editDictionary;
    selectedDictCell = null;

    renderDict();
  }

  function addRow() {
    if (!st.editDictionary) return;

    st.dictDraft.unshift({
      id: uid(),
      english: '',
      vietnamese: '',
      englishBold: false,
      vietnameseBold: false
    });

    $('searchWord').value = '';
    renderDict();

    $('dictBody')
      .querySelector('[contenteditable="true"]')
      ?.focus();
  }

  function saveDictionary() {
    if (!st.editDictionary || st.blocked) return;

    if (st.dictDraft.length > 5000)
      return toast('Dictionary tối đa 5.000 từ.');

    st.dictionary = st.dictDraft.map(w => ({
      id: w.id,
      english: String(w.english || '').trim(),
      vietnamese: String(w.vietnamese || '').trim(),
      englishBold: !!w.englishBold,
      vietnameseBold: !!w.vietnameseBold
    })).filter(w => w.english || w.vietnamese);

    st.editDictionary = false;
    st.dictDraft = structuredClone(st.dictionary);

    $('editToggle').textContent = 'Edit OFF';
    $('dictSave').disabled = true;
    $('addRow').disabled = true;

    renderDict();
    mark();
    saveNow();
  }

  function dictFont(step) {
    st.dictFont = Math.min(
      32, Math.max(12, st.dictFont + step)
    );
    renderDict();
  }

  function dictBold() {
    if (!st.editDictionary)
      return toast('Bật Edit ON trước khi chỉnh sửa.');

    if (!selectedDictCell)
      return toast('Chọn một ô English hoặc Tiếng Việt.');

    const w = st.dictDraft.find(x => x.id === selectedDictCell.id);
    if (!w) return;

    const key = selectedDictCell.key + 'Bold';
    w[key] = !w[key];

    renderDict();
    toast('Đã đổi kiểu chữ. Nhấn Save để lưu.');
  }

  // ==========================================
  // ADD TO DICTIONARY
  // ==========================================

  function hideContext() {
    $('contextMenu').classList.add('hidden');
  }

  function openWordModal(text) {
    selectedWord = String(text || '').trim().slice(0, 250);
    $('modalEnglish').value = selectedWord;
    $('modalVietnamese').value = '';
    $('wordModal').classList.remove('hidden');
    $('modalVietnamese').focus();
  }

  function addWordModal() {
    const english = $('modalEnglish').value.trim();
    const vietnamese = $('modalVietnamese').value.trim();

    if (!english || !vietnamese)
      return toast('Hãy điền tiếng Anh và nghĩa tiếng Việt.');

    if (!st.connected || st.blocked)
      return toast('Chưa thể lưu dữ liệu.');

    if (st.editDictionary)
      return toast('Hãy Save hoặc tắt Edit trước khi thêm từ.');

    if (st.dictionary.length >= 5000)
      return toast('Dictionary đã đạt 5.000 từ.');

    st.dictionary.unshift({
      id: uid(),
      english,
      vietnamese,
      englishBold: false,
      vietnameseBold: false
    });

    $('wordModal').classList.add('hidden');

    if (st.mode === 'dictionary') renderDict();

    mark();
    toast('Đã thêm từ vào Dictionary.');
  }

  // ==========================================
  // PASTE RICH HTML
  // ==========================================

  function pasteRichText(e) {
    if (!st.connected || st.blocked) return;

    const clipboard = e.clipboardData;
    if (!clipboard) return;

    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');

    e.preventDefault();

    const editor = $('noteEditor');
    editor.focus();

    if (html && html.trim()) {
      document.execCommand(
        'insertHTML', false, sanitize(html)
      );
    } else {
      document.execCommand(
        'insertText', false, text
      );
    }

    syncEditor();
    mark();
  }

  // ==========================================
  // EVENT BINDINGS
  // ==========================================

  function bind() {
    $('newNote').onclick = () => createNote(null);
    $('newFolder').onclick = createFolder;
    $('deleteNote').onclick = deleteNote;

    $('dictionaryNav').onclick = openDict;

    $('openSidebar').onclick = () => {
      $('sidebar').classList.add('open');
    };

    $('closeSidebar').onclick = closeSidebar;

    $('noteTitle').oninput = () => {
      const n = note();
      if (!n) return;

      n.title = $('noteTitle').value.slice(0, 160);
      $('pageTitle').textContent = n.title;
      list();
      mark();
    };

    $('noteEditor').addEventListener('input', () => {
      syncEditor();
      mark();
    });

    $('noteEditor').addEventListener('paste', pasteRichText);

    $('noteBold').onclick = execBold;
    $('noteIncrease').onclick = () => fontNote(2);
    $('noteDecrease').onclick = () => fontNote(-2);

    $('editToggle').onclick = toggleEdit;
    $('addRow').onclick = addRow;
    $('dictSave').onclick = saveDictionary;
    $('dictIncrease').onclick = () => dictFont(2);
    $('dictDecrease').onclick = () => dictFont(-2);
    $('dictBold').onclick = dictBold;
    $('searchWord').oninput = renderDict;

    $('noteEditor').addEventListener('contextmenu', e => {
      const selection = window.getSelection();
      const text = selection?.toString().trim();

      if (
        !text ||
        text.length > 250 ||
        !$('noteEditor').contains(selection.anchorNode) ||
        !$('noteEditor').contains(selection.focusNode)
      ) return;

      selectedWord = text;
      e.preventDefault();

      const menu = $('contextMenu');

      menu.style.left = Math.max(
        8, Math.min(e.clientX, innerWidth - 220)
      ) + 'px';

      menu.style.top = Math.max(
        8, Math.min(e.clientY, innerHeight - 55)
      ) + 'px';

      menu.classList.remove('hidden');
    });

    $('contextAdd').onclick = () => {
      hideContext();
      openWordModal(selectedWord);
    };

    document.addEventListener('click', e => {
      if (!$('contextMenu').contains(e.target)) {
        hideContext();
      }
    });

    $('cancelWord').onclick = () => {
      $('wordModal').classList.add('hidden');
    };

    $('confirmWord').onclick = addWordModal;

    $('wordModal').onclick = e => {
      if (e.target === $('wordModal')) {
        $('wordModal').classList.add('hidden');
      }
    };

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        $('wordModal').classList.add('hidden');
        hideContext();
      }

      if ((e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveNow();
      }
    });

    window.addEventListener('beforeunload', e => {
      if (st.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  bind();
  enable(false);
  status('Đang tải dữ liệu...');
  connect();

})();
