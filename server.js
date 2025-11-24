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
// --- AI-sammanfattning från ljud (ny version med gpt-4o-audio-preview) ---
app.post("/api/summarize", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url || typeof url !== "string") {
      console.error("[Kenai] /api/summarize – ingen URL i body.");
      return res.status(400).json({ error: "Ingen ljud-URL mottagen." });
    }

    console.log("[Kenai] /api/summarize – fick URL:", url);

    // 1) Hämta ljudfilen från Supabase
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      console.error("[Kenai] Kunde inte hämta ljudfilen:", audioRes.status, audioRes.statusText);
      return res
        .status(400)
        .json({ error: "Kunde inte hämta ljudfilen från Supabase." });
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Audio = buffer.toString("base64");

    // 2) Skicka in ljudet till GPT-4o audio-preview med input_audio
    console.log("[Kenai] Skickar ljud till OpenAI (gpt-4o-audio-preview) ...");

    const completion = await client.chat.completions.create({
      model: "gpt-4o-audio-preview",
      modalities: ["text"],
      // audio-fältet styr egentligen TTS-utdata; vi ignorerar ljud-svaret.
      audio: { voice: "alloy", format: "wav" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Du får en ljudfil som input_audio. " +
                "1) Transkribera allt tal så exakt som möjligt på originalspråk (oftast svenska). " +
                "2) Skriv sedan en tydlig sammanfattning på svenska (2–6 meningar). " +
                'Svara EXAKT i JSON-format: {\"transcript\": \"...\", \"summary\": \"...\"} utan extra text.',
            },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                // Våra filer är .webm från webbinspelaren
                format: "webm",
              },
            },
          ],
        },
      ],
    });

    const choice = completion.choices?.[0];
    let content = choice?.message?.content;

    let text;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      // ibland returneras content som delar
      text = content
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
    } else {
      text = JSON.stringify(content ?? "");
    }

    let transcript = "";
    let summary = "";

    try {
      const parsed = JSON.parse(text);
      transcript = parsed.transcript || "";
      summary = parsed.summary || "";
    } catch (jsonErr) {
      console.warn("[Kenai] Kunde inte parsa JSON från modellen, returnerar råtext.");
      summary = text;
    }

    if (!summary && !transcript) {
      summary = "Kunde inte läsa något innehåll från modellen.";
    }

    console.log("[Kenai] /api/summarize – klar.");

    return res.json({
      transcript,
      summary,
    });
  } catch (err) {
    console.error("[Kenai] SUMMARY ERROR:", err);
    return res.status(502).json({
      error: "Serverfel vid AI-sammanfattning.",
      detail: err?.message || String(err),
    });
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
