// server.js (ESM) – Kenai backend: summarize + pdf + reels + trends
import dotenv from "dotenv";
dotenv.config({ override: true });

import express from "express";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import OpenAI from "openai";



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


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
// Servera alla statiska filer i /public (html, bilder, js)
app.use(express.static(path.join(__dirname, "public")));



// --- Kenai Timestamps: AI + fallback via fetch ---
app.post('/api/timestamps', async (req, res) => {
  const { url } = req.body;

  // 1) Basvalidering
  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'Ingen URL skickades in till /api/timestamps.',
    });
  }

  console.log('Kenai Timestamps: tog emot URL:', url);

  // 2) Fejkdata som fallback om OpenAI strular
  const fallback = {
    title: 'Exempel-titel från Kenai Timestamps (fejk)',
    summary:
      'Detta är en fejk-sammanfattning från Kenai Timestamps-prototypen. ' +
      'Allt fungerar tekniskt – om AI:n inte kan svara använder vi denna fallback.',
    hashtags: ['#kenai', '#timestamps', '#ai', '#podd', '#youtube'],
    chapters: [
      { time: '00:00', label: 'Intro' },
      { time: '03:15', label: 'Viktig punkt / Hook' },
      { time: '10:42', label: 'Huvudämne / Story' },
      { time: '18:30', label: 'Avslutning & CTA' },
    ],
  };

  try {
    // 3) Hämta API-nyckel
    const key = requireOpenAIKey();

    // 4) Anropa OpenAI Chat Completions via fetch
    const body = {
      model: 'gpt-4o-mini',
      temperature: 0.6,
      messages: [
        {
          role: 'system',
          content:
            'Du är Kenai Timestamps, ett verktyg som hjälper creators att få ' +
            'titel, sammanfattning, hashtags och kapitel till YouTube-videor och poddar. ' +
            'Du får OFTA bara en URL och kan ibland inte se själva innehållet. ' +
            'Gör då en smart, rimlig gissning baserat på titel/slug/kontext. ' +
            'Svara ALLTID med STRIKT JSON (ingen text runtom, ingen markdown, inga kommentarer) ' +
            'i EXAKT detta schema: ' +
            '{ "title": "...", "summary": "...", "hashtags": ["#..."], "chapters": [ { "time": "mm:ss", "label": "..." }, ... ] }. ' +
            'Tiderna ska alltid börja vid "00:00" och ökas i rimliga steg (t.ex. 00:00, 02:30, 05:00, 08:30 osv). ' +
            'Sammanfattningen ska vara 3–6 meningar på svenska. Hashtags ska vara 5–10 st, relevanta och populära.'
        },
        {
          role: 'user',
          content:
            `Video/podd-URL: ${url}\n\n` +
            'Utgå från vad titeln och URL:en antyder. Om du inte vet exakt innehåll, ' +
            'skapa en rimlig generell kapitelstruktur som skulle passa en sådan video/podd.'
        },
      ],
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error('Kenai Timestamps: OpenAI-svar inte OK:', r.status, data);
      return res.json(fallback);
    }

    const raw = (data.choices?.[0]?.message?.content || '').trim();
    console.log('Kenai Timestamps: rå OpenAI-svar:', raw);

    // 5) Försök parsa JSON från modellen
    let parsed;
    try {
      const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Kenai Timestamps: kunde inte parsa JSON, använder fallback.', parseErr);
      return res.json(fallback);
    }

    // 6) Minimal sanity-check på resultatet
    if (
      !parsed ||
      typeof parsed.title !== 'string' ||
      typeof parsed.summary !== 'string' ||
      !Array.isArray(parsed.hashtags) ||
      !Array.isArray(parsed.chapters)
    ) {
      console.error('Kenai Timestamps: ogiltig struktur i AI-svar, använder fallback.');
      return res.json(fallback);
    }

    console.log('Kenai Timestamps: AI-svar OK, skickar vidare till frontend.');
    return res.json(parsed);
  } catch (err) {
    console.error('Fel i /api/timestamps (yttersta catch):', err);
    // Viktigt: vi skickar inte 500 här, utan vår fallback så UI alltid funkar
    return res.json(fallback);
  }
});
app.post("/api/reels/hooks", async (req, res) => {
  try {
    const { idea } = req.body || {};
    if (!idea || typeof idea !== "string") {
      return res.status(400).json({ error: "Missing idea" });
    }

    const userPrompt = `
Du är en svensk expert på TikTok/Instagram Reels.

Användarens reel-idé:
"${idea}"

1) Skriv 3–5 korta, klickbara hooks på svenska (en mening var).
2) Skriv 8–15 relevanta hashtags (utan förklaringar).

Svar MÅSTE vara JSON på formen:
{
  "hooks": ["...", "..."],
  "hashtags": ["#tag1", "#tag2"]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "Du hjälper creators att skriva hooks och hashtags på svenska." },
        { role: "user", content: userPrompt },
      ],
    });

    let hooks = [];
    let hashtags = [];

    try {
      const raw = completion.choices[0].message.content.trim();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.hooks)) hooks = parsed.hooks;
      if (Array.isArray(parsed.hashtags)) hashtags = parsed.hashtags;
    } catch (e) {
      console.error("JSON-parse error for /api/reels/hooks", e);
    }

    if (!hooks.length && !hashtags.length) {
      return res.status(500).json({ error: "AI gav inget användbart svar" });
    }

    res.json({ hooks, hashtags });
  } catch (err) {
    console.error("Error in /api/reels/hooks:", err);
    res.status(500).json({ error: "Server error" });
  }
});
// --- Reels: render demo-endpoint (ingen riktig video ännu) ---
app.post("/api/reels/render-demo", async (req, res) => {
  try {
    const { style, clips, targetSeconds } = req.body || {};

    console.log("Reels render-demo hit:", {
      style,
      clipCount: Array.isArray(clips) ? clips.length : 0,
      targetSeconds,
    });

    if (!Array.isArray(clips) || clips.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Inga klipp skickades till render-demo.",
      });
    }

    if (!targetSeconds || targetSeconds <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Ogiltig mållängd.",
      });
    }

    // Här kommer vi i nästa steg koppla in riktig FFmpeg-rendering.
    // Just nu låtsas vi bara att allting gick bra.
    return res.json({
      ok: true,
      message:
        "Render-demo mottagen. FFmpeg-rendering kopplas på i nästa steg.",
      debug: {
        style: style || "Basic",
        clips: clips.map((c) => ({
          name: c.name || "okänt namn",
          plannedSeconds: c.duration || null,
        })),
        targetSeconds,
      },
    });
  } catch (err) {
    console.error("Fel i /api/reels/render-demo:", err);
    return res.status(500).json({
      ok: false,
      error: "Serverfel i render-demo.",
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Kenai backend kör på port", PORT);
});
