// server.js – Kenai backend (stabil version)
 
// ===============================
// Imports & setup
// ===============================
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

dotenv.config();

// 🔑 Skapa OpenAI-klienten (saknades – gav "client is not defined")
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enkel CORS-middleware utan paket
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());
app.use(express.static("public"));


// ===============================
// 1. ROOT (index.html om du vill)
// ===============================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===============================
// 2. /api/summarize – ljud → text → sammanfattning
// ===============================
app.post("/api/summarize", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "Ingen ljud-URL mottagen." });
    }

    console.log("[Kenai] Hämtar ljud från:", url);

    // Hämta ljudfilen från Supabase (eller annan publik URL)
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      throw new Error("Kunde inte hämta ljudfil från Supabase");
    }
    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log("[Kenai] Fil hämtad, skickar till OpenAI...");

    // 1) Transkribera med Whisper
    const transcript = await client.audio.transcriptions.create({
      file: buffer,
      model: "gpt-4o-transcribe",
      response_format: "text",
    });

    console.log("[Kenai] Transkribering klar.");

    // 2) Sammanfatta texten på svenska
    const chat = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Du är en assistent som sammanfattar ljud på svenska. Skriv kortfattat, tydligt och enkelt.",
        },
        {
          role: "user",
          content: transcript,
        },
      ],
    });

    const summary = chat.choices[0].message.content;

    console.log("[Kenai] Sammanfattning genererad.");

    return res.json({
      transcript,
      summary,
    });
  } catch (err) {
    console.error("SUMMARY ERROR:", err);
    return res.status(500).json({ error: err.message || "Okänt fel" });
  }
});

// ===============================
// 3. /api/export-pdf – text → PDF
// ===============================
app.post("/api/export-pdf", async (req, res) => {
  try {
    const { text } = req.body;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=summary.pdf");

    const doc = new PDFDocument();
    doc.pipe(res);
    doc.fontSize(14).text(text || "");
    doc.end();
  } catch (err) {
    console.error("PDF ERROR:", err);
    res.status(500).json({ error: "Kunde inte generera PDF" });
  }
});

// 4. /api/trends-backend – enkel mock
app.post("/api/trends-backend", async (req, res) => {
  try {
    const { niche } = req.body || {};

    const mockTrends = [
      {
        title: "Snabb hook på 3 sekunder",
        idea: `Börja med en stark fråga inom ${niche || "din nisch"} direkt första sekunden.`,
        hashtags: "#kenai #reels #hook #viral"
      },
      {
        title: "Före / efter",
        idea: `Visa ett kort "före" och direkt efter ett "efter" resultat inom ${niche || "din nisch"}.`,
        hashtags: "#beforeafter #transformation #reels"
      },
      {
        title: "1 grej du gör fel",
        idea: `Berätta om ett vanligt misstag folk gör inom ${niche || "din nisch"} och hur man löser det.`,
        hashtags: "#tips #mistakes #learn"
      }
    ];

    // Skicka tillbaka i samma format som frontend förväntar sig
    return res.json({ trends: mockTrends });
  } catch (err) {
    console.error("TRENDS ERROR:", err);
    return res.status(500).json({ error: "Kunde inte generera trender" });
  }
});

// 5. /api/reels-plan-demo – tar emot plan från preset-demo (ingen riktig render ännu)
app.post("/api/reels-plan-demo", async (req, res) => {
  try {
    const { plan } = req.body || {};

    if (!plan) {
      return res.status(400).json({ error: "Ingen plan mottagen" });
    }

    console.log("[Reels-demo] Fick plan:", JSON.stringify(plan, null, 2));

    return res.json({
      ok: true,
      message: "Plan mottagen i backend",
      receivedStyle: plan.style || null,
      totalDuration: plan.totalDuration || null
    });
  } catch (err) {
    console.error("REELS PLAN DEMO ERROR:", err);
    return res.status(500).json({ error: "Kunde inte ta emot plan" });
  }
});

// 6. /api/build-reel – fake-bygg reel utifrån plan (ingen riktig video än)
app.post("/api/build-reel", async (req, res) => {
  try {
    const { plan } = req.body || {};

    if (!plan) {
      return res.status(400).json({ error: "Ingen plan mottagen" });
    }

    const style = plan.style || "okänd";
    const totalDuration = plan.totalDuration || 0;

    // Försök räkna antal klipp från första segmentet
    let clipCount = 0;
    if (Array.isArray(plan.segments) && plan.segments.length > 0) {
      const firstSegment = plan.segments[0];
      if (Array.isArray(firstSegment.clips)) {
        clipCount = firstSegment.clips.length;
      }
    }

    const buildId = `fake_${Date.now()}`;

    console.log(
      `[Reels-build-demo] style=${style}, total=${totalDuration}s, clips=${clipCount}, buildId=${buildId}`
    );

    return res.json({
      ok: true,
      message: "Fake-reel byggd (ingen riktig video än)",
      buildId,
      style,
      totalDuration,
      clipCount,
      downloadUrl: null,
      note: "Här kan vi senare returnera en riktig videolänk."
    });
  } catch (err) {
    console.error("BUILD REEL ERROR:", err);
    return res.status(500).json({ error: "Kunde inte bygga reel (fake)" });
  }
});

// ---------------------- Starta servern ----------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[Kenai] Backend kör på port ${PORT}`);
});
