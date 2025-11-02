'use strict';

/* ====== BYT ENDAST DESSA TVÅ VÄRDEN ====== */
const SUPABASE_URL  = 'https://hywwzzzxgagqhlxooekz.supabase.co   // utan slash på slutet
const SUPABASE_ANON = 'sb_publishable_fLQC4d675JKhsc-QXj2oGw_BGIfI87Z;             // Publishable key
/* ========================================= */

window.addEventListener('DOMContentLoaded', () => {
  try {
    if (!window.supabase) {
      console.error('Supabase CDN not loaded');
      return;
    }

    // Skapa klienten och exponera globalt för sanity-test i konsolen
    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    window.sb = sb;
    console.log('sb ready?', typeof window.sb); // ska bli "object"

    // === (DIN BEFINTLIGA KOD HÄR UNDER) ===
    // behåll allt du redan har: querySelector, knapplyssnare, recorder, upload, m.m.
  } catch (e) {
    console.error('Init error:', e);
  }
});
