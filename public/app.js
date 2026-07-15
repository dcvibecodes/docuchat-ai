(function() {
  'use strict';

  const state = { user: null, conversations: [], currentConversation: null, messages: [], documents: [], isGenerating: false, abortController: null, uploadedThisSession: new Set() };

  // ── Theme ──
  function getSystemTheme() { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function applyTheme(choice) {
    const effective = choice === 'auto' ? getSystemTheme() : choice;
    document.documentElement.setAttribute('data-theme', effective);
  }
  function initTheme() {
    const saved = localStorage.getItem('docuchat-theme') || 'auto';
    applyTheme(saved);
    // Listen for system theme changes when in auto mode
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem('docuchat-theme') || 'auto') === 'auto') applyTheme('auto');
    });
    return saved;
  }
  const currentTheme = initTheme();

  // ── Text Size ──
  // Range: 14px (-1) to 17px (+2), default 15px (0). Each step = 1px.
  // Capped to prevent UI element displacement at max size.
  let textSizeLevel = parseInt(localStorage.getItem('docuchat-textsize') || '0', 10);
  function applyTextSize(level) {
    textSizeLevel = Math.max(-1, Math.min(2, level));
    document.documentElement.style.fontSize = (15 + textSizeLevel) + 'px';
    localStorage.setItem('docuchat-textsize', textSizeLevel);
  }
  applyTextSize(textSizeLevel);

  // ── API ──
  const api = {
    async request(path, opts = {}) {
      const { method = 'GET', body } = opts;
      const cfg = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
      if (body) cfg.body = JSON.stringify(body);
      const res = await fetch('/api' + path, cfg);
      if (res.status === 401) { showAuth(); throw new Error('Session expired'); }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Request failed');
      return data;
    },
    get(p) { return this.request(p); },
    post(p, b) { return this.request(p, { method: 'POST', body: b }); },
    patch(p, b) { return this.request(p, { method: 'PATCH', body: b }); },
    put(p, b) { return this.request(p, { method: 'PUT', body: b }); },
    del(p) { return this.request(p, { method: 'DELETE' }); }
  };

  // ── Helpers ──
  function $(id) { return document.getElementById(id); }
  function toast(msg, type) { const t = document.createElement('div'); t.className = 'toast ' + (type||'info'); t.textContent = msg; $('toast-container').appendChild(t); setTimeout(() => t.remove(), 3500); }
  function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function fmtBytes(b) { if (!b) return '0 B'; const u = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(1024)); return (b/Math.pow(1024,i)).toFixed(1)+' '+u[i]; }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''; }
  function md(t) {
    if (!t) return '';
    // Code blocks first (protect from other transforms)
    t = t.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold and italic
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Headings
    t = t.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    t = t.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    t = t.replace(/^# (.+)$/gm, '<h3>$1</h3>');
    // Tables: detect markdown tables and convert to HTML
    t = t.replace(/(?:^\|.+\|[ \t]*\n\|[-| :]+\|[ \t]*\n(?:\|.+\|[ \t]*\n?)+)/gm, function(match) {
      const rows = match.trim().split('\n');
      if (rows.length < 2) return match;
      const headers = rows[0].split('|').filter(c => c.trim()).map(c => '<th>' + c.trim() + '</th>');
      const bodyRows = rows.slice(2).map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => '<td>' + c.trim() + '</td>');
        return '<tr>' + cells.join('') + '</tr>';
      });
      return '<table><thead><tr>' + headers.join('') + '</tr></thead><tbody>' + bodyRows.join('') + '</tbody></table>';
    });
    // Lists: collect consecutive list items (even separated by single blank lines)
    t = t.replace(/(?:^[ \t]*\d+\. .+(?:\n(?:[ \t]+.+)?)*(?:\n\n?)?)+/gm, function(match) {
      const items = match.trim().split(/\n(?=\d+\. )/).map(item => {
        const content = item.replace(/^\d+\.\s*/, '').replace(/\n\s*/g, ' ').trim();
        return '<li>' + content + '</li>';
      });
      return '<ol>' + items.join('') + '</ol>';
    });
    t = t.replace(/(?:^[ \t]*[-•] .+(?:\n(?:[ \t]+.+)?)*(?:\n\n?)?)+/gm, function(match) {
      const items = match.trim().split(/\n(?=[-•] )/).map(item => {
        const content = item.replace(/^[-•]\s*/, '').replace(/\n\s*/g, ' ').trim();
        return '<li>' + content + '</li>';
      });
      return '<ul>' + items.join('') + '</ul>';
    });
    // Clickable URLs (must come after code blocks to avoid linkifying code)
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    t = t.replace(/((?<!")(?<!')|^)(https?:\/\/[^\s<"']+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    // Paragraphs
    t = t.replace(/\n\n/g, '</p><p>');
    t = t.replace(/\n/g, '<br>');
    return t;
  }

  // ── Screens ──
  function showAuth() { $('auth-screen').classList.add('active'); $('main-app').classList.remove('active'); document.body.classList.remove('is-admin'); document.body.classList.remove('is-techadmin'); state.user = null; }
  function showApp() { $('auth-screen').classList.remove('active'); $('main-app').classList.add('active'); $('main-app').style.display = 'flex'; }

  function switchView(name) {
    if ((name === 'documents' || name === 'admin' || name === 'chat-logs') && state.user?.role === 'user') return;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(name + '-view').classList.add('active');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-view="'+name+'"]')?.classList.add('active');
    if (name === 'documents') loadDocuments();
    if (name === 'admin') loadAdminData();
    if (name === 'chat-logs') loadChatLogs();
    if (name === 'chat' && !state.messages.length) loadSuggestedPromptsChat();
  }

  // ── Auth ──
  async function handleLogin(e) {
    e.preventDefault(); $('auth-error').textContent = '';
    try { await api.post('/auth/login', { username: $('login-username').value, password: $('login-password').value }); await initApp(); }
    catch (err) { $('auth-error').textContent = err.message; }
  }
  async function handleSetup(e) {
    e.preventDefault(); $('auth-error').textContent = '';
    try { await api.post('/auth/setup', { username: $('setup-username').value, name: $('setup-name').value, password: $('setup-password').value }); await initApp(); }
    catch (err) { $('auth-error').textContent = err.message; }
  }
  async function checkSetup() {
    try { const r = await api.get('/auth/needs-setup'); if (r.needsSetup) { $('login-form').classList.remove('active'); $('setup-form').classList.add('active'); } else { $('setup-form').classList.remove('active'); $('login-form').classList.add('active'); } } catch {}
  }
  async function initApp() {
    showApp();
    try { state.user = await api.get('/auth/profile'); $('username-display').textContent = state.user.username; if (state.user.role === 'admin' || state.user.role === 'techadmin') document.body.classList.add('is-admin'); else document.body.classList.remove('is-admin'); if (state.user.role === 'techadmin') document.body.classList.add('is-techadmin'); else document.body.classList.remove('is-techadmin'); }
    catch { showAuth(); return; }
    await loadConversations();
    loadSuggestedPromptsChat();
  }

  // ── Conversations ──
  async function loadConversations() { try { state.conversations = await api.get('/chat/conversations'); renderConvos(); } catch(e) { console.error(e); } }
  function renderConvos() {
    const pinned = state.conversations.filter(c => c.pinned);
    const regular = state.conversations.filter(c => !c.pinned);
    $('pinned-chats').innerHTML = pinned.map(convoItem).join('');
    $('chat-list').innerHTML = regular.length ? regular.map(convoItem).join('') : '';
  }
  function convoItem(c) { const pin = c.pinned ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;opacity:0.5"><path d="M16 2L14.5 3.5l1 1-4.5 4.5H7l-2 2 4.5 2.5L5 18l1 1 4.5-4.5L13 19l2-2v-4l4.5-4.5 1 1L22 8z"/></svg>' : ''; return '<div class="chat-item'+(state.currentConversation?.id===c.id?' active':'')+'" data-cid="'+c.id+'">'+pin+'<span class="chat-item-title">'+esc(c.title)+'</span></div>'; }

  async function selectChat(id) {
    try {
      state.currentConversation = await api.get('/chat/conversations/'+id);
      $('current-chat-title').textContent = state.currentConversation.title;
      state.messages = await api.get('/chat/conversations/'+id+'/messages');
      renderConvos(); renderMessages(true); updatePinBtn();
    } catch(err) { toast(err.message, 'error'); }
  }
  async function newChat() {
    // Prevent creating multiple blank conversations — if current chat has no messages or only a pending send, just focus it
    if (state.currentConversation && state.messages.length === 0) {
      $('chat-input')?.focus();
      return;
    }
    // Also prevent if the current chat only has user messages with no assistant reply yet
    if (state.currentConversation && state.messages.length > 0 && !state.messages.some(m => m.role === 'assistant')) {
      $('chat-input')?.focus();
      return;
    }
    try { const c = await api.post('/chat/conversations', {title:'New Conversation'}); state.conversations.unshift(c); state.currentConversation = c; state.messages = []; renderConvos(); renderMessages(); $('current-chat-title').textContent = c.title; loadSuggestedPromptsChat(); await pruneOldChats(); }
    catch(err) { toast(err.message, 'error'); }
  }
  async function pruneOldChats() {
    // Keep max 20 conversations — auto-delete oldest unpinned ones
    const MAX_CHATS = 20;
    const unpinned = state.conversations.filter(c => !c.pinned);
    if (state.conversations.length > MAX_CHATS) {
      const toDelete = unpinned.slice(MAX_CHATS - state.conversations.filter(c=>c.pinned).length);
      for (const c of toDelete) { try { await api.del('/chat/conversations/'+c.id); } catch {} }
      state.conversations = state.conversations.filter(c => !toDelete.find(d=>d.id===c.id));
      renderConvos();
    }
  }
  async function clearAllChats() {
    if (!confirm('Clear all conversations? This cannot be undone.')) return;
    const btn = $('clear-chats-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Clearing...'; }
    try {
      const total = state.conversations.length;
      for (let i = 0; i < total; i++) {
        const c = state.conversations[0];
        try { await api.del('/chat/conversations/'+c.id); } catch {}
        state.conversations.shift();
        renderConvos();
      }
      state.currentConversation = null; state.messages = [];
      renderConvos(); renderMessages(); $('current-chat-title').textContent = 'New Conversation';
      toast('All conversations cleared', 'success');
    } catch(err) { toast(err.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Clear All'; } }
  }
  async function deleteChat() {
    if (!state.currentConversation) return;
    const id = state.currentConversation.id;
    // Immediately remove from UI
    state.conversations = state.conversations.filter(c=>c.id!==id);
    state.currentConversation = null; state.messages = [];
    renderConvos(); renderMessages(); $('current-chat-title').textContent='New Conversation';
    // Then delete on server (fire-and-forget with error recovery)
    try { await api.del('/chat/conversations/'+id); }
    catch(err) { toast(err.message,'error'); await loadConversations(); }
  }
  async function pinChat() {
    if (!state.currentConversation) return;
    try { const u = await api.patch('/chat/conversations/'+state.currentConversation.id, {pinned:!state.currentConversation.pinned}); state.currentConversation=u; const i=state.conversations.findIndex(c=>c.id===u.id); if(i>=0) state.conversations[i]=u; renderConvos(); updatePinBtn(); toast(u.pinned?'Pinned':'Unpinned','success'); }
    catch(err) { toast(err.message,'error'); }
  }
  function updatePinBtn() {
    const btn = $('pin-chat-btn');
    if (state.currentConversation?.pinned) { btn.title = 'Unpin'; btn.style.background = 'var(--accent-dim)'; btn.style.borderColor = 'var(--accent)'; }
    else { btn.title = 'Pin'; btn.style.background = ''; btn.style.borderColor = ''; }
  }

  // ── Messages ──
  function renderMessages(scroll) {
    const el = $('chat-messages');
    if (!state.messages.length) { el.innerHTML = ''; return; }
    el.innerHTML = state.messages.map(msgHtml).join('');
    if (scroll) el.scrollTop = el.scrollHeight;
  }
  function msgHtml(m) {
    const isUser = m.role === 'user';
    const avatar = isUser ? (state.user?.username?.[0]||'U').toUpperCase() : 'AI';
    const content = isUser ? esc(m.content) : md(m.content);
    const cites = m.citations ? (typeof m.citations==='string' ? JSON.parse(m.citations) : m.citations) : null;
    const citesHtml = cites?.length ? '<div class="citations"><strong>Sources:</strong> '+cites.map(c=>'<span class="citation-link">'+esc(c.documentName)+(c.pageNumber?' p.'+c.pageNumber:'')+'</span>').join('')+'</div>' : '';
    const actions = !isUser ? '<div class="message-actions"><button data-action="copy" data-mid="'+m.id+'">Copy</button><button data-action="regen">Regenerate</button></div>' : '';
    return '<div class="message '+m.role+'"><div class="message-avatar">'+avatar+'</div><div class="message-body">'+content+citesHtml+actions+'</div></div>';
  }

  async function sendMsg(e) {
    if (e) e.preventDefault();
    const inp = $('chat-input'); const msg = inp.value.trim();
    if (!msg || state.isGenerating) return;
    // Immediately lock to prevent double-send (especially on mobile)
    state.isGenerating = true;
    $('send-btn').disabled = true;
    inp.value=''; inp.style.height='auto';
    if (!state.currentConversation) await newChat();
    state.messages.push({id:'t'+Date.now(), role:'user', content:msg});
    renderMessages(true);
    $('typing-indicator').classList.remove('hidden');
    $('stop-btn').classList.remove('hidden');
    try {
      state.abortController = new AbortController();
      const res = await fetch('/api/chat/conversations/'+state.currentConversation.id+'/messages?stream=true', { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body:JSON.stringify({message:msg}), signal:state.abortController.signal });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error?.message||'Failed'); }
      const aMsg = {id:'s'+Date.now(), role:'assistant', content:'', citations:[]};
      state.messages.push(aMsg); renderMessages(true);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let full='';
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        for (const line of dec.decode(value,{stream:true}).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try { const d=JSON.parse(line.slice(6)); if(d.type==='chunk'){full+=d.content;updateLast(full);}else if(d.type==='done'){aMsg.id=d.message.id;aMsg.content=d.message.content;aMsg.citations=d.citations;renderMessages();}else if(d.type==='error'){toast(d.message,'error');} } catch{}
        }
      }
      if (state.currentConversation.title==='New Conversation'&&state.messages.length<=3) { const title=msg.length>40?msg.substring(0,40)+'...':msg; await api.patch('/chat/conversations/'+state.currentConversation.id,{title}); state.currentConversation.title=title; $('current-chat-title').textContent=title; renderConvos(); }
    } catch(err) { if(err.name!=='AbortError') toast(err.message,'error'); }
    finally { state.isGenerating=false; $('typing-indicator').classList.add('hidden'); $('send-btn').disabled=false; $('stop-btn').classList.add('hidden'); }
  }
  function updateLast(text) { const msgs=document.querySelectorAll('.message.assistant'); const last=msgs[msgs.length-1]; if(last) last.querySelector('.message-body').innerHTML=md(text); }
  function stopGen() { if(state.abortController){state.abortController.abort();state.abortController=null;} }
  async function regen() { if(!state.currentConversation||state.isGenerating) return; state.isGenerating=true; $('typing-indicator').classList.remove('hidden'); try { const r=await api.post('/chat/conversations/'+state.currentConversation.id+'/regenerate'); const i=state.messages.length-1; if(state.messages[i]?.role==='assistant') state.messages[i]={...r,citations:r.citations?(typeof r.citations==='string'?JSON.parse(r.citations):r.citations):[]}; renderMessages(); } catch(err){toast(err.message,'error');} finally{state.isGenerating=false;$('typing-indicator').classList.add('hidden');} }
  function copyMsg(id) { const m=state.messages.find(x=>x.id===id); if(m) navigator.clipboard.writeText(m.content).then(()=>toast('Copied','success')); }

  // ── Speech Recognition (Dictation) ──
  let speechRecognition = null;
  let isRecording = false;
  let micTranscript = '';
  function initSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return; // Not supported — mic button stays hidden
    $('mic-btn').style.display = '';
    speechRecognition = new SR();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = navigator.language || 'en-US';
    speechRecognition.onresult = function(e) {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) { micTranscript += e.results[i][0].transcript + ' '; }
        else { interim += e.results[i][0].transcript; }
      }
      const inp = $('chat-input');
      inp.value = micTranscript + interim;
      inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
    };
    speechRecognition.onerror = function(e) {
      if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Mic error: ' + e.error, 'error');
      stopRecording();
    };
    speechRecognition.onend = function() { stopRecording(); };
  }
  function toggleRecording() {
    if (isRecording) { stopRecording(); } else { startRecording(); }
  }
  function startRecording() {
    if (!speechRecognition) return;
    isRecording = true;
    $('mic-btn').classList.add('recording');
    micTranscript = $('chat-input').value; // preserve existing text
    try { speechRecognition.start(); } catch(e) { /* already started */ }
  }
  function stopRecording() {
    isRecording = false;
    $('mic-btn').classList.remove('recording');
    try { speechRecognition.stop(); } catch(e) { /* ignore */ }
  }

  // ── Documents ──
  let docPoll = null;
  let selectedDocs = new Set();

  async function loadDocuments() {
    try {
      state.documents = await api.get('/documents');
      renderDocs();
      startDocPoll();
    } catch(err){toast(err.message,'error');}
  }
  function startDocPoll() { if(state.documents.some(d=>d.status==='processing')||state.uploadedThisSession.size>0){if(!docPoll) docPoll=setInterval(async()=>{try{state.documents=await api.get('/documents');renderDocs();if(!state.documents.some(d=>d.status==='processing')){clearInterval(docPoll);docPoll=null;state.uploadedThisSession.clear();}}catch{}},3000);}else{if(docPoll){clearInterval(docPoll);docPoll=null;}} }

  function updateBatchBar() {
    const bar = $('batch-bar');
    if (selectedDocs.size > 0) {
      bar.classList.remove('hidden');
      $('batch-count').textContent = selectedDocs.size + ' selected';
    } else {
      bar.classList.add('hidden');
    }
  }

  function renderDocs(filter) {
    const search = filter !== undefined ? filter : ($('doc-search')?.value?.toLowerCase()||'');
    const container = $('documents-list');
    const filtered = state.documents.filter(d => !search || d.original_name.toLowerCase().includes(search));

    if (!filtered.length) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-faint);font-size:0.76rem;">'+(search?'No match.':'No documents yet. Upload a file or add a URL above.')+'</div>';
      $('storage-info').textContent='';
      updateBatchBar();
      return;
    }

    container.innerHTML = filtered.map(doc => {
      let badge;
      if (doc.status === 'processing') {
        const pct = doc.processing_progress || 0;
        badge = '<span class="doc-badge processing">processing</span><div class="doc-progress-bar"><div class="doc-progress-fill" style="width:'+pct+'%"></div></div>';
      } else if (doc.status === 'error') { badge = '<span class="doc-badge error">error</span>'; }
      else if (state.uploadedThisSession.has(doc.id) && doc.status === 'ready') { badge = '<span class="doc-badge ready">ready</span>'; }
      else if (doc.status === 'ready') { badge = '<span class="doc-badge ready">ready</span>'; }
      else { badge = '<span class="doc-badge processing">queued</span>'; }
      const err = doc.status==='error'&&doc.error_message?'<div class="doc-error">'+esc(doc.error_message)+'</div>':'';
      const retryBtn = doc.status==='error'?'<button class="doc-delete-btn" data-action="retry" data-did="'+doc.id+'" style="color:var(--primary);border-color:var(--primary)">Retry</button>':'';
      const enabled = doc.enabled !== 0;
      const enabledClass = enabled ? '' : ' disabled';
      const toggleTitle = enabled ? 'Disable this source' : 'Enable this source';
      const checked = selectedDocs.has(doc.id) ? ' checked' : '';
      const editBtn = doc.file_type === 'note' ? '<button class="doc-delete-btn" data-action="edit-note" data-did="'+doc.id+'" style="color:var(--primary);border-color:var(--primary)">Edit</button>' : '';
      const isEditing = editingNoteId === doc.id;
      const editArea = isEditing ? '<div class="note-edit-area"><textarea data-did="'+doc.id+'" rows="6" placeholder="Loading..."></textarea><div class="note-edit-actions"><button class="btn btn-ghost btn-sm" data-action="cancel-edit-note">Cancel</button><button class="btn btn-primary btn-sm" data-action="save-edit-note" data-did="'+doc.id+'">Save</button></div></div>' : '';
      return '<div class="doc-row'+enabledClass+'" data-docid="'+doc.id+'"><input type="checkbox" class="doc-checkbox" data-action="select-doc" data-did="'+doc.id+'"'+checked+'><div class="doc-icon '+doc.file_type+'">'+(doc.file_type==='note'?'note':doc.file_type)+'</div><div class="doc-info"><div class="doc-name">'+esc(doc.original_name)+'</div><div class="doc-meta-line"><span>'+fmtBytes(doc.file_size)+'</span>'+(doc.page_count?'<span>'+doc.page_count+' pages</span>':'')+'<span>'+fmtDate(doc.uploaded_at)+'</span></div>'+err+editArea+'</div>'+badge+'<div class="doc-row-actions">'+retryBtn+editBtn+'<label class="source-toggle" title="'+toggleTitle+'"><input type="checkbox" '+(enabled?'checked':'')+' data-action="toggle-doc" data-did="'+doc.id+'"><span class="toggle-slider"></span></label><button class="doc-delete-btn" data-action="delete-doc" data-did="'+doc.id+'">Delete</button></div></div>';
    }).join('');

    const total = state.documents.reduce((s,d)=>s+d.file_size,0);
    const enabledCount = state.documents.filter(d => d.enabled !== 0).length;
    let info = state.documents.length + ' document' + (state.documents.length !== 1 ? 's' : '');
    info += ' · ' + fmtBytes(total);
    if (enabledCount < state.documents.length) info += ' · ' + enabledCount + ' active';
    $('storage-info').textContent = info;
    updateBatchBar();
  }

  async function deleteDoc(id) {
    if (!confirm('Delete this document permanently from the knowledge base?')) return;
    const row = document.querySelector('[data-docid="'+id+'"]');
    const btn = row ? row.querySelector('[data-action="delete-doc"]') : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; btn.style.color = 'var(--text-faint)'; }
    try {
      await api.del('/documents/'+id);
      toast('Deleted','success');
      state.documents = state.documents.filter(d => d.id !== id);
      selectedDocs.delete(id);
      renderDocs();
    } catch(err) {
      toast(err.message,'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Delete'; btn.style.color = ''; }
    }
  }

  async function batchDelete() {
    if (!selectedDocs.size) return;
    const count = selectedDocs.size;
    if (!confirm('Delete ' + count + ' document' + (count > 1 ? 's' : '') + ' permanently? This cannot be undone.')) return;
    const btn = $('batch-delete-btn');
    btn.disabled = true; btn.textContent = 'Deleting ' + count + '...';
    const ids = Array.from(selectedDocs);
    try {
      const result = await api.post('/documents/batch-delete', { ids });
      state.documents = state.documents.filter(d => !selectedDocs.has(d.id));
      selectedDocs.clear();
      renderDocs();
      let msg = result.deleted + ' document' + (result.deleted > 1 ? 's' : '') + ' deleted';
      if (result.failed > 0) msg += ' (' + result.failed + ' failed)';
      toast(msg, result.failed > 0 ? 'warning' : 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false; btn.textContent = 'Delete Selected';
  }
  async function retryDoc(id) { try { await api.post('/documents/'+id+'/reindex'); toast('Retrying...','info'); await loadDocuments(); } catch(err){toast(err.message,'error');} }

  async function reprocessAll() {
    if (!confirm('Re-embed all documents with the current embedding model? This may take a while and uses API credits.')) return;
    const btn = $('reprocess-all-btn');
    btn.disabled = true; btn.textContent = 'Re-embedding...';
    try { const r = await api.post('/documents/reprocess-all'); toast(r.message, 'success'); await loadDocuments(); }
    catch(err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Re-embed All'; }
  }

  async function addUrl() {
    const input = $('url-input');
    const url = input.value.trim();
    if (!url) { toast('Enter a URL', 'error'); return; }
    const btn = $('add-url-btn');
    btn.disabled = true; btn.textContent = 'Fetching...';
    try {
      const doc = await api.post('/documents/import-url', { url });
      state.uploadedThisSession.add(doc.id);
      toast('URL added — processing content', 'success');
      input.value = '';
      await loadDocuments();
    } catch(err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Add URL'; }
  }

  // ── Text Notes ──
  let editingNoteId = null;

  function openNoteEditor() {
    $('note-editor').classList.remove('hidden');
    $('note-title-input').value = '';
    $('note-content-input').value = '';
    $('note-title-input').focus();
  }
  function closeNoteEditor() {
    $('note-editor').classList.add('hidden');
    $('note-title-input').value = '';
    $('note-content-input').value = '';
  }
  async function saveNote() {
    const title = $('note-title-input').value.trim();
    const content = $('note-content-input').value.trim();
    if (!content) { toast('Write something in the note', 'error'); return; }
    const btn = $('note-save-btn');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await api.post('/documents/notes', { title, content });
      toast('Note saved — processing', 'success');
      closeNoteEditor();
      await loadDocuments();
    } catch(err) { toast(err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Save Note'; }
  }

  async function editNote(id) {
    if (editingNoteId === id) return; // already editing
    editingNoteId = id;
    renderDocs(); // re-render to show the edit area
    // Fetch content
    try {
      const note = await api.get('/documents/notes/' + id);
      const ta = document.querySelector('.note-edit-area textarea[data-did="'+id+'"]');
      if (ta) ta.value = note.content;
    } catch(err) { toast(err.message, 'error'); editingNoteId = null; renderDocs(); }
  }

  function cancelEditNote() {
    editingNoteId = null;
    renderDocs();
  }

  async function saveEditNote(id) {
    const ta = document.querySelector('.note-edit-area textarea[data-did="'+id+'"]');
    if (!ta) return;
    const content = ta.value.trim();
    if (!content) { toast('Note cannot be empty', 'error'); return; }
    const saveBtn = document.querySelector('.note-edit-actions [data-action="save-edit-note"][data-did="'+id+'"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
    try {
      await api.put('/documents/notes/' + id, { content });
      toast('Note updated — re-processing', 'success');
      editingNoteId = null;
      await loadDocuments();
    } catch(err) { toast(err.message, 'error'); if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; } }
  }

  // Accumulated files for upload (supports multiple drag-drops and file picker additions)
  let pendingFiles = [];

  async function uploadDoc(e) {
    e.preventDefault();
    if(!pendingFiles.length){toast('Select files','error');return;}
    const progressArea = $('upload-progress');
    const progressFill = $('upload-progress-fill');
    const progressText = $('upload-progress-text');
    progressArea.classList.remove('hidden');
    const files = pendingFiles.slice();
    let success = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pct = Math.round(((i) / files.length) * 100);
      progressFill.style.width = pct + '%';
      progressText.textContent = 'Uploading ' + (i+1) + ' of ' + files.length + ': ' + file.name;
      const fd=new FormData(); fd.append('file', file);
      try {
        const res=await fetch('/api/documents/upload',{method:'POST',credentials:'include',body:fd});
        const data=await res.json();
        if(!res.ok) throw new Error(data.error?.message||'Upload failed');
        state.uploadedThisSession.add(data.id);
        success++;
      } catch(err){toast(file.name+': '+err.message,'error');}
    }
    progressFill.style.width = '100%';
    progressText.textContent = 'Done!';
    setTimeout(() => { progressArea.classList.add('hidden'); progressFill.style.width = '0%'; }, 1500);
    if (success > 0) {
      toast(success+' file'+(success>1?'s':'')+' uploaded','success');
      pendingFiles = [];
      closeModal(); $('file-input').value=''; $('upload-file-info').classList.add('hidden'); $('upload-submit').disabled=true;
      await loadDocuments();
    }
  }

  // ── Admin ──
  async function loadAdminData() {
    try {
      const stats=await api.get('/admin/stats'); $('admin-stats').innerHTML=[{v:stats.users,l:'Users'},{v:stats.documents,l:'Docs'},{v:fmtBytes(stats.totalStorage),l:'Storage'},{v:stats.conversations,l:'Chats'},{v:stats.messages,l:'Messages'},{v:stats.chunks,l:'Chunks'}].map(s=>'<div class="stat-card"><div class="stat-value">'+s.v+'</div><div class="stat-label">'+s.l+'</div></div>').join('');
      await loadChatChart();
      await loadSuggestedPromptsAdmin();
      const config=await api.get('/admin/config'); fillConfig(config);
      const pd=await api.get('/admin/config/prompt'); $('cfg-system-prompt').value=pd.prompt;
      await loadUsers();
    } catch(err){toast(err.message,'error');}
  }

  async function loadChatChart() {
    const days = $('chart-range')?.value || '30';
    try {
      const rows = await api.get('/admin/chat-logs/stats?days=' + days);
      const el = $('chat-chart');
      if (!rows.length) { el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-faint);font-size:0.72rem;">No chat activity in this period.</div>'; return; }
      const max = Math.max(...rows.map(r => r.count));
      el.innerHTML = rows.map(r => {
        const pct = Math.round((r.count / max) * 100);
        return `<div class="chart-bar-row"><span class="chart-bar-label">${esc(r.username || 'unknown')}</span><div class="chart-bar-track"><div class="chart-bar-fill" style="width:${pct}%"></div></div><span class="chart-bar-value">${r.count}</span></div>`;
      }).join('');
    } catch(err) { console.error(err); }
  }

  // Suggested Prompts
  let suggestedPrompts = [];
  async function loadSuggestedPromptsAdmin() {
    try {
      suggestedPrompts = await api.get('/admin/config/suggested-prompts');
      renderSuggestedPromptsAdmin();
    } catch(e) {}
  }
  function renderSuggestedPromptsAdmin() {
    const el = $('suggested-prompts-list');
    if (!el) return;
    el.innerHTML = suggestedPrompts.map((p, i) => `<div class="suggested-prompt-item" draggable="true" data-idx="${i}"><span class="drag-handle">⠿</span><input type="text" class="suggested-prompt-input" value="${esc(p)}" data-idx="${i}"><button data-action="remove-prompt" data-idx="${i}">Remove</button></div>`).join('') || '<div style="color:var(--text-faint);font-size:0.7rem;">No prompts yet.</div>';
    // Hide add row if at max
    const addRow = $('suggested-prompt-add-row');
    if (addRow) addRow.style.display = suggestedPrompts.length >= 10 ? 'none' : 'flex';
    // Attach drag events
    el.querySelectorAll('.suggested-prompt-item').forEach(item => {
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragover', onDragOver);
      item.addEventListener('drop', onDrop);
      item.addEventListener('dragend', onDragEnd);
    });
    // Attach edit events
    el.querySelectorAll('.suggested-prompt-input').forEach(input => {
      input.addEventListener('change', function() {
        const idx = parseInt(this.dataset.idx);
        suggestedPrompts[idx] = this.value.trim();
        saveSuggestedPrompts();
      });
    });
  }

  let dragIdx = null;
  function onDragStart(e) { dragIdx = parseInt(e.currentTarget.dataset.idx); e.currentTarget.style.opacity = '0.4'; }
  function onDragOver(e) { e.preventDefault(); e.currentTarget.style.borderTop = '2px solid var(--accent)'; }
  function onDrop(e) { e.preventDefault(); e.currentTarget.style.borderTop = ''; const dropIdx = parseInt(e.currentTarget.dataset.idx); if (dragIdx !== null && dragIdx !== dropIdx) { const item = suggestedPrompts.splice(dragIdx, 1)[0]; suggestedPrompts.splice(dropIdx, 0, item); saveSuggestedPrompts(); renderSuggestedPromptsAdmin(); } }
  function onDragEnd(e) { e.currentTarget.style.opacity = '1'; document.querySelectorAll('.suggested-prompt-item').forEach(el => el.style.borderTop = ''); }
  async function addSuggestedPrompt() {
    const input = $('new-prompt-input');
    const text = input.value.trim();
    if (!text) return;
    if (suggestedPrompts.length >= 10) { toast('Maximum 10 prompts', 'error'); return; }
    suggestedPrompts.push(text);
    await saveSuggestedPrompts();
    input.value = '';
  }
  async function removeSuggestedPrompt(idx) {
    suggestedPrompts.splice(idx, 1);
    await saveSuggestedPrompts();
  }
  async function saveSuggestedPrompts() {
    try { await api.put('/admin/config/suggested-prompts', { prompts: suggestedPrompts }); renderSuggestedPromptsAdmin(); }
    catch(err) { toast(err.message, 'error'); }
  }
  async function loadSuggestedPromptsChat() {
    try {
      const prompts = await api.get('/settings/suggested-prompts');
      renderWelcomeScreen(prompts);
    } catch(e) {
      renderWelcomeScreen([]);
    }
  }
  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }
  function renderWelcomeScreen(prompts) {
    const el = $('chat-messages');
    if (state.messages.length) return;
    const name = (state.user?.name || state.user?.username || '').split(' ')[0];
    const greeting = getGreeting() + (name ? ', ' + esc(name) + '!' : '!');
    let html = '<div class="chat-welcome-container">';
    html += '<div class="chat-welcome">';
    html += '<div class="chat-welcome-greeting">' + greeting + '</div>';
    html += '<div class="chat-welcome-subtitle">How can I help you today?</div>';
    html += '</div>';
    if (prompts && prompts.length) {
      html += '<div class="chat-prompt-cards">' + prompts.map(p => `<div class="chat-prompt-card" data-action="send-prompt" data-prompt="${esc(p)}">${esc(p)}</div>`).join('') + '</div>';
    }
    html += '</div>';
    el.innerHTML = html;
  }
  function renderPromptCards(prompts) {
    renderWelcomeScreen(prompts);
  }

  async function loadUsers() {
    const users=await api.get('/admin/users');
    $('users-list').innerHTML=users.map(u=>{
      const self=u.id===state.user.id;
      let roleBtn = '';
      if (!self) {
        if (state.user.role === 'techadmin') {
          // Tech admin can cycle through all roles
          const nextRole = u.role==='user'?'admin':u.role==='admin'?'techadmin':'user';
          const label = u.role==='user'?'Make Admin':u.role==='admin'?'Make Tech Admin':'Make User';
          roleBtn = '<button class="user-role-btn" data-action="toggle-role" data-uid="'+u.id+'" data-role="'+nextRole+'">'+label+'</button>';
        } else {
          // Regular admin can only toggle user/admin (not techadmin)
          if (u.role !== 'techadmin') {
            const nextRole = u.role==='user'?'admin':'user';
            const label = u.role==='user'?'Make Admin':'Make User';
            roleBtn = '<button class="user-role-btn" data-action="toggle-role" data-uid="'+u.id+'" data-role="'+nextRole+'">'+label+'</button>';
          }
        }
      }
      const deleteBtn = self?'<span style="font-size:0.62rem;color:var(--text-faint)">you</span>':(u.role==='techadmin'&&state.user.role!=='techadmin'?'':'<button class="user-delete" data-action="delete-user" data-uid="'+u.id+'">Remove</button>');
      return '<div class="user-row"><span class="user-email">'+esc(u.username)+' <span style="color:var(--text-faint)">('+esc(u.name||'')+')</span></span><span class="user-role '+u.role+'">'+u.role+'</span>'+roleBtn+deleteBtn+'</div>';
    }).join('');
  }
  function fillConfig(c) { $('cfg-llm-provider').value=c.llm_provider||'openai'; $('cfg-openai-key').value=c.openai_api_key||''; $('cfg-openai-model').value=c.openai_model||'gpt-4o-mini'; $('cfg-gemini-key').value=c.gemini_api_key||''; $('cfg-gemini-model').value=c.gemini_model||'gemini-1.5-flash'; $('cfg-claude-key').value=c.claude_api_key||''; $('cfg-claude-model').value=c.claude_model||'claude-3-haiku-20240307'; $('cfg-openrouter-key').value=c.openrouter_api_key||''; $('cfg-openrouter-model').value=c.openrouter_model||'openai/gpt-4o-mini'; $('cfg-local-url').value=c.local_llm_url||'http://localhost:11434'; $('cfg-local-model').value=c.local_model||'llama3'; $('cfg-embedding-model').value=c.embedding_model||'text-embedding-3-small'; $('cfg-temperature').value=c.temperature||'0.1'; $('cfg-temp-value').textContent=c.temperature||'0.1'; $('cfg-max-chunks').value=c.max_retrieved_chunks||'5'; $('cfg-threshold').value=c.similarity_threshold||'0.7'; $('cfg-threshold-value').textContent=c.similarity_threshold||'0.7'; $('cfg-streaming').checked=c.streaming_enabled!=='0'; toggleProvider(c.llm_provider||'openai'); }
  function toggleProvider(p) { document.querySelectorAll('.provider-fields').forEach(el=>el.classList.add('hidden')); const t=$('cfg-'+p+'-fields'); if(t) t.classList.remove('hidden'); }
  async function saveConfig() { const btn=$('save-config-btn'); if(btn){btn.disabled=true;btn.textContent='Saving...';} const cfg={llm_provider:$('cfg-llm-provider').value,openai_api_key:$('cfg-openai-key').value,openai_model:$('cfg-openai-model').value,gemini_api_key:$('cfg-gemini-key').value,gemini_model:$('cfg-gemini-model').value,claude_api_key:$('cfg-claude-key').value,claude_model:$('cfg-claude-model').value,openrouter_api_key:$('cfg-openrouter-key').value,openrouter_model:$('cfg-openrouter-model').value,local_llm_url:$('cfg-local-url').value,local_model:$('cfg-local-model').value,embedding_model:$('cfg-embedding-model').value,temperature:$('cfg-temperature').value,max_retrieved_chunks:$('cfg-max-chunks').value,similarity_threshold:$('cfg-threshold').value,streaming_enabled:$('cfg-streaming').checked?'1':'0'}; for(const k of Object.keys(cfg)){if(cfg[k]?.startsWith('•'))delete cfg[k];} try{await api.patch('/admin/config',cfg);toast('Configuration saved','success');}catch(err){toast(err.message,'error');} finally{if(btn){btn.disabled=false;btn.textContent='Save Configuration';}} }
  async function savePrompt() { const btn=$('save-prompt-btn'); if(btn){btn.disabled=true;btn.textContent='Saving...';} try{await api.put('/admin/config/prompt',{prompt:$('cfg-system-prompt').value});toast('Prompt saved','success');}catch(err){toast(err.message,'error');} finally{if(btn){btn.disabled=false;btn.textContent='Save Prompt';}} }

  // CHAT LOGS
  async function loadChatLogs(search) {
    try {
      const s = search || $('chat-logs-search')?.value || '';
      const convos = await api.get('/admin/chat-logs/conversations' + (s ? '?search='+encodeURIComponent(s) : ''));
      const container = $('chat-logs-list');
      if (!convos.length) { container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-faint);font-size:0.76rem;">No chat logs yet.</div>'; return; }
      container.innerHTML = convos.map(c => `
        <div class="chat-log-item" data-action="expand-log" data-logcid="${c.conversation_id}">
          <div class="chat-log-meta">
            <span class="log-user">${esc(c.username||'unknown')}</span>
            <span class="log-title">${esc(c.conversation_title)}</span>
            <span>${c.message_count} messages</span>
            <span>${fmtDate(c.started_at)}</span>
          </div>
        </div>
      `).join('');
    } catch(err) { toast(err.message, 'error'); }
  }

  async function expandChatLog(conversationId, el) {
    // Toggle expand
    const existing = el.querySelector('.chat-log-expanded');
    if (existing) { existing.remove(); return; }
    try {
      const msgs = await api.get('/admin/chat-logs/conversations/' + conversationId);
      const expanded = document.createElement('div');
      expanded.className = 'chat-log-expanded';
      expanded.innerHTML = msgs.map(m => `<div class="chat-log-msg"><span class="log-role">${m.role}:</span><span class="log-content">${esc(m.content).substring(0,300)}${m.content.length>300?'...':''}</span></div>`).join('');
      el.appendChild(expanded);
    } catch(err) { toast(err.message,'error'); }
  }

  async function clearChatLogs() {
    if (!confirm('Clear ALL chat logs permanently? This cannot be undone.')) return;
    const btn = $('clear-logs-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Clearing...'; }
    try { await api.del('/admin/chat-logs'); toast('Logs cleared','success'); loadChatLogs(); }
    catch(err) { toast(err.message,'error'); }
    finally { if (btn) { btn.disabled = false; btn.textContent = 'Clear All Logs'; } }
  }
  async function createUser() { const username=$('new-user-username').value.trim(),name=$('new-user-name').value.trim(),password=$('new-user-password').value.trim(),role=$('new-user-role').value; if(!username||!name||!password){toast('All fields required','error');return;} try{await api.post('/admin/users',{username,name,password,role});toast('Created','success');$('new-user-username').value='';$('new-user-name').value='';$('new-user-password').value='';await loadUsers();}catch(err){toast(err.message,'error');} }

  function openModal() { pendingFiles = []; $('upload-file-info').classList.add('hidden'); $('upload-submit').disabled=true; $('file-input').value=''; $('upload-modal').classList.remove('hidden'); }
  function closeModal() { $('upload-modal').classList.add('hidden'); $('pw-modal').classList.add('hidden'); }
  function openDrawer() { $('mobile-drawer').classList.add('open'); renderMobileChats(); $('mobile-username').textContent = state.user?.username || ''; }
  function closeDrawer() { $('mobile-drawer').classList.remove('open'); }
  function renderMobileChats() {
    const el = $('mobile-chat-list');
    if (!el) return;
    const all = state.conversations;
    el.innerHTML = all.map(c => {
      const pin = c.pinned ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;opacity:0.5"><path d="M16 2L14.5 3.5l1 1-4.5 4.5H7l-2 2 4.5 2.5L5 18l1 1 4.5-4.5L13 19l2-2v-4l4.5-4.5 1 1L22 8z"/></svg>' : '';
      return '<div class="chat-item'+(state.currentConversation?.id===c.id?' active':'')+'" data-mcid="'+c.id+'">'+pin+'<span class="chat-item-title">'+esc(c.title)+'</span></div>';
    }).join('') || '<div style="padding:12px;color:var(--text-faint);font-size:0.7rem;text-align:center;">No conversations</div>';
  }

  // ── Event Delegation (solves the onclick not working problem) ──
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) {
      // Check for chat item click
      const chatItem = e.target.closest('[data-cid]');
      if (chatItem) { selectChat(chatItem.dataset.cid); return; }
      const mobileChatItem = e.target.closest('[data-mcid]');
      if (mobileChatItem) { selectChat(mobileChatItem.dataset.mcid); closeDrawer(); return; }
      return;
    }
    const action = btn.dataset.action;
    if (action === 'delete-doc') deleteDoc(btn.dataset.did);
    else if (action === 'retry') retryDoc(btn.dataset.did);
    else if (action === 'edit-note') editNote(btn.dataset.did);
    else if (action === 'cancel-edit-note') cancelEditNote();
    else if (action === 'save-edit-note') saveEditNote(btn.dataset.did);
    else if (action === 'copy') copyMsg(btn.dataset.mid);
    else if (action === 'regen') regen();
    else if (action === 'expand-log') expandChatLog(btn.dataset.logcid, btn);
    else if (action === 'remove-prompt') { removeSuggestedPrompt(parseInt(btn.dataset.idx)); }
    else if (action === 'send-prompt') { $('chat-input').value = btn.dataset.prompt; $('chat-input').focus(); }
    else if (action === 'toggle-role') { api.patch('/admin/users/'+btn.dataset.uid+'/role',{role:btn.dataset.role}).then(()=>{toast('Changed','success');loadUsers();}).catch(err=>toast(err.message,'error')); }
    else if (action === 'delete-user') { api.del('/admin/users/'+btn.dataset.uid).then(()=>{toast('Removed','success');loadUsers();}).catch(err=>toast(err.message,'error')); }
  });

  // Toggle handlers (checkbox change events)
  document.addEventListener('change', function(e) {
    if (e.target.dataset.action === 'select-doc') {
      const did = e.target.dataset.did;
      if (e.target.checked) { selectedDocs.add(did); } else { selectedDocs.delete(did); }
      updateBatchBar();
    }
    if (e.target.dataset.action === 'toggle-doc') {
      const did = e.target.dataset.did;
      api.patch('/documents/'+did+'/toggle').then(r => {
        const d = state.documents.find(x => x.id === did);
        if (d) d.enabled = r.enabled ? 1 : 0;
        renderDocs();
        toast(r.enabled ? 'Source enabled' : 'Source disabled', 'success');
      }).catch(err => toast(err.message, 'error'));
    }
  });

  // ── Init ──
  document.addEventListener('DOMContentLoaded', function() {
    $('login-form').addEventListener('submit', handleLogin);
    $('setup-form').addEventListener('submit', handleSetup);
    $('logout-btn').addEventListener('click', async()=>{try{await api.post('/auth/logout');}catch{}showAuth();checkSetup();});
    $('change-pw-btn').addEventListener('click', ()=>{ $('pw-modal').classList.remove('hidden'); });
    $('pw-form').addEventListener('submit', async(e)=>{
      e.preventDefault();
      const cur=$('pw-current').value, nw=$('pw-new').value, conf=$('pw-confirm').value;
      if(nw!==conf){toast('Passwords do not match','error');return;}
      try{await api.post('/auth/change-password',{currentPassword:cur,newPassword:nw});toast('Password changed','success');closeModal();$('pw-form').reset();}catch(err){toast(err.message,'error');}
    });
    document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
    $('new-chat-btn').addEventListener('click', newChat);
    $('clear-chats-btn').addEventListener('click', clearAllChats);
    // Mobile drawer
    $('mobile-menu-btn')?.addEventListener('click', openDrawer);
    $('mobile-drawer-close')?.addEventListener('click', closeDrawer);
    document.querySelector('.mobile-drawer-overlay')?.addEventListener('click', closeDrawer);
    $('mobile-new-chat')?.addEventListener('click', ()=>{ newChat(); closeDrawer(); });
    $('mobile-clear-chats')?.addEventListener('click', clearAllChats);
    $('mobile-logout')?.addEventListener('click', async()=>{try{await api.post('/auth/logout');}catch{}showAuth();checkSetup();closeDrawer();});
    $('mobile-change-pw')?.addEventListener('click', ()=>{ $('pw-modal').classList.remove('hidden'); closeDrawer(); });
    document.querySelectorAll('.mobile-nav-btn').forEach(b=>b.addEventListener('click',()=>{ switchView(b.dataset.mview); closeDrawer(); document.querySelectorAll('.mobile-nav-btn').forEach(x=>x.classList.remove('active')); b.classList.add('active'); }));
    $('chat-form').addEventListener('submit', sendMsg);
    $('chat-input').addEventListener('keydown', e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
    $('chat-input').addEventListener('input', function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px';});
    $('stop-btn').addEventListener('click', stopGen);
    $('mic-btn')?.addEventListener('click', toggleRecording);
    initSpeechRecognition();
    $('pin-chat-btn').addEventListener('click', pinChat);
    $('delete-chat-btn').addEventListener('click', deleteChat);
    $('chat-search').addEventListener('input', async function(){const s=this.value.trim();try{state.conversations=await api.get('/chat/conversations'+(s?'?search='+encodeURIComponent(s):''));renderConvos();}catch{}});
    $('upload-btn')?.addEventListener('click', openModal);
    $('reprocess-all-btn')?.addEventListener('click', reprocessAll);
    $('batch-select-all')?.addEventListener('click', function() {
      state.documents.forEach(d => selectedDocs.add(d.id));
      renderDocs();
    });
    $('batch-deselect')?.addEventListener('click', function() {
      selectedDocs.clear();
      renderDocs();
    });
    $('batch-delete-btn')?.addEventListener('click', batchDelete);
    $('add-url-btn')?.addEventListener('click', addUrl);
    $('url-input')?.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
    $('add-note-btn')?.addEventListener('click', openNoteEditor);
    $('note-cancel-btn')?.addEventListener('click', closeNoteEditor);
    $('note-save-btn')?.addEventListener('click', saveNote);
    $('upload-form')?.addEventListener('submit', uploadDoc);
    $('doc-search')?.addEventListener('input', function(){renderDocs(this.value.toLowerCase());});
    const dz=$('dropzone'),fi=$('file-input');
    if(dz&&fi){dz.addEventListener('click',()=>fi.click());dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('dragover');if(e.dataTransfer.files.length){pendingFiles=pendingFiles.concat(Array.from(e.dataTransfer.files));showFile(pendingFiles);}});fi.addEventListener('change',()=>{if(fi.files.length){pendingFiles=pendingFiles.concat(Array.from(fi.files));showFile(pendingFiles);}});}
    $('save-config-btn')?.addEventListener('click', saveConfig);
    $('save-prompt-btn')?.addEventListener('click', savePrompt);
    $('create-user-btn')?.addEventListener('click', createUser);
    $('add-prompt-btn')?.addEventListener('click', addSuggestedPrompt);
    $('new-prompt-input')?.addEventListener('keydown', function(e){ if(e.key==='Enter'){e.preventDefault();addSuggestedPrompt();} });
    $('clear-logs-btn')?.addEventListener('click', clearChatLogs);
    $('chat-logs-search')?.addEventListener('input', function(){ loadChatLogs(this.value); });
    $('cfg-llm-provider')?.addEventListener('change', e=>toggleProvider(e.target.value));
    $('chart-range')?.addEventListener('change', loadChatChart);
    $('cfg-temperature')?.addEventListener('input', e=>{$('cfg-temp-value').textContent=e.target.value;});
    $('cfg-threshold')?.addEventListener('input', e=>{$('cfg-threshold-value').textContent=e.target.value;});
    document.querySelectorAll('.modal-close,.modal-overlay').forEach(el=>el.addEventListener('click',closeModal));

    // Keyboard shortcuts — Ctrl+Shift on Windows, Cmd+Shift on Mac (matches ChatGPT conventions)
    document.addEventListener('keydown', function(e) {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat(); }
      if (mod && e.shiftKey && e.key === 'Backspace') { e.preventDefault(); clearAllChats(); }
      if (e.key === 'Escape') { closeModal(); closeDrawer(); }
    });

    // Show shortcut hints based on platform
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const newChatBtn = $('new-chat-btn');
    if (newChatBtn) newChatBtn.title = 'New Chat (' + (isMac ? '⌘⇧O' : 'Ctrl+Shift+O') + ')';
    const clearChatsBtn = $('clear-chats-btn');
    if (clearChatsBtn) clearChatsBtn.title = 'Clear All (' + (isMac ? '⌘⇧⌫' : 'Ctrl+Shift+Backspace') + ')';
    const hintEl = $('shortcut-hint-text');
    if (hintEl) hintEl.textContent = (isMac ? '⌘⇧O' : 'Ctrl+Shift+O') + ' new chat · Esc close';

    // Theme toggle (desktop + mobile)
    const saved = localStorage.getItem('docuchat-theme') || 'auto';
    document.querySelectorAll('#theme-toggle, #mobile-theme-toggle').forEach(toggle => {
      toggle.querySelector('[data-theme="'+saved+'"]')?.classList.add('active');
      toggle.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-theme]');
        if (!btn) return;
        const choice = btn.dataset.theme;
        localStorage.setItem('docuchat-theme', choice);
        applyTheme(choice);
        // Sync both toggles
        document.querySelectorAll('#theme-toggle .theme-option, #mobile-theme-toggle .theme-option').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('[data-theme="'+choice+'"]').forEach(b => b.classList.add('active'));
      });
    });

    // Text size controls
    $('text-size-down')?.addEventListener('click', () => applyTextSize(textSizeLevel - 1));
    $('text-size-up')?.addEventListener('click', () => applyTextSize(textSizeLevel + 1));
    $('mobile-text-size-down')?.addEventListener('click', () => applyTextSize(textSizeLevel - 1));
    $('mobile-text-size-up')?.addEventListener('click', () => applyTextSize(textSizeLevel + 1));

    // Boot
    api.get('/auth/profile').then(p=>{state.user=p;initApp();}).catch(()=>{showAuth();checkSetup();});
  });

  function showFile(files){
    const info=$('upload-file-info');
    info.classList.remove('hidden');
    if (files.length === 1) { info.textContent=files[0].name+' ('+fmtBytes(files[0].size)+')'; }
    else { info.textContent=files.length+' files selected ('+fmtBytes(files.reduce((s,f)=>s+f.size,0))+' total)'; }
    $('upload-submit').disabled=false;
  }
})();
