'use strict';

// ===== BYT ENDAST DESSA TVÅ RADER =====
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co 
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z
// =====================================

const BUCKET = 'audio';

// ——— små hjälpare ———
const $ = sel => document.querySelector(sel);
const fmt = s => String(s).padStart(2,'0');

// ——— state ———
let mediaRecorder = null;
let chunks = [];
let startedAt = 0;
let timerInt = null;
let waveInt = null;
let uploads = []; // runtime-lista
const out = $('#out');

// ——— init supabase ———
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sb = sb; // för konsol-test

// ——— sanity UI ———
document.getElementById('u').textContent = SUPABASE_URL;
document.getElementById('k').textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

// ——— basic waveform (bara för liv) ———
function startWave(){
  const el = $('#wave'); el.innerHTML = '';
  waveInt = setInterval(()=>{
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = (Math.floor(Math.random()*34)+6)+'px';
    bar.style.background = '#0ea5e9';
    bar.style.margin = '0 2px';
    bar.style.width = '4px';
    bar.style.display = 'inline-block';
    if(el.children.length>160) el.removeChild(el.firstChild);
    el.appendChild(bar);
  }, 60);
}
function stopWave(){ clearInterval(waveInt); waveInt=null; $('#wave').innerHTML=''; }

// ——— timer ———
function setTimer(sec){ $('#timer').textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}`; }

// ——— render lista ———
function renderList(){
  const wrap = $('#list'); wrap.innerHTML='';
  uploads.slice().reverse().forEach(row=>{
    const div = document.createElement('div'); div.className='item';
    const left = document.createElement('div'); left.textContent = row.title;
    const right = document.createElement('div'); right.className='right';
    const a = document.createElement('a'); a.href=row.publicUrl; a.target='_blank'; a.rel='noopener'; a.textContent='Öppna URL';
    const copy = document.createElement('button'); copy.textContent='Kopiera URL';
    copy.onclick=()=>{ navigator.clipboard.writeText(row.publicUrl); copy.textContent='Kopierad!'; setTimeout(()=>copy.textContent='Kopiera URL',1200); };
    const del = document.createElement('button'); del.textContent='Ta bort (bucket)';
    del.onclick = async ()=>{
      try{
        await sb.storage.from(BUCKET).remove([row.path]);
        uploads = uploads.filter(u=>u.path!==row.path);
        renderList();
      }catch(e){ console.error(e); alert('Kunde inte ta bort: '+e.message); }
    };
    right.append(a, copy, del);
    div.append(left, right);
    wrap.appendChild(div);
  });
}

// ——— record ———
async function startRec(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    chunks = [];
    mediaRecorder.ondataavailable = e => { if(e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => { $('#saveBtn').disabled = false; };
    mediaRecorder.start(200); // chunk var 200ms
    startedAt = Date.now();
    timerInt = setInterval(()=> setTimer(Math.floor((Date.now()-startedAt)/1000)), 1000);
    startWave();
    $('#recBtn').textContent = '⏹ Stoppa';
  }catch(err){
    console.error(err);
    alert('Mikrofonfel: '+err.message);
  }
}

function stopRec(){
  if(mediaRecorder && mediaRecorder.state !== 'inactive'){
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t=>t.stop());
  }
  clearInterval(timerInt); timerInt=null;
  stopWave();
  $('#recBtn').textContent = '▶️ Starta inspelning';
}

$('#recBtn').addEventListener('click', ()=>{
  if(!mediaRecorder || mediaRecorder.state==='inactive'){ startRec(); }
  else { stopRec(); }
});

// ——— upload ———
$('#saveBtn').addEventListener('click', async ()=>{
  try{
    if(!chunks.length) return alert('Ingen inspelning ännu.');
    const blob = new Blob(chunks, { type:'audio/webm' });
    $('#saveBtn').disabled = true;

    const rawTitle = ($('#title').value || 'untitled').trim().replace(/[^\p{L}\p{N}\-_ ]/gu,'').replace(/\s+/g,'-').toLowerCase();
    const date = new Date();
    const y = date.getFullYear(), m = fmt(date.getMonth()+1), d = fmt(date.getDate()), hh = fmt(date.getHours()), mm = fmt(date.getMinutes()), ss = fmt(date.getSeconds());
    const name = `${y}${m}${d}-${hh}${mm}${ss}-${rawTitle}.webm`;

    const path = `${y}/${m}/${name}`;

    // ladda upp
    const { data, error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType:'audio/webm', upsert:false });
    if(error){ throw error; }

    // hämta public URL
    const { data:pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    uploads.push({ title:name, path, publicUrl });
    renderList();

    // reset UI
    $('#title').value = '';
    chunks = [];
    setTimer(0);
    alert('Uppladdad!');
  }catch(e){
    console.error(e);
    alert('Uppladdningsfel: '+ e.message);
  }finally{
    $('#saveBtn').disabled = false;
  }
});

// ——— sanity-knapp ———
$('#ping').addEventListener('click', async ()=>{
  try{
    out.textContent = 'Pingar…';
    const res = await sb.storage.from(BUCKET).list('', { limit: 1 });
    out.textContent = JSON.stringify(res, null, 2);
  }catch(e){
    out.textContent = 'Error: '+ e.message;
  }
});

// ——— initial ———
renderList();
setTimer(0);
