'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const cloud=window.GoodDocsCloud;
  const st={notes:[],dictionary:[],revision:0,current:null,mode:'empty',connected:false,dirty:false,blocked:false,saving:false,editDictionary:false,dictDraft:[],dictFont:16,seq:0};
  let timer=null,toastTimer=null,selectedWord='',selectedDictCell=null;
  function uid(){return (crypto.randomUUID?.() || (Date.now()+'-'+Math.random().toString(36).slice(2)));}
  function toast(message){$('toast').textContent=message;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4200);}
  function status(s){$('saveState').textContent=s;$('syncLabel').textContent=s;}
  function enable(ready){for(const id of ['newNote','importFile','exportBtn','reloadBtn'])$(id).disabled=!ready;for(const id of ['noteEditor','noteTitle'])$(id).disabled=!ready;$('noteEditor').contentEditable=ready?'true':'false';$('dictionaryNav').disabled=!ready;}
  function sanitize(html){
    const doc=new DOMParser().parseFromString('<div>'+String(html||'')+'</div>','text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,svg,math,form,link,meta,base').forEach(n=>n.remove());
    doc.body.querySelectorAll('*').forEach(el=>{
      for(const attr of [...el.attributes]){
        const k=attr.name.toLowerCase(),v=attr.value.trim();
        // Imported HTML must not override dark-mode text, width or layout.
        // Keep semantic tags (strong/b/em), strip all imported presentation attributes.
        el.removeAttribute(attr.name);
      }
    });
    return doc.body.firstElementChild?.innerHTML || '';
  }
  function closeSidebar(){$('sidebar').classList.remove('open');}
  function list(){
    const host=$('noteList');host.replaceChildren();
    st.notes.forEach(note=>{
      const btn=document.createElement('button');btn.className='note-row'+(st.mode==='note'&&st.current===note.id?' active':'');btn.textContent='▤  '+(note.title||'Untitled');
      btn.addEventListener('click',()=>openNote(note.id));host.append(btn);
    });
    $('dictionaryNav').classList.toggle('active',st.mode==='dictionary');
  }
  function show(mode){st.mode=mode;for(const v of ['emptyView','noteView','dictView'])$(v).classList.add('hidden');$(mode==='note'?'noteView':mode==='dictionary'?'dictView':'emptyView').classList.remove('hidden');list();closeSidebar();}
  function note(){return st.notes.find(x=>x.id===st.current);}
  function openNote(id){
    if(st.editDictionary && !confirm('Dictionary đang ở Edit ON. Bỏ các thay đổi chưa Save?'))return;
    st.editDictionary=false;
    const n=st.notes.find(x=>x.id===id);if(!n)return;
    st.current=id;$('pageTitle').textContent=n.title;$('noteTitle').value=n.title;$('noteEditor').innerHTML=sanitize(n.html);
    $('noteEditor').style.fontSize=`${n.fontSize||16}px`;$('noteFontSize').textContent=`${n.fontSize||16}px`;
    show('note');
  }
  function openDict(){
    if(st.editDictionary&&!confirm('Bỏ các thay đổi Dictionary chưa Save?'))return;
    st.editDictionary=false;st.dictDraft=structuredClone(st.dictionary);
    $('pageTitle').textContent='Dictionary';$('editToggle').textContent='Edit OFF';$('dictSave').disabled=true;$('addRow').disabled=true;
    renderDict();show('dictionary');
  }
  function changed(){st.dirty=true;if(st.blocked){status('Xung đột — cần tải lại');return;}status('Có thay đổi chưa lưu');clearTimeout(timer);timer=setTimeout(saveNow,1400);}
  function syncEditor(){if(st.mode!=='note'||!note())return;note().html=sanitize($('noteEditor').innerHTML);}
  async function saveNow(){
    clearTimeout(timer);if(!st.connected||!st.dirty||st.blocked)return;
    if(st.saving){timer=setTimeout(saveNow,1000);return;}
    syncEditor();const state={notes:structuredClone(st.notes),dictionary:structuredClone(st.dictionary)};
    const savedSeq=st.seq;st.saving=true;status('Đang lưu lên Google Sheets...');
    try{
      const revision=await cloud.save(state,st.revision);st.revision=revision;
      if(st.seq===savedSeq){st.dirty=false;status('Đã lưu vào Google Sheets ✓');}
      else{status('Có thay đổi mới...');timer=setTimeout(saveNow,250);}
    }catch(e){
      if(e.conflict)st.blocked=true;
      status(e.conflict?'Xung đột — xuất JSON trước khi tải lại':'Lưu thất bại — kiểm tra kết nối');
      toast(e.message);
    }finally{st.saving=false;}
  }
  function mark(){st.seq++;changed();}
  async function connect(){
    try{
      status('Đang kết nối cơ sở dữ liệu...');await cloud.connect();
      if(st.dirty && !confirm('Kết nối sẽ tải dữ liệu từ Google Sheets. Bạn có muốn bỏ những thay đổi chưa lưu không?'))return;
      const data=await cloud.load();Object.assign(st,{notes:data.notes,dictionary:data.dictionary,revision:data.revision,connected:true,dirty:false,blocked:false});
      $('connectBtn').textContent='↻ Đồng bộ dữ liệu';enable(true);status('Đã đồng bộ Google Sheets ✓');
      if(st.current&&st.notes.some(x=>x.id===st.current))openNote(st.current);else if(st.notes.length)openNote(st.notes[0].id);else openDict();
      toast('Đã tải dữ liệu Google Sheets.');
    }catch(e){status('Không tải được dữ liệu');toast(e.message);}
  }
  async function reload(){
    if(!st.connected)return toast('Dữ liệu chưa tải xong.');
    if(st.saving)return toast('Đang lưu, vui lòng thử lại.');
    if(st.dirty&&!confirm('Có thay đổi chưa lưu. Tải lại sẽ bỏ thay đổi hiện tại. Tiếp tục?'))return;
    try{const data=await cloud.load();Object.assign(st,{notes:data.notes,dictionary:data.dictionary,revision:data.revision,blocked:false,dirty:false});st.editDictionary=false;status('Đã tải dữ liệu mới ✓');if(st.mode==='dictionary')openDict();else if(st.notes.some(x=>x.id===st.current))openNote(st.current);else if(st.notes.length)openNote(st.notes[0].id);else openDict();}
    catch(e){toast(e.message);}
  }
  function createNote(){
    if(!st.connected)return toast('Dữ liệu chưa tải xong.');
    if(st.notes.length>=250)return toast('Đã đạt giới hạn 250 ghi chú.');
    const title=prompt('Tên tab mới:','Ghi chú mới');if(title===null)return;
    const n={id:uid(),title:title.trim().slice(0,160)||'Ghi chú mới',html:'',fontSize:16};st.notes.push(n);openNote(n.id);mark();
  }
  function deleteNote(){if(!note()||!confirm(`Xóa tab “${note().title}”?`))return;st.notes=st.notes.filter(x=>x.id!==st.current);st.current=null;if(st.notes.length)openNote(st.notes[0].id);else openDict();mark();}
  function execBold(){if(st.mode!=='note')return;$('noteEditor').focus();document.execCommand('bold',false);syncEditor();mark();}
  function fontNote(step){const n=note();if(!n)return;n.fontSize=Math.min(32,Math.max(12,(n.fontSize||16)+step));$('noteEditor').style.fontSize=n.fontSize+'px';$('noteFontSize').textContent=n.fontSize+'px';mark();}
  function escapeCsv(x){return '"'+String(x??'').replaceAll('"','""')+'"';}
  function renderDict(){
    const host=$('dictBody');host.replaceChildren();const q=$('searchWord').value.trim().toLocaleLowerCase();const words=st.editDictionary?st.dictDraft:st.dictionary;
    let count=0;
    words.forEach(w=>{
      if(q&&!`${w.english} ${w.vietnamese}`.toLocaleLowerCase().includes(q))return;
      count++;const tr=document.createElement('tr');
      ['english','vietnamese'].forEach(key=>{
        const td=document.createElement('td'),div=document.createElement('div');
        div.textContent=w[key]||'';div.contentEditable=st.editDictionary?'true':'false';div.style.fontSize=st.dictFont+'px';
        div.dataset.id=w.id;div.dataset.key=key;div.style.fontWeight=w[key+'Bold']?'700':'400';
        div.addEventListener('focus',()=>selectedDictCell={id:w.id,key});
        div.addEventListener('input',()=>{w[key]=div.innerText;});
        div.addEventListener('paste',e=>{if(!st.editDictionary)return;e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));});
        td.append(div);tr.append(td);
      });
      const action=document.createElement('td');if(st.editDictionary){const b=document.createElement('button');b.className='remove-word';b.textContent='✕';b.title='Xóa hàng';b.onclick=()=>{st.dictDraft=st.dictDraft.filter(x=>x.id!==w.id);renderDict();};action.append(b);}tr.append(action);host.append(tr);
    });
    $('dictCount').textContent=count+' từ';$('dictFontSize').textContent=st.dictFont+'px';
  }
  function toggleEdit(){
    if(!st.connected)return toast('Dữ liệu chưa tải xong.');
    if(st.editDictionary && !confirm('Tắt Edit sẽ bỏ các thay đổi chưa Save. Tiếp tục?'))return;
    st.editDictionary=!st.editDictionary;st.dictDraft=structuredClone(st.dictionary);
    $('editToggle').textContent=st.editDictionary?'Edit ON':'Edit OFF';$('dictSave').disabled=!st.editDictionary;$('addRow').disabled=!st.editDictionary;renderDict();
  }
  function addRow(){if(!st.editDictionary)return;st.dictDraft.push({id:uid(),english:'',vietnamese:''});renderDict();const all=$('dictBody').querySelectorAll('[contenteditable="true"]');all[all.length-2]?.focus();}
  function saveDictionary(){
    if(!st.editDictionary)return;
    if(st.dictDraft.length>5000)return toast('Dictionary tối đa 5.000 từ.');
    const trim=w=>({id:w.id,english:String(w.english||'').trim(),vietnamese:String(w.vietnamese||'').trim(),englishBold:!!w.englishBold,vietnameseBold:!!w.vietnameseBold});
    st.dictionary=st.dictDraft.map(trim).filter(w=>w.english||w.vietnamese);
    st.editDictionary=false;st.dictDraft=structuredClone(st.dictionary);$('editToggle').textContent='Edit OFF';$('dictSave').disabled=true;$('addRow').disabled=true;renderDict();mark();saveNow();
  }
  function dictFont(step){st.dictFont=Math.min(32,Math.max(12,st.dictFont+step));renderDict();}
  function dictBold(){if(!st.editDictionary)return toast('Bật Edit ON trước khi chỉnh sửa.');if(!selectedDictCell)return toast('Chọn một ô English hoặc Tiếng Việt trước.');const w=st.dictDraft.find(x=>x.id===selectedDictCell.id);if(!w)return;const key=selectedDictCell.key+'Bold';w[key]=!w[key];renderDict();toast('Đã thay đổi kiểu chữ cho ô. Nhấn Save để lưu.');}
  function hideContext(){$('contextMenu').classList.add('hidden');}
  function openWordModal(text){selectedWord=String(text||'').trim().slice(0,250);$('modalEnglish').value=selectedWord;$('modalVietnamese').value='';$('wordModal').classList.remove('hidden');$('modalVietnamese').focus();}
  function addWordModal(){
    const english=$('modalEnglish').value.trim(),vietnamese=$('modalVietnamese').value.trim();
    if(!english||!vietnamese)return toast('Hãy điền cả từ tiếng Anh và nghĩa tiếng Việt.');
    if(!st.connected)return toast('Dữ liệu chưa tải xong.');
    if(st.dictionary.length>=5000)return toast('Dictionary đã đạt 5.000 từ.');
    st.dictionary.push({id:uid(),english,vietnamese,englishBold:false,vietnameseBold:false});$('wordModal').classList.add('hidden');
    if(st.mode==='dictionary'&&!st.editDictionary)renderDict();mark();toast('Đã thêm từ vào Dictionary.');
  }
  function exportJSON(){
    if(!st.connected)return toast('Chưa có dữ liệu. Hãy kết nối Google.');
    syncEditor();const obj={version:4,exportedAt:new Date().toISOString(),notes:st.notes,dictionary:st.dictionary};
    const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`gooddocs-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importJSON(ev){
    const file=ev.target.files?.[0];ev.target.value='';if(!file||!st.connected)return;
    try{const obj=JSON.parse(await file.text());if(!Array.isArray(obj.notes)||!Array.isArray(obj.dictionary))throw new Error('File không phải bản sao lưu Good Docs hợp lệ.');
      if(!confirm('Nhập JSON sẽ thay toàn bộ ghi chú và Dictionary hiện tại. Hãy xuất bản sao lưu trước. Tiếp tục?'))return;
      st.notes=obj.notes.map(n=>({id:String(n.id||uid()),title:String(n.title||'Untitled'),html:sanitize(n.html??n.content??''),fontSize:Math.min(32,Math.max(12,Number(n.fontSize)||16))}));
      st.dictionary=obj.dictionary.map(w=>({id:String(w.id||uid()),english:String(w.english||''),vietnamese:String(w.vietnamese||''),englishBold:!!w.englishBold,vietnameseBold:!!w.vietnameseBold}));
      if(st.notes.length>250||st.dictionary.length>5000)throw new Error('Bản nhập vượt giới hạn.');
      st.current=null;openDict();mark();await saveNow();toast('Đã nhập dữ liệu.');
    }catch(e){toast(e.message);}
  }
  function bind(){
    $('connectBtn').onclick=connect;$('reloadBtn').onclick=reload;$('newNote').onclick=createNote;$('deleteNote').onclick=deleteNote;
    $('dictionaryNav').onclick=openDict;$('openSidebar').onclick=()=>$('sidebar').classList.add('open');$('closeSidebar').onclick=closeSidebar;
    $('noteTitle').oninput=()=>{const n=note();if(n){n.title=$('noteTitle').value.slice(0,160);$('pageTitle').textContent=n.title;list();mark();}};
    $('noteEditor').addEventListener('input',()=>{syncEditor();mark();});
    $('noteBold').onclick=execBold;$('noteIncrease').onclick=()=>fontNote(2);$('noteDecrease').onclick=()=>fontNote(-2);
    $('editToggle').onclick=toggleEdit;$('addRow').onclick=addRow;$('dictSave').onclick=saveDictionary;
    $('dictIncrease').onclick=()=>dictFont(2);$('dictDecrease').onclick=()=>dictFont(-2);$('dictBold').onclick=dictBold;
    $('searchWord').oninput=renderDict;$('exportBtn').onclick=exportJSON;$('importFile').onchange=importJSON;
    $('noteEditor').addEventListener('contextmenu',e=>{const selection=window.getSelection();const text=selection?.toString().trim();if(!text||text.length>250||!$('noteEditor').contains(selection.anchorNode)||!$('noteEditor').contains(selection.focusNode))return;selectedWord=text;e.preventDefault();const menu=$('contextMenu');menu.style.left=Math.min(e.clientX,innerWidth-220)+'px';menu.style.top=Math.min(e.clientY,innerHeight-55)+'px';menu.classList.remove('hidden');});
    $('contextAdd').onclick=()=>{hideContext();openWordModal(selectedWord);};document.addEventListener('click',e=>{if(!$('contextMenu').contains(e.target))hideContext();});
    $('cancelWord').onclick=()=>$('wordModal').classList.add('hidden');$('confirmWord').onclick=addWordModal;
    $('wordModal').onclick=e=>{if(e.target===$('wordModal'))$('wordModal').classList.add('hidden');};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('wordModal').classList.add('hidden');hideContext();}if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveNow();}});
    window.addEventListener('beforeunload',e=>{if(st.dirty){e.preventDefault();e.returnValue='';}});
  }
  bind();enable(false);status('Đang tải dữ liệu...');connect();
})();
