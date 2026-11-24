
'use strict';

(() => {
  /* ==========================================
     GOOD DOCS v5.1
     ========================================== */

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


  /* ==========================================
     1. COMMON HELPERS
     ========================================== */

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

  
function sanitize(html) {
    const doc = new DOMParser().parseFromString(
        '<div id="gooddocs-source">' +
        String(html || '') +
        '</div>',
        'text/html'
    );

    const source = doc.getElementById('gooddocs-source');

    if (!source) return '';

    // Những thẻ HTML được phép lưu
    const allowedTags = new Set([
        'P', 'DIV', 'SPAN', 'BR',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'STRONG', 'B', 'EM', 'I', 'U', 'S',
        'UL', 'OL', 'LI',
        'BLOCKQUOTE',
        'PRE', 'CODE',
        'TABLE', 'THEAD', 'TBODY', 'TFOOT',
        'TR', 'TH', 'TD',
        'A', 'HR', 'SUB', 'SUP'
    ]);

    // Loại bỏ cả nội dung của những thẻ nguy hiểm
    const blockedTags = new Set([
        'SCRIPT', 'STYLE', 'IFRAME',
        'OBJECT', 'EMBED', 'SVG', 'MATH',
        'FORM', 'INPUT', 'BUTTON',
        'SELECT', 'TEXTAREA', 'TEMPLATE',
        'LINK', 'META', 'BASE',
        'VIDEO', 'AUDIO', 'SOURCE',
        'CANVAS'
    ]);

    const output = document.createElement('div');

    function copyNode(node, parent) {
        // Giữ nội dung văn bản
        if (node.nodeType === Node.TEXT_NODE) {
            parent.appendChild(
                document.createTextNode(node.nodeValue)
            );
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        const tag = node.tagName.toUpperCase();

        if (blockedTags.has(tag)) {
            return;
        }

        // Thẻ không hỗ trợ: giữ văn bản bên trong,
        // nhưng không giữ bản thân thẻ.
        if (!allowedTags.has(tag)) {
            for (const child of node.childNodes) {
                copyNode(child, parent);
            }
            return;
        }

        const clean = document.createElement(
            tag.toLowerCase()
        );

        // Chỉ giữ các định dạng CSS an toàn.
        const styles = [];

        const fontSize = node.style.fontSize.trim();

        // Chỉ chấp nhận đơn vị font-size thông dụng.
        // Giới hạn giá trị để tránh làm vỡ layout.
        const sizeMatch = fontSize.match(
            /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/i
        );

        if (sizeMatch) {
            const value = Number(sizeMatch[1]);
            const unit = sizeMatch[2].toLowerCase();

            const limits = {
                px: [8, 96],
                pt: [6, 72],
                em: [0.5, 6],
                rem: [0.5, 6],
                '%': [50, 600]
            };

            const [min, max] = limits[unit];

            if (value >= min && value <= max) {
                styles.push(
                    `font-size:${value}${unit}`
                );
            }
        }

        // In đậm
        const weight = node.style.fontWeight.trim();

        if (
            /^(normal|bold|bolder|lighter|[1-9]00)$/i
                .test(weight)
        ) {
            styles.push(
                `font-weight:${weight.toLowerCase()}`
            );
        }

        // In nghiêng
        const fontStyle = node.style.fontStyle.trim();

        if (/^(normal|italic|oblique)$/i.test(fontStyle)) {
            styles.push(
                `font-style:${fontStyle.toLowerCase()}`
            );
        }

        // Gạch chân / gạch ngang
        const decoration =
            node.style.textDecorationLine.trim();

        if (
            /^(none|underline|line-through|overline)$/i
                .test(decoration)
        ) {
            styles.push(
                `text-decoration-line:${decoration.toLowerCase()}`
            );
        }

        // Căn lề văn bản
        const align = node.style.textAlign.trim();

        if (
            /^(left|right|center|justify|start|end)$/i
                .test(align)
        ) {
            styles.push(
                `text-align:${align.toLowerCase()}`
            );
        }

        if (styles.length > 0) {
            clean.setAttribute(
                'style',
                styles.join(';')
            );
        }

        // Chỉ giữ link HTTP(S) hoặc email hợp lệ.
        if (tag === 'A') {
            const href = node.getAttribute('href');

            if (href) {
                try {
                    const url = new URL(
                        href,
                        window.location.href
                    );

                    if (
                        ['https:', 'http:', 'mailto:']
                            .includes(url.protocol)
                    ) {
                        clean.href = url.href;
                        clean.target = '_blank';
                        clean.rel = 'noopener noreferrer';
                    }
                } catch {
                    // Bỏ liên kết không hợp lệ.
                }
            }
        }

        for (const child of node.childNodes) {
            copyNode(child, clean);
        }

        parent.appendChild(clean);
    }

    for (const child of source.childNodes) {
        copyNode(child, output);
    }

    return output.innerHTML;
}


  function closeSidebar() {
    $('sidebar').classList.remove('open');
  }

  function note() {
    return st.notes.find(n => n.id === st.current);
  }

  function syncEditor() {
    if (st.mode === 'note' && note()) {
      note().html = sanitize($('noteEditor').innerHTML);
    }
  }


  /* ==========================================
     2. FOLDER AND TAB NAVIGATION
     ========================================== */

  function list() {
    const host = $('noteList');
    host.replaceChildren();

    function addNoteButton(n, parent) {
      const btn = document.createElement('button');
      btn.type = 'button';

      btn.className = 'note-row' +
        (st.mode === 'note' && st.current === n.id
          ? ' active'
          : '');

      btn.textContent = '▤  ' + (n.title || 'Untitled');

      btn.onclick = () => openNote(n.id);

      parent.append(btn);
    }

    // Folders are displayed before root notes.
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
        action(
          '＋',
          'Tạo tab trong ' + folder.name,
          () => createNote(folder.id)
        ),
        action(
          '✎',
          'Đổi tên folder',
          () => renameFolder(folder.id)
        ),
        action(
          '×',
          'Xóa folder (giữ lại các tab)',
          () => deleteFolder(folder.id)
        )
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

    // Notes outside folders.
    const root = document.createElement('div');
    root.className = 'root-notes';

    const folderIds = new Set(
      st.folders.map(f => f.id)
    );

    st.notes
      .filter(n =>
        !n.folderId || !folderIds.has(n.folderId)
      )
      .forEach(n => addNoteButton(n, root));

    host.append(root);

    $('dictionaryNav').classList.toggle(
      'active',
      st.mode === 'dictionary'
    );
  }


  /* ==========================================
     3. VIEW NAVIGATION
     ========================================== */

  function show(mode) {
    st.mode = mode;

    for (const id of ['emptyView', 'noteView', 'dictView']) {
      $(id).classList.add('hidden');
    }

    const viewId =
      mode === 'note'
        ? 'noteView'
        : mode === 'dictionary'
          ? 'dictView'
          : 'emptyView';

    $(viewId).classList.remove('hidden');

    list();
    closeSidebar();
  }

  function openNote(id) {
    if (
      st.editDictionary &&
      !confirm(
        'Dictionary đang ở Edit ON. Bỏ thay đổi chưa Save?'
      )
    ) {
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
    if (
      st.editDictionary &&
      !confirm('Bỏ thay đổi Dictionary chưa Save?')
    ) {
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


  /* ==========================================
     4. AUTOMATIC GOOGLE SHEETS SYNC
     ========================================== */

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

    if (!st.connected || !st.dirty || st.blocked) {
      return;
    }

    if (st.saving) {
      timer = setTimeout(saveNow, 1000);
      return;
    }

    syncEditor();

    const state = {
      notes: structuredClone(st.notes),
      folders: structuredClone(st.folders),
      dictionary: structuredClone(st.dictionary)
    };

    const savedSeq = st.seq;

    st.saving = true;
    status('Đang lưu lên Google Sheets...');

    try {
      const revision = await cloud.save(
        state,
        st.revision
      );

      st.revision = revision;

      if (st.seq === savedSeq) {
        st.dirty = false;
        status('Đã đồng bộ Google Sheets ✓');
      } else {
        status('Có thay đổi mới...');
        timer = setTimeout(saveNow, 250);
      }
    } catch (e) {
      if (e.conflict) {
        st.blocked = true;
      }

      status(
        e.conflict
          ? 'Xung đột dữ liệu — cần tải lại'
          : 'Lưu thất bại — kiểm tra kết nối'
      );

      toast(e.message || 'Không thể lưu dữ liệu');
    } finally {
      st.saving = false;
    }
  }

  function applyData(data) {
    Object.assign(st, {
      notes: Array.isArray(data.notes)
        ? data.notes
        : [],

      folders: Array.isArray(data.folders)
        ? data.folders
        : [],

      dictionary: Array.isArray(data.dictionary)
        ? data.dictionary
        : [],

      revision: data.revision,
      connected: true,
      dirty: false,
      blocked: false
    });

    st.editDictionary = false;

    // Prevent old editor contents from overwriting loaded notes.
    st.mode = 'empty';

    collapsedFolders.clear();

    if (
      st.current &&
      st.notes.some(n => n.id === st.current)
    ) {
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

  // Internal reload for resolving conflicts.
  // No manual reload button is displayed.
  async function reload() {
    if (!st.connected || st.saving) return;

    if (
      st.dirty &&
      !confirm(
        'Thay đổi chưa lưu sẽ bị bỏ. Tải dữ liệu từ Google Sheets?'
      )
    ) {
      return;
    }

    try {
      const data = await cloud.load();

      st.current = null;
      st.mode = 'empty';

      applyData(data);
      status('Đã đồng bộ Google Sheets ✓');
    } catch (e) {
      toast(e.message || 'Không tải được dữ liệu');
    }
  }


  /* ==========================================
     5. FOLDER MANAGEMENT
     ========================================== */

  function createFolder() {
    if (!st.connected || st.blocked) {
      return toast('Chưa thể chỉnh sửa dữ liệu.');
    }

    if (st.folders.length >= 100) {
      return toast('Tối đa 100 folder.');
    }

    const raw = prompt('Tên folder mới:', 'English');

    if (raw === null) return;

    const name = raw.trim().slice(0, 100);

    if (!name) {
      return toast('Tên folder không được trống.');
    }

    const folder = {
      id: uid(),
      name
    };

    // New folder is shown first.
    st.folders.unshift(folder);

    collapsedFolders.delete(folder.id);

    list();
    mark();
  }

  function renameFolder(id) {
    if (st.blocked) {
      return toast('Cần tải lại dữ liệu trước khi sửa.');
    }

    const folder = st.folders.find(f => f.id === id);

    if (!folder) return;

    const raw = prompt(
      'Đổi tên folder:',
      folder.name
    );

    if (raw === null) return;

    const name = raw.trim().slice(0, 100);

    if (!name) {
      return toast('Tên folder không được trống.');
    }

    folder.name = name;

    list();
    mark();
  }

  function deleteFolder(id) {
    if (st.blocked) {
      return toast('Cần tải lại dữ liệu trước khi xóa.');
    }

    const folder = st.folders.find(f => f.id === id);

    if (!folder) return;

    const confirmed = confirm(
      `Xóa folder “${folder.name}”? ` +
      'Các tab bên trong sẽ chuyển ra thư viện chính.'
    );

    if (!confirmed) return;

    // Preserve notes when deleting a folder.
    for (const n of st.notes) {
      if (n.folderId === id) {
        n.folderId = null;
      }
    }

    st.folders = st.folders.filter(
      f => f.id !== id
    );

    collapsedFolders.delete(id);

    list();
    mark();
  }


  /* ==========================================
     6. NOTES MANAGEMENT
     ========================================== */

  function createNote(folderId = null) {
    if (!st.connected || st.blocked) {
      return toast('Chưa thể chỉnh sửa dữ liệu.');
    }

    if (st.notes.length >= 250) {
      return toast('Đã đạt giới hạn 250 ghi chú.');
    }

    if (
      folderId &&
      !st.folders.some(f => f.id === folderId)
    ) {
      return;
    }

    if (
      st.editDictionary &&
      !confirm(
        'Dictionary đang ở Edit ON. Bỏ thay đổi chưa Save?'
      )
    ) {
      return;
    }

    const title = prompt(
      'Tên tab mới:',
      'Ghi chú mới'
    );

    if (title === null) return;

    const n = {
      id: uid(),
      folderId,
      title: title.trim().slice(0, 160) || 'Ghi chú mới',
      html: '',
      fontSize: 16
    };

    // New note is shown first.
    st.notes.unshift(n);

    if (folderId) {
      collapsedFolders.delete(folderId);
    }

    openNote(n.id);
    mark();
  }

  function deleteNote() {
    const n = note();

    if (!n) return;

    if (!confirm(`Xóa tab “${n.title}”?`)) {
      return;
    }

    st.notes = st.notes.filter(
      x => x.id !== n.id
    );

    st.current = null;

    if (st.notes.length) {
      openNote(st.notes[0].id);
    } else {
      openDict();
    }

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
      32,
      Math.max(12, (n.fontSize || 16) + step)
    );

    $('noteEditor').style.fontSize =
      n.fontSize + 'px';

    $('noteFontSize').textContent =
      n.fontSize + 'px';

    mark();
  }


  /* ==========================================
     7. DICTIONARY TABLE
     ========================================== */

  function renderDict() {
    const host = $('dictBody');
    host.replaceChildren();

    const q = $('searchWord')
      .value.trim()
      .toLocaleLowerCase();

    const words = st.editDictionary
      ? st.dictDraft
      : st.dictionary;

    let count = 0;

    for (const w of words) {
      const searchable =
        `${w.english} ${w.vietnamese}`
          .toLocaleLowerCase();

      if (q && !searchable.includes(q)) {
        continue;
      }

      count++;

      const tr = document.createElement('tr');

      for (const key of ['english', 'vietnamese']) {
        const td = document.createElement('td');
        const div = document.createElement('div');

        div.textContent = w[key] || '';

        div.contentEditable =
          st.editDictionary ? 'true' : 'false';

        div.style.fontSize =
          st.dictFont + 'px';

        div.style.fontWeight =
          w[key + 'Bold'] ? '700' : '400';

        div.dataset.id = w.id;
        div.dataset.key = key;

        div.addEventListener('focus', () => {
          selectedDictCell = {
            id: w.id,
            key
          };
        });

        div.addEventListener('input', () => {
          w[key] = div.innerText;
        });

        div.addEventListener('paste', e => {
          if (!st.editDictionary) return;

          e.preventDefault();

          document.execCommand(
            'insertText',
            false,
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
          st.dictDraft = st.dictDraft.filter(
            x => x.id !== w.id
          );

          renderDict();
        };

        action.append(btn);
      }

      tr.append(action);
      host.append(tr);
    }

    $('dictCount').textContent =
      count + ' từ';

    $('dictFontSize').textContent =
      st.dictFont + 'px';
  }

  function toggleEdit() {
    if (!st.connected || st.blocked) {
      return toast('Chưa thể chỉnh sửa dữ liệu.');
    }

    if (
      st.editDictionary &&
      !confirm(
        'Tắt Edit sẽ bỏ thay đổi chưa Save. Tiếp tục?'
      )
    ) {
      return;
    }

    st.editDictionary = !st.editDictionary;

    st.dictDraft = structuredClone(
      st.dictionary
    );

    $('editToggle').textContent =
      st.editDictionary ? 'Edit ON' : 'Edit OFF';

    $('dictSave').disabled = !st.editDictionary;
    $('addRow').disabled = !st.editDictionary;

    selectedDictCell = null;

    renderDict();
  }

  function addRow() {
    if (!st.editDictionary) return;

    // New word is displayed at the top.
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
    if (!st.editDictionary || st.blocked) {
      return;
    }

    if (st.dictDraft.length > 5000) {
      return toast(
        'Dictionary tối đa 5.000 từ.'
      );
    }

    function normalize(w) {
      return {
        id: w.id,
        english: String(w.english || '').trim(),
        vietnamese: String(w.vietnamese || '').trim(),
        englishBold: !!w.englishBold,
        vietnameseBold: !!w.vietnameseBold
      };
    }

    st.dictionary = st.dictDraft
      .map(normalize)
      .filter(w => w.english || w.vietnamese);

    st.editDictionary = false;

    st.dictDraft = structuredClone(
      st.dictionary
    );

    $('editToggle').textContent = 'Edit OFF';
    $('dictSave').disabled = true;
    $('addRow').disabled = true;

    renderDict();
    mark();
    saveNow();
  }

  function dictFont(step) {
    st.dictFont = Math.min(
      32,
      Math.max(12, st.dictFont + step)
    );

    renderDict();
  }

  function dictBold() {
    if (!st.editDictionary) {
      return toast(
        'Bật Edit ON trước khi chỉnh sửa.'
      );
    }

    if (!selectedDictCell) {
      return toast(
        'Chọn một ô English hoặc Tiếng Việt trước.'
      );
    }

    const w = st.dictDraft.find(
      x => x.id === selectedDictCell.id
    );

    if (!w) return;

    const key = selectedDictCell.key + 'Bold';

    w[key] = !w[key];

    renderDict();

    toast(
      'Đã đổi kiểu chữ. Nhấn Save để lưu.'
    );
  }


  /* ==========================================
     8. ADD WORD FROM SELECTED TEXT
     ========================================== */

  function hideContext() {
    $('contextMenu').classList.add('hidden');
  }

  function openWordModal(text) {
    selectedWord = String(text || '')
      .trim()
      .slice(0, 250);

    $('modalEnglish').value = selectedWord;
    $('modalVietnamese').value = '';

    $('wordModal').classList.remove('hidden');
    $('modalVietnamese').focus();
  }

  function addWordModal() {
    const english =
      $('modalEnglish').value.trim();

    const vietnamese =
      $('modalVietnamese').value.trim();

    if (!english || !vietnamese) {
      return toast(
        'Hãy điền tiếng Anh và nghĩa tiếng Việt.'
      );
    }

    if (!st.connected || st.blocked) {
      return toast('Chưa thể lưu dữ liệu.');
    }

    if (st.dictionary.length >= 5000) {
      return toast(
        'Dictionary đã đạt 5.000 từ.'
      );
    }

    if (st.editDictionary) {
      return toast(
        'Hãy Save hoặc tắt Edit trước khi thêm từ.'
      );
    }

    // New word is always inserted at the top.
    st.dictionary.unshift({
      id: uid(),
      english,
      vietnamese,
      englishBold: false,
      vietnameseBold: false
    });

    $('wordModal').classList.add('hidden');

    if (st.mode === 'dictionary') {
      renderDict();
    }

    mark();

    toast('Đã thêm từ vào Dictionary.');
  }


  /* ==========================================
     9. EVENT BINDINGS
     ========================================== */

  function bind() {
    // Folder and notes
    $('newNote').onclick = () => createNote(null);
    $('newFolder').onclick = createFolder;
    $('deleteNote').onclick = deleteNote;

    // Navigation
    $('dictionaryNav').onclick = openDict;

    $('openSidebar').onclick = () => {
      $('sidebar').classList.add('open');
    };

    $('closeSidebar').onclick = closeSidebar;

    // Note title
    $('noteTitle').oninput = () => {
      const n = note();
      if (!n) return;

      n.title = $('noteTitle')
        .value.slice(0, 160);

      $('pageTitle').textContent = n.title;

      list();
      mark();
    };

    // Notes editor
    $('noteEditor').addEventListener(
      'input',
      () => {
        syncEditor();
        mark();
      }
    );

    
// GOOD DOCS v5.2
// Paste HTML and preserve safe text formatting.

$('noteEditor').addEventListener('paste', e => {
    if (!st.connected || st.blocked) return;

    const clipboard = e.clipboardData;

    if (!clipboard) return;

    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');

    e.preventDefault();

    $('noteEditor').focus();

    if (html && html.trim()) {
        // Keep supported rich-text formatting.
        const cleanHTML = sanitize(html);

        document.execCommand(
            'insertHTML',
            false,
            cleanHTML
        );
    } else {
        // Plain text fallback.
        document.execCommand(
            'insertText',
            false,
            text
        );
    }

    syncEditor();
    mark();
});


    $('noteBold').onclick = execBold;

    $('noteIncrease').onclick =
      () => fontNote(2);

    $('noteDecrease').onclick =
      () => fontNote(-2);

    // Dictionary
    $('editToggle').onclick = toggleEdit;
    $('addRow').onclick = addRow;
    $('dictSave').onclick = saveDictionary;

    $('dictIncrease').onclick =
      () => dictFont(2);

    $('dictDecrease').onclick =
      () => dictFont(-2);

    $('dictBold').onclick = dictBold;
    $('searchWord').oninput = renderDict;

    // Right-click to add to Dictionary
    $('noteEditor').addEventListener(
      'contextmenu',
      e => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (
          !text ||
          text.length > 250 ||
          !$('noteEditor').contains(selection.anchorNode) ||
          !$('noteEditor').contains(selection.focusNode)
        ) {
          return;
        }

        selectedWord = text;
        e.preventDefault();

        const menu = $('contextMenu');

        menu.style.left =
          Math.max(
            8,
            Math.min(e.clientX, innerWidth - 220)
          ) + 'px';

        menu.style.top =
          Math.max(
            8,
            Math.min(e.clientY, innerHeight - 55)
          ) + 'px';

        menu.classList.remove('hidden');
      }
    );

    $('contextAdd').onclick = () => {
      hideContext();
      openWordModal(selectedWord);
    };

    document.addEventListener('click', e => {
      if (!$('contextMenu').contains(e.target)) {
        hideContext();
      }
    });

    // Modal
    $('cancelWord').onclick = () => {
      $('wordModal').classList.add('hidden');
    };

    $('confirmWord').onclick = addWordModal;

    $('wordModal').onclick = e => {
      if (e.target === $('wordModal')) {
        $('wordModal').classList.add('hidden');
      }
    };

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        $('wordModal').classList.add('hidden');
        hideContext();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 's'
      ) {
        e.preventDefault();
        saveNow();
      }
    });

    // Warn if there are unsaved changes.
    window.addEventListener('beforeunload', e => {
      if (st.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }


  /* ==========================================
     10. APPLICATION INITIALIZATION
     ========================================== */

  bind();

  enable(false);

  status('Đang tải dữ liệu...');

  // Connect automatically. No Google login button.
  connect();

})();
