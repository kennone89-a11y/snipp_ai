// server.js – Kenai backend (stabil version)

import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import fs from "fs";
import os from "os";

// ==== Basic setup ====

dotenv.config();

const app = express();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ESM helpers
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CORS utan cors-paket
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
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

// Body-parsing för JSON (SUPER-viktigt för /api/summarize)
app.use(express.json({ limit: "10mb" }));

// Static files (public/)
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

// ==== /api/summarize – ta Supabase-URL, hämta ljud, skicka till OpenAI ====

app.post("/api/summarize", async (req, res) => {
  try {
    // Acceptera flera möjliga fältnamn för att inte bryta frontend
    const body = req.body || {};
    const url =
      body.audioUrl ||
      body.url ||
      body.audio_url ||
      body.supabaseUrl ||
      "";

    console.log("[Kenai] summarize – raw body:", body);

    if (!url || typeof url !== "string") {
      console.error("[Kenai] summarize – ingen ljud-URL skickad.");
      return res.status(400).json({ error: "Ingen ljud-URL skickad." });
    }

    console.log("[Kenai] summarize – startar med URL:", url);

    // 1) Hämta ljudfilen från Supabase (publik URL)
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      const txt = await audioRes.text().catch(() => "");
      console.error(
        "[Kenai] summarize – misslyckades hämta ljud:",
        audioRes.status,
        txt
      );
      return res
        .status(400)
        .json({ error: "Kunde inte hämta ljudfil från Supabase." });
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2) Spara temporärt till disk (för Whisper)
    const tmpDir = os.tmpdir();
    const tmpPath = path.join(
      tmpDir,
      `kenai-audio-${Date.now()}.webm`
    );

    await fs.promises.writeFile(tmpPath, buffer);
    console.log("[Kenai] summarize – sparat tempfil:", tmpPath);

    // 3) Skicka till OpenAI Whisper för transkribering
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
      // language: "sv", // kan avkommenteras vid behov
      response_format: "verbose_json",
    });

    const transcriptText =
      transcription.text ||
      transcription.transcript ||
      "";

    console.log(
      "[Kenai] summarize – transkript längd:",
      transcriptText.length
    );

    // 4) Skicka transkript till GPT för sammanfattning på svenska
    const chatRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Du är en svensk assistent som sammanfattar inspelade möten, poddar och röster kort och tydligt.",
        },
        {
          role: "user",
          content:
            "Detta är ett transkript från ett ljudklipp. Gör en kort, tydlig sammanfattning på svenska, och avsluta med 3–7 viktiga punkter.\n\nTranskript:\n\n" +
            transcriptText,
        },
      ],
    });

    const summaryText =
      chatRes.choices?.[0]?.message?.content?.trim() || "";

    console.log(
      "[Kenai] summarize – summary längd:",
      summaryText.length
    );

    // 5) Städa tempfil
    fs.promises.unlink(tmpPath).catch(() => {});

    // 6) Skicka svar tillbaka till frontend
    return res.json({
      transcript: transcriptText,
      summary: summaryText,
      fullSummary: summaryText, // bakåtkompatibelt namn
    });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res
      .status(500)
      .json({ error: "Serverfel vid AI-sammanfattning." });
  }
});

// ==== /api/export-pdf – exportera sammanfattning + transkript ====

app.post("/api/export-pdf", async (req, res) => {
  try {
    const { summary, transcript } = req.body || {};

    if (!summary && !transcript) {
      return res
        .status(400)
        .json({ error: "Ingen data att exportera." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kenai-summary.pdf"'
    );

    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(18).text("Kenai – AI-sammanfattning", {
      align: "center",
    });
    doc.moveDown();

    if (summary) {
      doc.fontSize(14).text("Sammanfattning:", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(12).text(summary);
      doc.moveDown();
    }

    if (transcript) {
      doc.addPage();
      doc.fontSize(14).text("Transkript:", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(transcript);
    }

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    return res.status(500).json({ error: "Kunde inte skapa PDF." });
  }
});

// ==== /api/send-summary-email – mockad mail-funktion ====

app.post("/api/send-summary-email", async (req, res) => {
  const { email, summary } = req.body || {};
  console.log("[Kenai] MOCK EMAIL:", { email, summary });
  // Här kan du koppla på riktig mail senare (SendGrid, Resend, etc)
  return res.json({ ok: true, message: "Mail-funktionen är mock." });
});

// ==== Start server ====

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(
    `Kenai backend kör på port ${PORT} – http://localhost:${PORT}`
  );
  console.log(
    "Tillgänglig på Render som:",
    process.env.RENDER_EXTERNAL_URL || "(okänd URL)"
  );
});
