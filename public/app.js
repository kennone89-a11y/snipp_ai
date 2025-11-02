'use strict';

/* ====== BYT ENDAST DESSA TVÅ ====== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co;  // utan slash på slutet
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z';                   // börjar med sbp_ eller sb_publishable_
/* ================================== */

window.addEventListener('DOMContentLoaded', () => {
  // 0) Sanity: CDN måste finnas
  if (!window.supabase) {
    console.error('Supabase CDN not loaded');
    const out = document.getElementById('out');
    if (out) out.textContent = 'ERROR: Supabase CDN not loaded';
    return;
  }

  // 1) Skapa klient och exponera globalt
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  window.sb = sb;
  console.log('sb ready?', typeof sb); // ska vara "object"

  // 2) Visa URL & key‐prefix i UI om fälten finns
  const u = document.getElementById('u');
  const k = document.getElementById('k');
  if (u) u.textContent = SUPABASE_URL;
  if (k) k.textContent = SUPABASE_ANON?.slice(0, 2) || '';

  // 3) Koppla "Lista 1 fil…"‐knappen
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
