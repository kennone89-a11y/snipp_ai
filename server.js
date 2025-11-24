// server.js – Kenai backend (ren, stabil version)

import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

dotenv.config();

// --- OpenAI-klient ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Grundsetup / paths ---
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CORS utan paket ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// --- Body-parsing ---
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// --- Statiska filer (frontend) ---
app.use(express.static(path.join(__dirname, "public")));

// ----------------- Hjälpfunktioner -----------------

/**
 * Ladda ner en fil från URL till temporär fil.
 * Returnerar den lokala sökvägen.
 */
async function downloadToTempFile(fileUrl, extension = ".webm") {
  const tempDir = path.join(__dirname, "tmp");
  await fs.promises.mkdir(tempDir, { recursive: true });

  const tempPath = path.join(
    tempDir,
    `audio-${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`
  );

  const response = await fetch(fileUrl);
  if (!response.ok || !response.body) {
    throw new Error(
      `Kunde inte hämta fil från URL (status ${response.status})`
    );
  }

  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(tempPath);
    response.body.pipe(fileStream);
    response.body.on("error", reject);
    fileStream.on("finish", resolve);
  });

  return tempPath;
}

/**
 * Gemensam logik för ljud → Whisper → GPT-sammanfattning
 */
async function handleSummarizeRequest(req, res) {
  try {
    const { url } = req.body || {};

    if (!url) {
      console.error("[Kenai] summarize – ingen URL i body");
      return res.status(400).json({ error: "Ingen ljud-URL mottagen." });
    }

    console.log("[Kenai] summarize – startar med URL:", url);

    // 1) Ladda ner filen till temp
    const tempPath = await downloadToTempFile(url, ".webm");
    console.log("[Kenai] Fil nedladdad till:", tempPath);

    // 2) Transkribera med Whisper
    const transcription = await client.audio.transcriptions.create({
      model: "whisper-1",
      file: fs.createReadStream(tempPath),
      response_format: "verbose_json",
      temperature: 0,
    });

    const transcriptText = transcription.text || "";
    console.log(
      "[Kenai] Transkript klart, längd:",
      transcriptText.length,
      "tecken"
    );

    // 3) Sammanfatta med GPT
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Du är en svensk assistent som sammanfattar ljudinspelningar. " +
            "Skriv först en kort sammanfattning (2–4 meningar), " +
            "sedan 3–7 punktlistor med de viktigaste sakerna, " +
            "och avsluta med 'Nästa steg:' om det passar.",
        },
        {
          role: "user",
          content: transcriptText || "Transkriptet är tomt.",
        },
      ],
    });

    const summary =
      completion.choices?.[0]?.message?.content ||
      "Kunde inte generera sammanfattning.";

    return res.json({
      ok: true,
      transcript: transcriptText,
      summary,
    });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res
      .status(500)
      .json({ error: "Serverfel vid AI-sammanfattning." });
  }
}

// ----------------- Routes -----------------

// Enkel healthcheck
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- AI-sammanfattning (alla tre pekar på samma logik) ---
app.post("/api/summarize", handleSummarizeRequest);
app.post("/api/summarize2", handleSummarizeRequest);
app.post("/api/summarize3", handleSummarizeRequest);

// --- PDF-export av sammanfattning ---
app.post("/api/export-pdf", (req, res) => {
  try {
    const { text } = req.body || {};
    const safeText = text || "Ingen sammanfattning mottagen.";

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kenai-sammanfattning.pdf"'
    );

    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(18).text("Kenai – sammanfattning", { underline: true });
    doc.moveDown();
    doc.fontSize(12).text(safeText);

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res.status(500).json({ error: "Kunde inte skapa PDF." });
  }
});

// --- Mock-mail (loggar bara, skickar inget på riktigt) ---
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { email, text } = req.body || {};
    console.log("[Kenai] mock-email →", email, "med text-längd:", (text || "")
      .length);

    // Här skulle riktig mail-integration ligga (SendGrid, etc)
    return res.json({ ok: true, sent: false, mock: true });
  } catch (err) {
    console.error("[Kenai] EMAIL ERROR:", err);
    res.status(500).json({ error: "Mail-funktionen misslyckades (mock)." });
  }
});

// --- Reels preset-demo: tar emot plan och skickar tillbaka den ---
app.post("/api/reels-plan-demo", async (req, res) => {
  try {
    const body = req.body || {};
    console.log("[Kenai Reels] /api/reels-plan-demo request:", body);

    // Vi gör bara en enkel "eko" + lite metadata
    const items = Array.isArray(body.items) ? body.items : [];
    const totalDuration = items.reduce(
      (sum, item) => sum + (Number(item.duration) || 0),
      0
    );

    const plan = {
      style: body.style || "basic",
      targetDuration: Number(body.targetDuration) || totalDuration || 10,
      items,
      totalDuration,
      createdAt: new Date().toISOString(),
    };

    return res.json({ ok: true, plan });
  } catch (err) {
    console.error("[Kenai Reels] PLAN DEMO ERROR:", err);
    res.status(500).json({ error: "Kunde inte skapa demo-plan." });
  }
});

// --- Reels build-reel: läser plan.json från Supabase och summerar ---
app.post("/api/build-reel", async (req, res) => {
  try {
    const { planUrl, plan } = req.body || {};
    let reelPlan = plan;

    if (!reelPlan && planUrl) {
      console.log("[Kenai Reels] Hämtar plan från URL:", planUrl);
      const response = await fetch(planUrl);
      if (!response.ok) {
        throw new Error("Kunde inte hämta plan.json från URL.");
      }
      reelPlan = await response.json();
    }

    if (!reelPlan) {
      return res
        .status(400)
        .json({ error: "Ingen plan eller planUrl mottagen." });
    }

    const segments = Array.isArray(reelPlan.segments)
      ? reelPlan.segments
      : Array.isArray(reelPlan.items)
      ? reelPlan.items
      : [];

    const clipCount = segments.length;
    const totalDuration = segments.reduce(
      (sum, seg) => sum + (Number(seg.duration) || 0),
      0
    );

    const result = {
      ok: true,
      clipCount,
      totalDuration,
      plan: reelPlan,
    };

    return res.json(result);
  } catch (err) {
    console.error("[Kenai Reels] BUILD REEL ERROR:", err);
    res.status(500).json({ error: "Kunde inte bygga reel-plan." });
  }
});

// --- Trender & hashtags – enkel mock ---
app.post("/api/trends-backend", async (req, res) => {
  try {
    const niche = (req.body?.niche || "").trim() || "din nisch";

    const mockTrends = [
      {
        title: "Snabb hook på 3 sekunder",
        idea: `Börja med en stark fråga inom ${niche} direkt första sekunden.`,
        hashtags: "#kenai #reels #hook #viral",
      },
      {
        title: "Före / efter",
        idea: `Visa ett kort "före" och direkt efter ett "efter" resultat inom ${niche}.`,
        hashtags: "#beforeafter #transformation #reels",
      },
      {
        title: "1 grej du gör fel",
        idea: `Berätta om ett vanligt misstag folk gör inom ${niche} och hur man löser det.`,
        hashtags: "#tips #mistakes #learn",
      },
    ];

    return res.json({ trends: mockTrends });
  } catch (err) {
    console.error("[Kenai] TRENDS ERROR:", err);
    res.status(500).json({ error: "Kunde inte generera trender." });
  }
});

// Fångar alla andra routes och serverar index.html (om behövs)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ----------------- Starta servern -----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kenai backend kör på port ${PORT}`);
});
