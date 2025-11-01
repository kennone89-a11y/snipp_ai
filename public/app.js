// ===== BYT ENDAST DESSA TVÅ RADER =====
const SUPABASE_URL  = 'https://<DIN-PROJEKT-DOMÄN>.supabase.co';   // ex: https://hwywzzzgaghkhooezk.supabase.co
const SUPABASE_ANON = 'sbp_ELLER_sb_publishable_xxxxxxxxxxxxxxx';  // Publishable key (börjar med sbp_ eller sb_publishable_)
// ======================================

const BUCKET = 'audio';

// Visa i UI
document.getElementById('u').textContent = SUPABASE_URL;
document.getElementById('k').textContent = SUPABASE_ANON.startsWith('sb') ? 'ok' : 'fel';

// Initiera Supabase
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
window.sb = sb; // Console-test

// ===== Helpers/UI =====
let mediaRecorder, chunks = [], startedAt = 0, timerInt = null, waveInt = null;
const uploads = [];
const $ = sel => document.querySelector(sel);
const fmt = s => String(s).padStart(2,'0');
const setTimer = sec => { $('#timer').textContent = `${fmt(Math.floor(sec/60))}:${fmt(sec%60)}` };

function startWave(){
  const el = $('#wave'); el.innerHTML = '';
  waveInt = setInterval(()=>{
    const b = document.createElement('div');
    b.className = 'bar';
    b.style.height = (Math.floor(Math.random()*34)+6)+'px';
    el.appendChild(b);
    if (el.children.length > 160) el.removeChild(el.firstChild);
  }, 60);
}
function stopWave(){ clearInterval(waveInt); waveInt=null; $('#wave').innerHTML=''; }

function renderList(items){
  const wrap = $('#list'); wrap.innerHTML='';
  if (!items.length){ wrap.innerHTML = `<div class="muted">Inga uppladdningar ännu.</div>`; return; }
  items.slice().reverse().forEach(c=>{
    const row=document.createElement('div'); row.className='item';
    const left=document.createElement('div'); const right=document.createElement('div'); right.className='right';
    const title=document.createElement('div');
    title.innerHTML=`<strong>${c.title||'Utan titel'}</strong><div class="muted">${new Date(c.created).toLocaleString()} • ${Math.round((c.duration||0))}s • ${Math.round((c.size||0)/1024)} KB</div>`;
    const audio=document.createElement('audio'); audio.controls=true; audio.src=c.publicUrl||c.objectUrl;
    left.appendChild(title); left.appendChild(audio);
    if (c.publicUrl){ const a=document.createElement('a'); a.href=c.publicUrl; a.target='_blank'; a.rel='noopener';
      const btn=document.createElement('button'); btn.textContent='Öppna URL'; a.appendChild(btn); right.appendChild(a); }
    row.appendChild(left); row.appendChild(right); wrap.appendChild(row);
  });
}

// ===== Recording =====
$('#recBtn').onclick = async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording'){
    mediaRecorder.stop();
    $('#recBtn').textContent = '● Starta inspelning';
    $('#saveBtn').disabled = false;
    clearInterval(timerInt); timerInt=null; stopWave();
    return;
  }
  try{
    chunks = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.start();
    startedAt = Date.now();
    $('#recBtn').textContent = '■ Stoppa';
    $('#saveBtn').disabled = true;
    setTimer(0);
    timerInt = setInterval(()=>setTimer(Math.floor((Date.now()-startedAt)/1000)),1000);
    startWave();
  }catch(err){ alert('Mikrofonfel: ' + err.message); }
};

// ===== Upload =====
async function uploadToSupabase(path, blob){
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert:true, contentType:'audio/webm' });
  if (error) throw error;
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

$('#saveBtn').onclick = async () => {
  if (!chunks.length){ alert('Inget inspelat.'); return; }
  const blob = new Blob(chunks, { type:'audio/webm' });
  const sec = Math.floor((Date.now()-startedAt)/1000)||0;
  const title = $('#title').value.trim() || 'Utan titel';
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const folder = new Date().toISOString().slice(0,10);
  const path = `${folder}/${id}.webm`;
  try{
    const publicUrl = await uploadToSupabase(path, blob);
    const objectUrl = URL.createObjectURL(blob);
    uploads.push({ id, title, created: Date.now(), duration: sec, size: blob.size, publicUrl, objectUrl });
    renderList(uploads);
    $('#title').value=''; $('#saveBtn').disabled=true;
    alert('Uppladdat ✅');
  }catch(e){ console.error(e); alert('Uppladdning misslyckades: ' + e.message); }
};

// ===== Sanity-knapp =====
document.getElementById('ping').onclick = async () => {
  const out = document.getElementById('out');
  try { const res = await sb.storage.from(BUCKET).list({ limit:1 }); out.textContent = JSON.stringify(res, null, 2); }
  catch (e) { out.textContent = 'Error: ' + e.message; }
};

// init
renderList(uploads);
