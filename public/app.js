'use strict';

/** ===== FYLL DINA TVÅ VÄRDEN HÄR ===== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co;   // <- BYT (utan slash)
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z;       // <- BYT (publishable)
/** ==================================== */

const BUCKET = 'audio';              // bucketnamn
const FOLDER = 'clips';              // undermapp i bucketen

// små hjälpare
const $ = sel => document.querySelector(sel);
const fmt = s => String(s).padStart(2,'0');

async function startRec() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // <-- PASTA HÄR
}// välj bästa mimeType och skapa MediaRecorder
let mime = 'audio/webm;codecs=opus';
if (!MediaRecorder.isTypeSupported(mime)) {
  mime = 'audio/webm';
}
mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
console.log('Recorder mime:', mime);




// init supabase (via CDN: global "supabase" finns)
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sb = sb; // för konsoltest

// sanity UI
document.getElementById('u').textContent = SUPABASE_URL;
document.getElementById('k').textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

// waveform
function startWave(){
  const el = $('#wave'); el.innerHTML = '';
  waveInt = setInterval(()=>{
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = (Math.floor(Math.random()*34)+40) + 'px';
    el.appendChild(bar);
    if (el.children.length>160) el.removeChild(el.firstChild);
  }, 60);
}
function stopWave(){ clearInterval(waveInt); $('#wave').innerHTML=''; waveInt=null; }

// timer
function startTimer(){
  startedAt = Date.now();
  timerInt = setInterval(()=>{
    const sec = Math.floor((Date.now()-startedAt)/1000);
    $('#timer').textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`;
  }, 250);
}
function stopTimer(){ clearInterval(timerInt); timerInt=null; $('#timer').textContent='00:00'; }

// inspelning
$('#recBtn').onclick = async ()=>{
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType:'audio/webm' });

    mediaRecorder.ondataavailable = (e)=>{ if (e.data.size>0) chunks.push(e.data); };
    mediaRecorder.onstop = ()=>{
      stream.getTracks().forEach(t=>t.stop());
      stopTimer(); stopWave();
      $('#saveBtn').disabled = false;
      $('#recBtn').textContent = '▶ Starta inspelning';
    };

    mediaRecorder.start(250);
    $('#saveBtn').disabled = true;
    $('#recBtn').textContent = '■ Stoppa';
    startTimer(); startWave();
  }catch(err){
    alert('Kunde inte starta mikrofon: ' + err.message);
  }
};

document.addEventListener('click', (e)=>{
  if (e.target.id === 'recBtn' && mediaRecorder && mediaRecorder.state==='recording'){
    mediaRecorder.stop();
  }
});

// spara till supabase storage
$('#saveBtn').onclick = async ()=>{
  if (!chunks.length) return alert('Inget inspelat ännu.');
  $('#saveBtn').disabled = true;

  const title = ($('#title').value || 'untitled').trim().replace(/[^\w\- ]+/g,'').replace(/\s+/g,'_');
  const stamp = Date.now();
  const fileName = `${stamp}_${title || 'clip'}.webm`;

  const blob = new Blob(chunks, { type:'audio/webm' });
  const player = document.getElementById('player');
if (player) {
  try {
    const localUrl = URL.createObjectURL(blob);
    player.src = localUrl;
    player.play().catch(() => {}); // autoplay kan blockas – då trycker man Play
  } catch (e) {
    console.error('Preview error:', e);
  }
}

  const path = `${FOLDER}/${fileName}`;

  // 1) ladda upp
  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, blob, {
    contentType: 'audio/webm',
    upsert: false
  });
  if (upErr){ alert('Upload fail: ' + upErr.message); $('#saveBtn').disabled=false; return; }

  // 2) hämta public URL
  const pub = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

  // 3) rendera posten högst upp
  prependItem({ name:fileName, path, url:pub });

  // 4) nollställ
  chunks = [];
  $('#title').value = '';
  $('#saveBtn').disabled = true;

  // 5) uppdatera hela listan i bakgrunden (om du vill):
  refreshList();
};

// lista filer (på load + knappen “Lista 1 fil …”)
async function refreshList(limit = 30){
  const listEl = $('#list');
  const { data, error } = await sb.storage.from(BUCKET).list(FOLDER, {
    limit, offset:0, search:''
  });
  if (error){ listEl.innerHTML = `<div class="muted">Kunde inte lista: ${error.message}</div>`; return; }

  // nyaste först (filnamn börjar med tidsstämpel)
  const files = [...data].sort((a,b)=> b.name.localeCompare(a.name));

  listEl.innerHTML = '';
  files.forEach(f=>{
    const p = `${FOLDER}/${f.name}`;
    const url = sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
    appendItem({ name:f.name, path:p, url });
  });
}

function appendItem({name, path, url}){
  const row = document.createElement('div');
  row.className = 'item';
  row.innerHTML = `
    <div class="left">
      <div class="name">${name.replace(/^\d+_/, '')}</div>
      <a href="${url}" target="_blank" rel="noopener">Öppna URL</a>
    </div>
    <div class="right" style="display:flex; gap:8px; align-items:center">
      <audio controls src="${url}"></audio>
      <button class="danger" data-path="${path}">Ta bort</button>
    </div>`;
  $('#list').appendChild(row);
}
function prependItem(x){ appendItem(x); const list=$('#list'); list.insertBefore(list.lastChild, list.firstChild); }

// delegating: delete
$('#list').addEventListener('click', async (e)=>{
  const btn = e.target.closest('button.danger');
  if (!btn) return;
  const p = btn.dataset.path;
  if (!confirm(`Radera filen?\n${p}`)) return;
  const { error } = await sb.storage.from(BUCKET).remove([p]);
  if (error) return alert('Delete fail: ' + error.message);
  await refreshList();
});

// sanity ping
$('#ping').onclick = async ()=>{
  const out = $('#out'); out.textContent = '';
  try{
    out.textContent += 'Testar list() från "'+BUCKET+'"...\n';
    const { data, error } = await sb.storage.from(BUCKET).list(FOLDER, { limit:1 });
    if (error) throw error;
    out.textContent += JSON.stringify(data, null, 2) + '\n\n';

    // skapa och publicera en test-text (bekräftar INSERT + public URL)
    const name = `sanity_${Date.now()}.txt`;
    out.textContent += `Skapar ${FOLDER}/${name} ...\n`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(`${FOLDER}/${name}`, new Blob([`Hej ${Date.now()}`], {type:'text/plain'}));
    if (upErr) throw upErr;

    const pub = sb.storage.from(BUCKET).getPublicUrl(`${FOLDER}/${name}`).data.publicUrl;
    out.textContent += `Public URL:\n${pub}\n`;
  }catch(err){
    out.textContent += `ERROR: ${err.message}`;
  }
};

// init
document.addEventListener('DOMContentLoaded', ()=>{
  refreshList();
});
