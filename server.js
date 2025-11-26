// server.js (ESM) — Kenai backend: summarize + pdf + reels + trends
import express from "express";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);

// ---- CORS (ingen cors-dependency) ----
const ALLOWED_ORIGINS = new Set([
  "https://app.kenai.technology",
  "https://kenai.technology",
  "http://localhost:3000",
  "http://localhost:5173",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve /public
app.use(express.static(path.join(__dirname, "public")));
// Kenai Timestamps – stabil fejk-prototyp (ingen AI än)
app.post("/api/timestamps", (req, res) => {
  const { url } = req.body;

  console.log("Received URL for timestamps (FEJK):", url);

  const exampleResponse = {
    url,
    chapters: [
      { time: "00:00", title: "Intro & hook" },
      { time: "01:23", title: "Bakgrund & story" },
      { time: "04:50", title: "Huvudpoängen i videon" },
      { time: "09:10", title: "Sammanfattning & call-to-action" }
    ],
    summary:
      "Detta är en stabil fejk-sammanfattning för prototypen. I den riktiga Kenai Timestamps kommer AI:n att analysera videons innehåll och generera kapitel, beskrivning och hashtags automatiskt."
  };

  return res.json(exampleResponse);
});


  } catch (err) {
    console.error("Oväntat fel i /api/timestamps:", err);

    // absolut sista nödfallback – men fortfarande 200 OK
    return res.json({
      url,
      chapters: [
        { time: "00:00", title: "Intro (nödfallback)" },
        { time: "01:00", title: "Mitten (nödfallback)" },
        { time: "02:00", title: "Avslut (nödfallback)" }
      ],
      summary:
        "Ett oväntat fel uppstod i servern. Detta är ett nödfallback-svar så att användaren inte får 500-fel."
    });
  }
});


    const raw = completion.choices[0].message.content;
    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("Kunde inte parsa JSON från AI:", raw);
      return res.status(500).json({ error: "Kunde inte tolka AI-svaret." });
    }

    if (!parsed.chapters || !parsed.summary) {
      return res.status(500).json({ error: "AI-svaret saknar chapters eller summary." });
    }

    return res.json({
      url,
      chapters: parsed.chapters,
      summary: parsed.summary
    });
  } catch (err) {
    console.error("Fel från OpenAI i /api/timestamps:", err);
    return res.status(500).json({ error: "AI-fel. Försök igen senare." });
  }
});



// ---- Health ----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

// ---- Helpers ----
function requireOpenAIKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const err = new Error("OPENAI_API_KEY saknas på servern.");
    err.status = 500;
    throw err;
  }
  return key;
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extFromContentType(ct) {
  const s = (ct || "").toLowerCase();
  if (s.includes("webm")) return "webm";
  if (s.includes("wav")) return "wav";
  if (s.includes("mpeg")) return "mp3";
  if (s.includes("mp3")) return "mp3";
  if (s.includes("mp4") || s.includes("m4a")) return "m4a";
  if (s.includes("ogg")) return "ogg";
  return "bin";
}

async function fetchAudioAsBuffer(url, maxBytes = 35 * 1024 * 1024) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);

  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      const e = new Error(`Kunde inte hämta ljud: ${r.status} ${txt.slice(0, 200)}`);
      e.status = 400;
      throw e;
    }

    const contentType = r.headers.get("content-type") || "application/octet-stream";
    const len = Number(r.headers.get("content-length") || "0");
    if (len && len > maxBytes) {
      const e = new Error(`Ljudfilen är för stor (${len} bytes).`);
      e.status = 413;
      throw e;
    }

    const ab = await r.arrayBuffer();
    if (ab.byteLength > maxBytes) {
      const e = new Error(`Ljudfilen är för stor (${ab.byteLength} bytes).`);
      e.status = 413;
      throw e;
    }

    return { buffer: Buffer.from(ab), contentType };
  } finally {
    clearTimeout(t);
  }
}

function extractResponsesText(data) {
  // Nya Responses kan ge output_text, annars fallbacks
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;

  // djupare fallback
  const out = data?.output;
  if (Array.isArray(out)) {
    const texts = [];
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (typeof c?.text === "string") texts.push(c.text);
        }
      }
    }
    if (texts.length) return texts.join("\n").trim();
  }
  return "";
}

async function openaiTranscribe({ buffer, contentType }) {
  const key = requireOpenAIKey();

  // Node 18+ har FormData/File globalt
  const ext = extFromContentType(contentType);
  const filename = `audio.${ext}`;
  const file = new File([buffer], filename, { type: contentType });

  const form = new FormData();
  form.append("file", file);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");

  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.error?.message || "Transkribering misslyckades.";
    const e = new Error(msg);
    e.status = 502;
    e.details = json;
    throw e;
  }

  const text = json?.text || "";
  if (!text.trim()) {
    const e = new Error("Transkribering gav tomt resultat.");
    e.status = 502;
    throw e;
  }
  return text;
}

