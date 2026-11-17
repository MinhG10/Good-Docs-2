/* Good Docs v5: PUBLIC Apps Script bridge. No OAuth.
   READ: JSONP from doGet (documented Apps Script technique).
   WRITE: cross-origin hidden FORM POST + JSONP receipt polling, no CORS dependency.
   NEVER consider a form submit itself proof that a save succeeded.
*/
'use strict';
window.GoodDocsCloud = (() => {
  const CFG = window.GOODDOCS_CONFIG || {};
  const CALLBACKS = window.GoodDocsCallbacks = {};
  let counter = 0;
  const TIMEOUT = 25000;

  function validate() {
    const url = String(CFG.webAppUrl || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/?#]+\/exec$/.test(url)) {
      throw new Error('Hãy điền URL Google Apps Script Web App /exec vào config.js.');
    }
    return url;
  }
  function jsonp(params, timeout=TIMEOUT) {
    const base = validate();
    const key = 'cb_' + (++counter);
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      let settled = false;
      const finish=(err,value)=>{
        if(settled)return;settled=true;
        clearTimeout(timer);delete CALLBACKS[key];script.remove();
        if(err)reject(err);else resolve(value);
      };
      CALLBACKS[key] = payload => finish(null,payload);
      const query = new URLSearchParams({...params,callback:'GoodDocsCallbacks.'+key,_:String(Date.now())});
      const timer = setTimeout(()=>finish(new Error('API không phản hồi. Kiểm tra URL /exec, quyền Anyone và mạng.')),timeout);
      script.onerror = () => finish(new Error('Không tải được API Apps Script. Hãy kiểm tra quyền truy cập Anyone.'));
      script.src = base + '?' + query;
      document.head.appendChild(script);
    });
  }
  function check(result) {
    if(!result?.ok) {
      const err = new Error(result?.error || 'Apps Script trả về lỗi không xác định.');
      err.conflict = !!result?.conflict || String(result?.error||'').startsWith('CONFLICT:');
      throw err;
    }
    return result;
  }
  async function connect() { validate(); return true; }
  async function meta() {return check(await jsonp({action:'meta'})).meta;}
  function utf8ToBase64(text) {
    const bytes=new TextEncoder().encode(text);
    const parts=[];
    for(let i=0;i<bytes.length;i+=8192)parts.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
    return btoa(parts.join(''));
  }
  function base64ToUtf8(base64) {
    const binary=atob(base64),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }
  async function load() {
    for(let attempt=0;attempt<2;attempt++) {
      const head = await meta();
      if(!head.chunks)return {notes:[],dictionary:[],revision:head.revision};
      const parts=new Array(head.chunks);
      // Limit concurrency to avoid throttling Apps Script quotas.
      let next=0;
      async function worker(){
        while(next<head.chunks) {
          const i=next++;
          const r=check(await jsonp({action:'chunk',slot:head.slot,revision:String(head.revision),index:String(i)}));
          if(r.index!==i || r.revision!==head.revision)throw new Error('Snapshot changed; reload.');
          parts[i]=r.data;
        }
      }
      try {
        await Promise.all(Array.from({length:Math.min(4,head.chunks)},worker));
        const verify=await meta();
        if(verify.revision!==head.revision||verify.slot!==head.slot)continue;
        const state=JSON.parse(base64ToUtf8(parts.join('')));
        if(!Array.isArray(state.notes)||!Array.isArray(state.dictionary))throw new Error('Snapshot không hợp lệ.');
        return {notes:state.notes,dictionary:state.dictionary,revision:head.revision};
      }catch(error) {
        if(String(error.message).includes('Snapshot changed')&&attempt===0)continue;
        throw error;
      }
    }
    throw new Error('Dữ liệu thay đổi trong lúc tải. Hãy thử lại.');
  }
  function postForm(fields) {
    const id='gooddocs_post_'+Math.random().toString(36).slice(2);
    const iframe=document.createElement('iframe');
    iframe.name=id;iframe.title='Good Docs save';iframe.style.display='none';
    const form=document.createElement('form');
    form.action=validate();form.method='POST';form.target=id;form.style.display='none';
    for(const [name,value] of Object.entries(fields)) {
      const input=document.createElement('input');input.type='hidden';input.name=name;input.value=String(value);form.appendChild(input);
    }
    document.body.append(iframe,form);
    try{form.submit();}catch(err){form.remove();iframe.remove();throw err;}
    // The iframe is cross-origin: its response is NOT readable. Poll receipt instead.
    return ()=>{form.remove();iframe.remove();};
  }
  async function save(state,expectedRevision) {
    if(!Array.isArray(state.notes)||!Array.isArray(state.dictionary))throw new Error('Dữ liệu không hợp lệ.');
    const payload=utf8ToBase64(JSON.stringify(state));
    if(payload.length>1200000)throw new Error('Vượt giới hạn 1,2 triệu ký tự Base64 của phiên bản này. Hãy xuất JSON để sao lưu và chia nhỏ thư viện.');
    const requestId='req_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    const cleanup=postForm({action:'save',requestId,expectedRevision,payload});
    const start=Date.now();
    try {
      while(Date.now()-start<95000) {
        await new Promise(r=>setTimeout(r,1400));
        let result;
        try{result=await jsonp({action:'receipt',id:requestId});}
        catch(err){continue;} // Might be a temporary network/CORS-independent script failure.
        if(result?.pending)continue;
        return check(result).revision;
      }
      // Request may have succeeded despite a lost receipt; inspect head before reporting uncertainty.
      const head=await meta();
      if(head.lastRequestId===requestId)return head.revision;
      throw new Error('Không xác nhận được kết quả lưu. Không chỉnh sửa trên thiết bị khác; tải lại và kiểm tra trước khi thử tiếp.');
    }finally{cleanup();}
  }
  return {connect,load,save,hasToken:()=>true};
})();
