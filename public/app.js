'use strict';
window.addEventListener('DOMContentLoaded', () => {
  const SUPABASE_URL  = 'https://hyywzzzzgxaghkhooezk.supabase.co';
  const SUPABASE_ANON = 'sb_publishable_fLQc4d675JKhsc-QXj20w_BGf1f8Z7';
  window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  console.log('sb ready:', typeof window.sb);
});
