// server.js – Kenai backend (ny stabil version)

import dotenv from "dotenv";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";

dotenv.config();

// Skapa OpenAI-klienten (använder OPENAI_API_KEY från Render env)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();

// __dirname i ES-moduler
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enkel CORS-middleware utan paket
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// JSON-body + statiska filer
app.use(express.json());
app.use(express.static("public"));

// ---------- Hjälpare: ladda ner ljudfil till tempfil ----------

async function downloadToTempFile(fileUrl) {
  console.log("[Kenai] laddar ner ljud från:", fileUrl);

  const response = await fetch(fileUrl);

  if (!response.ok) {
    throw new Error(
      `Nedladdning misslyckades: ${response.status} ${response.statusText}`
    );
  }

  // Hämta som ArrayBuffer och skriv till temp-fil
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const tmpFileName = `kenai-audio-${Date.now()}.webm`;
  const tmpPath = path.join(os.tmpdir(), tmpFileName);

  await fs.promises.writeFile(tmpPath, buffer);

  console.log("[Kenai] ljud sparat till tempfil:", tmpPath);
  return tmpPath;
}

// ---------- Healthcheck ----------

app.get("/api/health", (req, res) => {
  res.json({ ok: true, status: "Kenai backend live" });
});

// ---------- /api/summarize2 – transkribering + sammanfattning ----------

app.post("/api/summarize2", async (req, res) => {
  const { url } = req.body || {};

  if (!url) {
    console.error("[Kenai] summarize2: Ingen URL i body.");
    return res.status(400).json({ error: "Ingen ljud-URL mottagen." });
  }

  console.log("[Kenai] summarize2 – startar med URL:", url);

  let tempPath = null;

  try {
    // 1) Ladda ner ljudfilen till temp
    tempPath = await downloadToTempFile(url);

    // 2) Skicka till OpenAI (Whisper) för transkribering
    console.log("[Kenai] skickar tempfil till OpenAI (Whisper)...");
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: "whisper-1",
      // Vi antar oftast svenska, men Whisper auto-detekterar också bra
      language: "sv",
    });

    const transcriptText = transcription.text || "";
    console.log("[Kenai] transkribering klar, längd:", transcriptText.length);

    // 3) Skicka transkriptet till GPT för sammanfattning
    console.log("[Kenai] skickar transkript till GPT för sammanfattning...");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Du är en svensk assistent som sammanfattar ljudinspelningar kort, tydligt och konkret. Använd vardaglig svenska.",
        },
        {
          role: "user",
          content: `
Här är en transkribering från en ljudinspelning. 

1) Ge en kort sammanfattning (3–6 meningar) på svenska.
2) Lista sedan 3–7 viktiga punkter som bullets.

Transkript:
${transcriptText}
          `.trim(),
        },
      ],
    });

    const rawSummary = completion.choices?.[0]?.message?.content || "";
    const summaryText = rawSummary.trim();
    const fullSummary = summaryText;

    console.log("[Kenai] sammanfattning klar, längd:", summaryText.length);

    // 4) Skicka tillbaka i format som frontenden förväntar sig
    return res.json({
      summaryText,
      fullSummary,
      transcript: transcriptText,
      audioUrl: url,
    });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(500).json({
      error: "Serverfel vid AI-sammanfattning.",
      details: err.message || String(err),
    });
  } finally {
    // Försök alltid radera tempfilen
    if (tempPath) {
      fs.unlink(tempPath, (unlinkErr) => {
        if (unlinkErr) {
          console.warn("[Kenai] kunde inte radera tempfil:", unlinkErr);
        } else {
          console.log("[Kenai] tempfil raderad:", tempPath);
        }
      });
    }
  }
});

// ---------- /api/export-pdf – exportera sammanfattning som PDF ----------

app.post("/api/export-pdf", (req, res) => {
  const { summary } = req.body || {};

  if (!summary) {
    return res.status(400).json({ error: "Ingen text att exportera." });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="kenai-sammanfattning.pdf"'
  );

  const doc = new PDFDocument();
  doc.pipe(res);

  doc.fontSize(18).text("Kenai – Sammanfattning", { underline: true });
  doc.moveDown();

  doc.fontSize(12).text(summary, {
    align: "left",
  });

  doc.end();
});

// ---------- /api/send-summary-email – mockad e-post ----------

app.post("/api/send-summary-email", async (req, res) => {
  const { email, summary } = req.body || {};

  console.log("[Kenai] mock-email:", { email, summaryLength: summary?.length });

  // Här kan riktig e-postlösning läggas in senare (SendGrid, Resend, etc.)
  return res.json({
    ok: true,
    message: "Mail-funktionen är mockad – inget riktigt mail skickades.",
  });
});

// ---------- Starta servern ----------

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Kenai backend kör på port", PORT);
});
