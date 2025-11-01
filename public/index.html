<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Röstrecensioner (MVP)</title>
  <meta name="description" content="Spela in röst, ladda upp till Supabase och spara recensioner. MVP." />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background:#0b0d12; color:#e6eef8; }
    .card { background: rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:16px; }
    .tagchip { border:1px solid rgba(255,255,255,0.15); border-radius:8px; padding:4px 8px; }
    .muted { color:#9aa8bf; }
    .danger { color:#ff6b6b; }
  </style>
</head>
<body class="min-h-screen">
  <main class="max-w-5xl mx-auto p-6 space-y-6">
    <header>
      <h1 class="text-3xl font-extrabold">Röstrecensioner</h1>
      <p class="muted mt-1">Spela in din röst, ladda upp, få en publik länk.</p>
    </header>

    <!-- Recorder -->
    <section class="grid md:grid-cols-3 gap-4">
      <div class="card md:col-span-2">
        <div class="flex items-center gap-2">
          <button id="btnStart" class="tagchip">Spela in</button>
          <button id="btnStop" class="tagchip" disabled>Stoppa</button>
          <button id="btnUpload" class="tagchip" disabled>Ladda upp</button>
          <span id="status" class="text-sm muted ml-auto"></span>
        </div>

        <div class="mt-3">
          <audio id="player" controls class="w-full"></audio>
        </div>

        <p id="result" class="muted text-sm mt-3"></p>
      </div>

      <aside class="card">
        <h3 class="font-semibold mb-2">Tips</h3>
        <ul class="list-disc list-inside muted space-y-1">
          <li>Håll mikrofonen nära.</li>
          <li>Stäng av notiser under inspelning.</li>
          <li>Max 5 minuter rekommenderas.</li>
        </ul>
      </aside>
    </section>

    <!-- Historik -->
    <section class="card">
      <div class="flex items-center justify-between">
        <strong>Senaste uppladdningar</strong>
        <button id="refreshBtn" class="tagchip">Uppdatera</button>
      </div>
      <ul id="history" class="mt-2 text-sm muted"></ul>
    </section>
  </main>

  <!-- Supabase v2 -->
  <script src="https://unpkg.com/@supabase/supabase-js@2"></script>

  <!-- SUPABASE INIT -->
  <script>
    // 🔁 BYT UT DESSA TVÅ RADER TILL DINA EGNA VÄRDEN
    const SUPABASE_URL = "https://hywwzzzxgagqhlxooekz.supabase.co".trim().replace(/\s/g,"");
    const SUPABASE_ANON_KEY = `
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTcwMzI0NjM4NiwiZXhwIjoxOTg5MDEyMzg2LCJzdWIiOiJhbm9uIiwicm9sZSI6ImFub24ifQ.XQxiOjE3NjE5Mjk5S2NTcsImV4cCI6MjA...
`.trim().replace(/\s/g,""); // ← KLIStra IN HELA DIN ANON KEY MELLAN backticks (``)

    try {
      window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log("sb ready?", !!window.sb);
    } catch (e) {
      console.error("Supabase init failed:", e);
      window.sb = null;
    }
  </script>

  <!-- App-koden -->
  <script src="app.js?v=11"></script>
</body>
</html>
