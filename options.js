
/* options.js — Settings behavior, storage, and gating
   The code uses chrome.storage.sync if available, otherwise falls back to localStorage.
*/

(function(){
  const $ = (sel, ctx=document) => ctx.querySelector(sel);
  const $$ = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

  const storage = {
    async get(key){ 
      try{
        if (chrome?.storage?.sync) {
          const res = await chrome.storage.sync.get(key);
          return res[key];
        }
      }catch(e){}
      const raw = localStorage.getItem(key);
      try { return JSON.parse(raw); } catch { return raw; }
    },
    async set(key, value){
      try{
        if (chrome?.storage?.sync) {
          await chrome.storage.sync.set({[key]: value});
          return;
        }
      }catch(e){}
      localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    }
  };

  const toasts = $('#toasts');
  function toast(msg, type='ok'){
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.innerHTML = `<button class="toast__close" aria-label="Dismiss">×</button>${msg}`;
    toasts.appendChild(el);
    const close = () => el.remove();
    el.querySelector('.toast__close').onclick = close;
    setTimeout(close, 4000);
  }

  // Setup helpers
  function setBadge(el, state, okLabel='Ready', offLabel='Not saved'){
    el.classList.remove('badge--ok','badge--err');
    if (state === 'ok'){ el.classList.add('badge--ok'); el.textContent = okLabel; }
    else if (state === 'err'){ el.classList.add('badge--err'); el.textContent = offLabel; }
    else { el.textContent = offLabel; }
  }

  function updateProgress(){
    Promise.all([storage.get('ai.providerConfigured'), storage.get('profiles.count')]).then(([prov, count])=>{
      const steps = 2;
      let done = 0;
      if (prov) done++;
      if (count && Number(count) > 0) done++;
      $('#progressCount').textContent = `${done}/${steps}`;
      $('#chkProvider').checked = !!prov;
      $('#chkFirstProfile').checked = Number(count) > 0;

      // Primary CTA enabled when provider is configured
      $('#primaryImportBtn').disabled = !prov;
    });
  }

  async function initProviderUI(){
    // Load saved provider
    const provider = await storage.get('ai.provider') || 'chrome';
    const radios = $$('input[name="provider"]');
    radios.forEach(r => { r.checked = (r.value === provider); });
    // Provider states
    const chromeReady = await storage.get('ai.chrome.ready');
    setBadge($('#chromeStatus'), chromeReady ? 'ok' : 'err', 'Model verified', 'Not verified');
    setBadge($('#openaiStatus'), (await storage.get('ai.openai.key')) ? 'ok' : 'err', 'Saved', 'Not saved');
    setBadge($('#geminiStatus'), (await storage.get('ai.gemini.key')) ? 'ok' : 'err', 'Saved', 'Not saved');

    // Gate profiles
    gateProfiles(await isProviderConfigured());
  }

  async function isProviderConfigured(){
    const provider = await storage.get('ai.provider');
    if (provider === 'openai') return !!(await storage.get('ai.openai.key'));
    if (provider === 'gemini') return !!(await storage.get('ai.gemini.key'));
    // Chrome on-device is configured when verified
    if (provider === 'chrome') return !!(await storage.get('ai.chrome.ready'));
    return false;
  }

  function gateProfiles(enabled){
    const gate = $('#profilesGate');
    const enabledWrap = $('#profilesEnabled');
    if (enabled){ gate.classList.add('hidden'); enabledWrap.classList.remove('hidden'); }
    else { gate.classList.remove('hidden'); enabledWrap.classList.add('hidden'); }

    $('#primaryImportBtn').disabled = !enabled;
  }

  function bindEvents(){
    // Sidebar scroll links
    $$('[data-scroll]').forEach(btn => {
      btn.addEventListener('click', (e)=>{
        const to = e.currentTarget.getAttribute('data-scroll');
        document.querySelector(to)?.scrollIntoView({behavior:'smooth', block:'start'});
      });
    });

    // Provider selection
    $$('input[name="provider"]').forEach(r => {
      r.addEventListener('change', async (e)=>{
        const val = e.currentTarget.value;
        await storage.set('ai.provider', val);
        // Regate after change
        gateProfiles(await isProviderConfigured());
        updateProgress();
      });
    });

    // Chrome verify (simulated)
    $('#btnChromeVerify').addEventListener('click', async ()=>{
      setBadge($('#chromeStatus'), 'ok', 'Model verified');
      await storage.set('ai.chrome.ready', true);
      await storage.set('ai.provider', 'chrome');
      toast('Chrome on‑device model verified.', 'ok');
      gateProfiles(await isProviderConfigured());
      updateProgress();
      // ensure radio is set
      $('input[name="provider"][value="chrome"]').checked = true;
    });

    // OpenAI save
    $('#btnOpenAiSave').addEventListener('click', async ()=>{
      const key = $('#openaiKey').value.trim();
      const base = $('#openaiBaseUrl').value.trim();
      if (!key){ toast('Enter an OpenAI API key first.', 'err'); setBadge($('#openaiStatus'), 'err'); return; }
      await storage.set('ai.openai.key', key);
      if (base) await storage.set('ai.openai.base', base);
      await storage.set('ai.provider', 'openai');
      setBadge($('#openaiStatus'), 'ok', 'Saved');
      toast('OpenAI saved locally.', 'ok');
      $('input[name="provider"][value="openai"]').checked = true;
      gateProfiles(await isProviderConfigured());
      updateProgress();
    });

    // Gemini save
    $('#btnGeminiSave').addEventListener('click', async ()=>{
      const key = $('#geminiKey').value.trim();
      if (!key){ toast('Enter a Gemini API key first.', 'err'); setBadge($('#geminiStatus'), 'err'); return; }
      await storage.set('ai.gemini.key', key);
      await storage.set('ai.provider', 'gemini');
      setBadge($('#geminiStatus'), 'ok', 'Saved');
      toast('Gemini saved locally.', 'ok');
      $('input[name="provider"][value="gemini"]').checked = true;
      gateProfiles(await isProviderConfigured());
      updateProgress();
    });

    // Upload / parsing (simulated)
    const fileInput = $('#resumeFile');
    const parseBtn = $('#btnParse');
    const reparseBtn = $('#btnReparse');
    fileInput.addEventListener('change', ()=>{
      const f = fileInput.files?.[0];
      if (f){
        $('#parseStatus').textContent = `${f.name} selected.`;
        parseBtn.disabled = false;
      }else{
        $('#parseStatus').textContent = 'No file selected.';
        parseBtn.disabled = true;
      }
    });

    parseBtn.addEventListener('click', ()=>{
      const f = fileInput.files?.[0];
      if (!f){ toast('Choose a file first.', 'err'); return; }
      $('#parseStatus').textContent = 'Parsing…';
      parseBtn.disabled = true;
      // Simulate parsing
      setTimeout(()=>{
        $('#parseStatus').textContent = 'Parsed successfully.';
        reparseBtn.disabled = false;
        // Prefill demo fields
        $('#fullName').value = 'Jane Doe';
        $('#title').value = 'Senior Software Engineer';
        $('#email').value = 'jane@example.com';
        $('#summary').value = 'Full‑stack engineer with 8+ years of experience building browser extensions and web apps.';
        toast('Resume parsed. Review fields and save.', 'ok');
      }, 600);
    });

    reparseBtn.addEventListener('click', ()=>{
      $('#parseStatus').textContent = 'Re‑parsing…';
      setTimeout(()=>{
        $('#parseStatus').textContent = 'Parsed successfully.';
        toast('Parsing completed again.', 'ok');
      }, 400);
    });

    // Save / reset
    $('#btnSave').addEventListener('click', async ()=>{
      const data = serializeForm($('#profileForm'));
      // store count for progress
      const count = (await storage.get('profiles.count')) || 0;
      await storage.set('profiles.count', Number(count) + 1);
      toast('Profile saved.', 'ok');
      updateProgress();
    });

    $('#btnReset').addEventListener('click', ()=>{
      $('#profileForm').reset();
      toast('Changes reset.', 'ok');
    });

    // Advanced export / import
    $('#btnExport').addEventListener('click', async ()=>{
      const keys = ['ai.provider','ai.chrome.ready','ai.openai.key','ai.openai.base','ai.gemini.key','profiles.count'];
      const entries = {};
      for (const k of keys) entries[k] = await storage.get(k);
      const blob = new Blob([JSON.stringify(entries, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'fillo-settings.json'; a.click();
      setTimeout(()=> URL.revokeObjectURL(url), 500);
      toast('Settings exported.', 'ok');
    });

    $('#btnImport').addEventListener('click', ()=> $('#importFile').click());
    $('#importFile').addEventListener('change', async (e)=>{
      const f = e.target.files?.[0];
      if (!f) return;
      const text = await f.text();
      try{
        const obj = JSON.parse(text);
        for (const [k,v] of Object.entries(obj)) await storage.set(k, v);
        toast('Settings imported.', 'ok');
        initProviderUI();
        updateProgress();
      }catch(err){
        console.error(err);
        toast('Could not import settings.', 'err');
      }
    });
  }

  function serializeForm(form){
    const data = {};
    $$('input, textarea, select', form).forEach(el => {
      if (!el.id) return;
      if (el.type === 'checkbox') data[el.id] = el.checked;
      else data[el.id] = el.value;
    });
    return data;
  }

  // Init
  (async function init(){
    $('#appVersion').textContent = 'dev';
    bindEvents();
    await initProviderUI();
    updateProgress();
  })();
})();
