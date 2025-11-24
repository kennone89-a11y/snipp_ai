// server.js – Kenai backend (stabil version, omskriven)

// ============================
// Imports & setup
// ============================
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import PDFDocument from "pdfkit";
import fs from "fs";

dotenv.config();

// Skapa OpenAI-klienten
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================
// Enkel CORS-middleware
// ============================
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

// Body parser
app.use(express.json({ limit: "25mb" }));

// ============================
// Static files (frontend)
// ============================
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång" });
});

  // Tillåt både audiourl, audioUrl och url från frontend
const { audiourl, audioUrl, url } = req.body || {};
const targetUrl = audiourl || audioUrl || url;

console.log("[Kenai] summarize - start med URL:", targetUrl, "body:", req.body);
if (!targetUrl) {
  console.error("[Kenai] summarize - ingen URL i body", req.body);
  return res.status(400).json({ error: "Ingen ljud-URL skickad." });
}

console.log("[Kenai] summarize - startar med URL:", targetUrl);



    console.log("[Kenai] summarize – startar med URL:", url);

    // 1) Hämta ljudfilen från Supabase (public URL)
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      const txt = await audioRes.text().catch(() => "");
      console.error(
        "[Kenai] Misslyckades hämta ljud:",
        audioRes.status,
        txt.slice(0, 200)
      );
      return res
        .status(400)
        .json({ error: "Kunde inte hämta ljudfilen från Supabase." });
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Spara till temporär fil
    const tmpFile = path.join(
      __dirname,
      `tmp-audio-${Date.now()}.webm`
    );
    await fs.promises.writeFile(tmpFile, buffer);
    console.log("[Kenai] Ljud sparat till temp:", tmpFile);

    // 2) Skicka till OpenAI för transkribering
    const transcriptRes = await client.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file: fs.createReadStream(tmpFile),
      language: "sv",
      response_format: "json",
    });

    // Ta bort tempfil (best effort)
    fs.promises.unlink(tmpFile).catch(() => {});

    const transcriptText =
      transcriptRes.text ||
      transcriptRes.transcript ||
      "";

    console.log(
      "[Kenai] Transkribering klar, längd:",
      transcriptText.length
    );

    // 3) Skicka transkriptet till chat för sammanfattning
    const systemPrompt = `
Du är Kenai, en svensk AI-assistent som sammanfattar ljud.
Gör alltid:
1) En kort sammanfattning (3–5 meningar).
2) Bulletpoints med viktiga punkter.
3) Ev. actionlista om det passar.

Skriv på tydlig svenska och var rak, utan fluff.
    `.trim();

    const chatRes = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            transcriptText ||
            "Transkriptet är tomt, försök ändå sammanfatta så gott det går.",
        },
      ],
    });

    const summaryText =
      chatRes.choices?.[0]?.message?.content || "";

    console.log("[Kenai] Sammanfattning klar.");

    return res.json({
      ok: true,
      transcript: transcriptText,
      summary: summaryText,
    });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(500).json({
      error: "Serverfel vid AI-sammanfattning.",
      details: String(err?.message || err),
    });
  }
});

// ============================
// 2. /api/export-pdf – skapa PDF av sammanfattning
// ============================
app.post("/api/export-pdf", (req, res) => {
  try {
    const { summary, transcript } = req.body || {};

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kenai-sammanfattning.pdf"'
    );

    const doc = new PDFDocument({
      margin: 50,
    });

    doc.pipe(res);

    doc
      .fontSize(20)
      .text("Kenai – AI-sammanfattning", { underline: true })
      .moveDown();

    if (summary) {
      doc.fontSize(14).text("Sammanfattning:", {
        underline: true,
      });
      doc.moveDown(0.5);
      doc.fontSize(12).text(summary, { align: "left" });
      doc.moveDown();
    }

    if (transcript) {
      doc.fontSize(14).text("Transkribering:", {
        underline: true,
      });
      doc.moveDown(0.5);
      doc.fontSize(10).text(transcript, {
        align: "left",
      });
    }

    doc.end();
  } catch (err) {
    console.error("[Kenai] PDF ERROR:", err);
    res
      .status(500)
      .json({ error: "Kunde inte skapa PDF." });
  }
});

// ============================
// 3. /api/send-summary-email – mock
// ============================
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { email, summary } = req.body || {};
    console.log("[Kenai] Skulle maila sammanfattning till:", email);
    console.log("[Kenai] Sammanfattning (kort):", summary?.slice(0, 200));

    // Ingen riktig mail just nu – bara mock
    return res.json({
      ok: true,
      message: "Mail-funktion är mock just nu.",
    });
  } catch (err) {
    console.error("[Kenai] EMAIL ERROR:", err);
    return res
      .status(500)
      .json({ error: "Kunde inte skicka mail (mock)." });
  }
});

// ============================
// 4. /api/reels-plan-demo – preset-sidan loggar planen
// ============================
app.post("/api/reels-plan-demo", (req, res) => {
  try {
    console.log(
      "[Kenai Reels demo] Mottagen plan:",
      JSON.stringify(req.body, null, 2)
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[Kenai Reels demo] ERROR:", err);
    return res
      .status(500)
      .json({ error: "Kunde inte ta emot reel-plan." });
  }
});

// ============================
// 5. /api/trends-backend – enkla mock-trender
// ============================
app.post("/api/trends-backend", async (req, res) => {
  try {
    const { niche } = req.body || {};

    const n = niche || "din nisch";

    const mockTrends = [
      {
        title: "Snabb hook på 3 sekunder",
        idea: `Börja med en stark fråga inom ${n} direkt första sekunden.`,
        hashtags: "#kenai #reels #hook #viral",
      },
      {
        title: "Före / efter",
        idea: `Visa ett kort "före" och direkt efter ett "efter" resultat inom ${n}.`,
        hashtags: "#beforeafter #transformation #reels",
      },
      {
        title: "1 grej du gör fel",
        idea: `Berätta om ett vanligt misstag folk gör inom ${n} och hur man löser det.`,
        hashtags: "#tips #mistakes #learn",
      },
    ];

    return res.json({ trends: mockTrends });
  } catch (err) {
    console.error("TRENDS ERROR:", err);
    return res
      .status(500)
      .json({ error: "Kunde inte generera trender" });
  }
});

// ============================
// Starta servern
// ============================
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Kenai backend kör på port ${PORT}`);
});
