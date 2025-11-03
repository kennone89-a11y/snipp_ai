'use strict';

/* ====== BYT ENDAST DESSA TVÅ ====== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co;  // utan slash på slutet
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';                   // börjar med sbp_ eller sb_publishable_
/* ================================== */
// === Kenai audio patch — BLOCK 1/6 ===
// Läggs längst NEDERST i filen, under din befintliga kod.

let mediaRecorder;
let recStream;
let chunks = [];
let currentFmt = { mime: "", ext: "", contentType: "" };

// Välj bästa MIME per enhet (Safari kräver ofta audio/mp4 → .m4a)
function pickAudioFormat() {
  const prefs = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4"
  ];
  for (const m of prefs) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
      if (m.startsWith("audio/webm")) {
        return { mime: m, ext: "webm", contentType: "audio/webm" };
      }
      if (m.startsWith("audio/mp4")) {
        return { mime: m, ext: "m4a", contentType: "audio/mp4" };
      }
    }
  }
  // Om inget stöds → WAV-fallback
  return { mime: "wav-fallback", ext: "wav", contentType: "audio/wav" };
}

window.addEventListener('DOMContentLoaded', () => {
  // 0) CDN måste finnas
  if (!window.supabase) {
    const out = document.getElementById('out');
    if (out) out.textContent = 'ERROR: Supabase CDN not loaded';
    console.error('Supabase CDN not loaded');
    return;
  }

  // 1) Skapa klient och exponera globalt
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  window.sb = sb;
  console.log('sb ready?', typeof sb); // ska vara "object"

  // 2) Visa värden i UI
  const u = document.getElementById('u');
  const k = document.getElementById('k');
  if (u) u.textContent = SUPABASE_URL;
  if (k) k.textContent = SUPABASE_ANON?.slice(0, 2) || '';

  // 3) Koppla list-knapp
  const pingBtn = document.getElementById('ping');
  const out = document.getElementById('out');
  if (pingBtn && out) {
    pingBtn.addEventListener('click', async () => {
      try {
        const { data, error } = await sb.storage.from('audio').list({ limit: 1 });
        out.textContent = JSON.stringify({ data, error }, null, 2);
      } catch (e) {
        out.textContent = `Exception: ${e?.message || e}`;
      }
    });
  }
});