async function openaiSummarize(transcript) {
  const key = requireOpenAIKey();
  const model = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";

  const body = {
    model,
    input: [
      {
        role: "system",
        content:
          "Du är en svensk assistent som sammanfattar ljud. Svara på svenska.",
      },
      {
        role: "user",
        content:
          "Gör:\n1) Kort sammanfattning (3-6 meningar)\n2) Viktiga punkter (bullets)\n3) Ev. action items (bullets)\n\nTRANSKRIPT:\n" +
          transcript,
      },
    ],
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = json?.error?.message || "Sammanfattning misslyckades.";
    const e = new Error(msg);
    e.status = 502;
    e.details = json;
    throw e;
  }

  const text = extractResponsesText(json);
  if (!text.trim()) {
    const e = new Error("Sammanfattning gav tomt resultat.");
    e.status = 502;
    throw e;
  }
  return text;
}
async function openaiTimestamps(videoUrl) {
  const key = requireOpenAiKey();
  const model =
    process.env.OPENAI_TIMESTAMPS_MODEL ||
    process.env.OPENAI_SUMMARY_MODEL ||
    "gpt-4o-mini";

  const body = {
    model,
    input: [
      {
        role: "system",
        content:
          "Du är Kenai Timestamps, ett verktyg som hjälper kreatörer att strukturera YouTube-videor. " +
          "Du ska ALLTID svara som ren JSON med fälten 'chapters' (lista) och 'summary' (sträng). " +
          "Inga andra fält, ingen extra text."
      },
      {
        role: "user",
        content:
          "Utgå från denna YouTube-URL och gissa en rimlig struktur på videon.\n" +
          "Skapa 4–10 kapitel och en kort sammanfattning på svenska.\n\n" +
          "Returnera EXAKT detta JSON-format:\n" +
          "{\n" +
          '  \"chapters\": [\n' +
          '    { \"time\": \"00:00\", \"title\": \"Intro & hook\" }\n' +
          "  ],\n" +
          '  \"summary\": \"Kort sammanfattning här...\"\n' +
          "}\n\n" +
          "Skriv INGENTING annat än denna JSON.\n\n" +
          "YouTube-URL: " +
          videoUrl
      }
    ]
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const j = await r.json().catch(() => ({}));

  // Om OpenAI svarar med fel -> fallback
  if (!r.ok) {
    const msg = j.error?.message || "Timestamps-förfrågan misslyckades (OpenAI).";
    console.error("OpenAI /responses fel (timestamps):", msg, j);
    return {
      chapters: [
        { time: "00:00", title: "Intro & hook (fallback)" },
        { time: "01:23", title: "Bakgrund & story (fallback)" },
        { time: "04:50", title: "Huvudpoängen (fallback)" },
        { time: "09:10", title: "Sammanfattning & CTA (fallback)" }
      ],
      summary:
        "AI-svaret misslyckades, så detta är ett fallback-exempel. I vanliga fall genereras riktiga kapitel och sammanfattning från videons innehåll."
    };
  }

  // Använd samma helper som i openaiSummarizer
  const raw = extractResponsesText(j) || "";
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("Kunde inte parsa JSON från AI (timestamps):", raw);
    return {
      chapters: [
        { time: "00:00", title: "Intro & hook (fallback-parse)" },
        { time: "01:23", title: "Bakgrund & story (fallback-parse)" },
        { time: "04:50", title: "Huvudpoängen (fallback-parse)" },
        { time: "09:10", title: "Sammanfattning & CTA (fallback-parse)" }
      ],
      summary:
        "AI-svaret gick inte att tolka som korrekt JSON, så detta är ett fallback-exempel."
    };
  }

  if (!Array.isArray(parsed.chapters) || !parsed.summary) {
    console.error("AI-svar saknar chapters/summary (timestamps):", parsed);
    return {
      chapters: [
        { time: "00:00", title: "Intro & hook (fallback-format)" },
        { time: "01:23", title: "Bakgrund & story (fallback-format)" },
        { time: "04:50", title: "Huvudpoängen (fallback-format)" },
        { time: "09:10", title: "Sammanfattning & CTA (fallback-format)" }
      ],
      summary:
        "AI-svaret saknade chapters eller summary i rätt format, så detta är ett fallback-exempel."
    };
  }

  return parsed; // { chapters: [...], summary: "..." }
}


// ---- Summarize endpoint ----
// Tar emot { url } eller { audioUrl } från frontend
app.post("/api/summarize", async (req, res) => {
  try {
    const { url, audioUrl } = req.body || {};
    const target = url || audioUrl;

    if (!target) return res.status(400).json({ error: "Ingen ljud-URL skickad." });

    const safe = safeUrl(target);
    if (!safe) return res.status(400).json({ error: "URL måste vara https och giltig." });

    console.log("[Kenai] summarize: hämtar", safe);

    const audio = await fetchAudioAsBuffer(safe);
    const transcript = await openaiTranscribe(audio);
    const summary = await openaiSummarize(transcript);

    res.json({ transcript, summary });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err?.message || err, err?.details || "");
    res.status(err?.status || 500).json({ error: err?.message || "Serverfel vid AI-sammanfattning." });
  }
});

// ---- PDF export ----
app.post("/api/export-pdf", (req, res) => {
  try {
    const { summary = "", transcript = "" } = req.body || {};
    const doc = new PDFDocument({ margin: 40 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="kenai-sammanfattning.pdf"');

    doc.pipe(res);

    doc.fontSize(18).text("Kenai – Sammanfattning", { underline: true });
    doc.moveDown();

    doc.fontSize(12).text("SAMMANFATTNING:");
    doc.moveDown(0.5);
    doc.fontSize(11).text(summary || "(tom)", { width: 520 });
    doc.moveDown();

    doc.fontSize(12).text("TRANSKRIPT:");
    doc.moveDown(0.5);
    doc.fontSize(10).text(transcript || "(tom)", { width: 520 });

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res.status(500).json({ error: "Kunde inte skapa PDF." });
  }
});

// ---- Email (mock) ----
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { to, summary, transcript } = req.body || {};
    console.log("[Kenai] MOCK EMAIL =>", { to, summaryLen: (summary || "").length, transcriptLen: (transcript || "").length });
    res.json({ ok: true, message: "Mock: mail skickat (loggas bara i servern)." });
  } catch (err) {
    res.status(500).json({ error: "Kunde inte skicka mail." });
  }
});

// ---- Reels plan (för att slippa 404) ----
// Tar emot { plan } eller { planUrl }
app.post("/api/build-reel", async (req, res) => {
  try {
    const { plan, planUrl } = req.body || {};

    let p = plan;
    if (!p && planUrl) {
      const safe = safeUrl(planUrl);
      if (!safe) return res.status(400).json({ error: "planUrl måste vara https." });

      const r = await fetch(safe);
      if (!r.ok) return res.status(400).json({ error: "Kunde inte hämta planUrl." });
      p = await r.json();
    }

    if (!p) return res.status(400).json({ error: "Ingen plan skickad." });

    const items = Array.isArray(p.items) ? p.items : Array.isArray(p.clips) ? p.clips : [];
    const total = items.reduce((sum, it) => sum + Number(it.duration || it.seconds || 0), 0);

    res.json({
      ok: true,
      style: p.style || p.preset || "unknown",
      itemCount: items.length,
      totalDuration: total,
      plan: p,
    });
  } catch (err) {
    console.error("[Kenai] BUILD-REEL ERROR:", err);
    res.status(500).json({ error: "Serverfel i build-reel." });
  }
});

// ---- Trends (för att slippa 404) ----
app.post("/api/trends-backend", async (req, res) => {
  try {
    const { niche = "" } = req.body || {};
    const trimmed = String(niche || "").trim();

    // Fallback om ingen OpenAI-nyckel finns
    if (!process.env.OPENAI_API_KEY) {
      return res.json({
        ok: true,
        niche: trimmed,
        ideas: [
          { title: "3 snabba tips", hooks: ["Du gör detta fel...", "Spara den här", "Testa idag"], hashtags: ["#tips", "#svenskttiktok", "#fyp"] },
          { title: "Before/After", hooks: ["Före vs efter", "Skillnaden är sjuk", "Så gjorde jag"], hashtags: ["#beforeafter", "#reels", "#creator"] },
          { title: "Storytime", hooks: ["Det här hände mig...", "Jag lovar du kommer skratta", "Lärdom:"], hashtags: ["#storytime", "#svenska", "#viral"] },
        ],
      });
    }

    const key = requireOpenAIKey();
    const model = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o-mini";

    const prompt =
      `Ge 6 trend-IDEER för korta reels på svenska.\n` +
      `Nisch: "${trimmed || "valfri"}"\n` +
      `Returnera JSON array, varje objekt: {title, hook, hashtags:[...]}\n` +
      `Hashtags: 8-12 st, utan mellanslag i tags.\n`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: prompt }],
      }),
    });

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = json?.error?.message || "Trends misslyckades.";
      return res.status(502).json({ error: msg });
    }

    const text = extractResponsesText(json);
    // försök pars:a JSON array, annars skicka texten
    let ideas = null;
    try {
      ideas = JSON.parse(text);
    } catch {}
    res.json({ ok: true, niche: trimmed, ideas: ideas || text });
  } catch (err) {
    console.error("[Kenai] TRENDS ERROR:", err);
    res.status(500).json({ error: "Serverfel i trends-backend." });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Kenai backend kör på port", PORT);
});
