// server.js – Kenai backend (Recorder + Reels + AI)
// --- Imports ---
const PDFDocument = require("pdfkit");
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");

const OpenAI = require("openai");
const { toFile } = require("openai/uploads");

// --- Setup ---
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// --- OpenAI-klient ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- En enkel health-check (valfritt men bra att ha) ---
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------
//  REELS: enkel /api/build-reel som läser plan.json från Supabase
// ---------------------------------------------------------

// Den här endpointen förväntar sig antingen:
//  - body: { planUrl: "https://..." }
//  eller
//  - body: { sessionId: "abc123" }  → då bygger vi en URL till plan.json
//
// plan.json antas ligga i bucket "audio", path: reels/<sessionId>/plan.json

app.post("/api/build-reel", async (req, res) => {
  try {
    const { planUrl, sessionId } = req.body || {};

    const SB_URL = process.env.SB_URL;
    const SB_ANON = process.env.SB_ANON;

    let url = planUrl;

    if (!url) {
      if (!SB_URL || !SB_ANON) {
        return res
          .status(500)
          .json({ error: "SB_URL eller SB_ANON saknas i environment" });
      }
      if (!sessionId) {
        return res
          .status(400)
          .json({ error: "Saknar sessionId eller planUrl i body" });
      }

      // Antagen plats för plan.json i Supabase
      url = `${SB_URL}/storage/v1/object/public/audio/reels/${sessionId}/plan.json`;
    }

    const planResp = await fetch(url, {
      headers: {
        apikey: SB_ANON,
      },
    });

    if (!planResp.ok) {
      return res
        .status(400)
        .json({ error: "Kunde inte hämta plan.json från Supabase" });
    }

    const plan = await planResp.json();
    const clips = Array.isArray(plan.clips) ? plan.clips : [];

    const totalDuration = clips.reduce(
      (sum, c) => sum + (Number(c.duration) || 0),
      0
    );

    return res.json({
      ok: true,
      sourceUrl: url,
      clipCount: clips.length,
      totalDuration,
      targetDuration: plan.targetDuration || null,
      plan,
    });
  } catch (err) {
    console.error("build-reel error:", err);
    return res
      .status(500)
      .json({ error: "Något gick fel i /api/build-reel" });
  }
});
// --- AI-sammanfattning av inspelning ---
// --- AI: transkribera & sammanfatta ---
// --- AI: transkribera & sammanfatta ---
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { email, summary, audioUrl, locale } = req.body || {};

    if (!email || !summary) {
      return res.status(400).json({ error: "email och summary krävs" });
    }

    console.log("=== MOCK EMAIL ===");
    console.log("Till:", email);
    console.log("Språk:", locale);
    console.log("Audio URL:", audioUrl);
    console.log("Sammanfattning:", summary.slice(0, 200), "...");
    console.log("===================");

    // TODO: här bygger vi in riktig mailfunktion (Resend/Nodemailer)
    return res.json({ ok: true });
  } catch (err) {
    console.error("send-summary-email error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/export-pdf", (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content) {
      return res.status(400).json({ ok: false, error: "content saknas" });
    }

    // Säg till browsern att det är en PDF att ladda ner
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kenai-sammanfattning.pdf"'
    );

    const doc = new PDFDocument({ margin: 40 });

    // Skicka PDF-strömmen direkt till klienten
    doc.pipe(res);

    // Rubrik
    doc.fontSize(18).text("Kenai – AI-sammanfattning", {
      align: "center",
    });
    doc.moveDown();

    // Själva innehållet (det du har i rutan)
    doc.fontSize(12).text(content, {
      align: "left",
    });

    doc.end();
  } catch (err) {
    console.error("Fel i /api/export-pdf:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Internt fel i /api/export-pdf" });
  }
});
  
  try {
    const { audioUrl } = req.body || {};
    if (!audioUrl) {
      return res
        .status(400)
        .json({ ok: false, error: "audioUrl saknas i body" });
    }

    console.log("API /api/summarize – audioUrl:", audioUrl);

    // 1) Ladda ner ljudfilen till temp
    const tmpFile = path.join(os.tmpdir(), `kenai_${Date.now()}.webm`);

    const dlResp = await fetch(audioUrl);
    if (!dlResp.ok) {
      const text = await dlResp.text().catch(() => "");
      console.error(
        "Kunde inte ladda ner audio från Supabase:",
        dlResp.status,
        text
      );
      return res.status(500).json({
        ok: false,
        error: "Kunde inte ladda ner ljudfilen från Supabase",
      });
    }

    const buf = Buffer.from(await dlResp.arrayBuffer());
    fs.writeFileSync(tmpFile, buf);

    // 2) Transkribera med Whisper
    const transcriptResp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      language: "sv",
    });

    const transcript = transcriptResp.text || "";

    // 3) Sammanfatta med GPT
    const summaryResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Du är en assistent som sammanfattar svenska ljudinspelningar. Var kortfattad och tydlig.",
        },
        {
          role: "user",
          content:
            "Här är transkriberingen av ett ljudklipp. Skriv först en mycket kort sammanfattning (2–4 meningar) på svenska. " +
            "Efter det, om du vill, kan du lägga till viktiga punkter i punktlista.\n\n" +
            transcript,
        },
      ],
    });

    const summary =
      summaryResp.choices?.[0]?.message?.content?.trim() || "";

    // 4) Skicka tillbaka JSON till frontenden
    return res.json({
      ok: true,
      transcript,
      summary,
    });
  } catch (err) {
    console.error("Fel i /api/summarize:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Internt serverfel i /api/summarize",
    });
  }
});


    const buf = Buffer.from(await dlResp.arrayBuffer());
    fs.writeFileSync(tmpFile, buf);

    // 2) Transkribera med Whisper
    const transcriptResp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      language: "sv",
    });

    const transcript = transcriptResp.text || "";

    // 3) Sammanfatta med GPT
    const summaryResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Du är en assistent som sammanfattar svenska ljudinspelningar. Var kortfattad och tydlig.",
        },
        {
          role: "user",
          content:
            "Här är transkriberingen av ett ljudklipp. Skriv först en mycket kort sammanfattning (2–4 meningar) på svenska. " +
            "Efter det, om du vill, kan du lägga till viktiga punkter i punktlista.\n\n" +
            transcript,
        },
      ],
    });

    const summary =
      summaryResp.choices?.[0]?.message?.content?.trim() || "";

    // 4) Skicka tillbaka JSON till frontenden
    return res.json({
      ok: true,
      transcript,
      summary,
    });
  } catch (err) {
    console.error("Fel i /api/summarize:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Internt serverfel i /api/summarize",
    });
  }
});


    const transcriptText = transcription.text || "";

    // 4) Sammanfatta texten med OpenAI
    const summaryResponse = await openai.responses.create({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content:
            "Du är en rak och tydlig svensk assistent som skriver korta sammanfattningar av röstmemon.",
        },
        {
          role: "user",
          content:
            "Sammanfatta den här talade recensionen på max 5 meningar. Ta med syfte, ton och eventuella rekommendationer:\n\n" +
            transcriptText,
        },
      ],
    });

    const summary =
      summaryResponse.output?.[0]?.content?.[0]?.text ??
      "Kunde inte läsa sammanfattningen från modellen.";

    res.json({
      summary,
      transcript: transcriptText,
    });
  } catch (err) {
    console.error("Summarize error:", err);
    res
      .status(500)
      .json({ error: "Sammanfattning misslyckades.", details: String(err) });
  }
});

// ---------------------------------------------------------
//  AI för Kenai Recorder: /api/ai-review
// ---------------------------------------------------------

// Tar emot { audioUrl } (publik Supabase-länk till ljudfilen),
// transkriberar den (svenska) och gör en kort sammanfattning.

app.post("/api/ai-review", async (req, res) => {
  try {
    const { audioUrl } = req.body || {};

    if (!audioUrl) {
      return res.status(400).json({ error: "Saknar audioUrl" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res
        .status(500)
        .json({ error: "OPENAI_API_KEY saknas i environment" });
    }

    // 1) Hämta ljudfilen
    const resp = await fetch(audioUrl);
    if (!resp.ok) {
      return res
        .status(400)
        .json({ error: "Kunde inte hämta ljudfil från Supabase" });
    }

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // TODO: om du i framtiden sparar WAV istället, ändra mime-typ + filnamn
    const file = await toFile(buffer, "recording.webm", {
      type: "audio/webm",
    });

    // 2) Transkribera på svenska
    const transcription = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      language: "sv",
    });

    const transcriptText = transcription.text || "";

    // 3) Sammanfatta kort på svenska
    const summaryResponse = await openai.responses.create({
      model: "gpt-4o-mini",
      input:
        "Sammanfatta följande svenska röst-recension i 2–3 meningar på svenska:\n\n" +
        transcriptText,
    });

    const summary =
      summaryResponse.output_text ||
      (summaryResponse.output &&
        summaryResponse.output[0] &&
        summaryResponse.output[0].content &&
        summaryResponse.output[0].content[0] &&
        summaryResponse.output[0].content[0].text) ||
      "";

    return res.json({
      transcript: transcriptText,
      summary,
    });
  } catch (err) {
    console.error("AI-review error:", err);
    return res.status(500).json({
      error: "Något gick fel med AI:n",
    });
  }
});

// ---------------------------------------------------------
//  Starta servern
// ---------------------------------------------------------
// AI-transkribering + sammanfattning
// --- AI-transkribering + sammanfattning ---
app.post("/api/summarize", async (req, res) => {
  try {
    const { audioUrl, url, locale } = req.body || {};
    const finalUrl = audioUrl || url;

    if (!finalUrl) {
      return res
        .status(400)
        .json({ ok: false, error: "audioUrl eller url saknas i body" });
    }

    console.log("[/api/summarize] Hämtar ljud från:", finalUrl);

    // 1. Hämta ljudfilen från Supabase-länken (eller annan URL)
    const audioResp = await fetch(finalUrl);
    if (!audioResp.ok) {
      console.error(
        "Kunde inte ladda ner ljudfil:",
        audioResp.status,
        audioResp.statusText
      );
      return res
        .status(500)
        .json({ ok: false, error: "Kunde inte ladda ner ljudfil från URL" });
    }

    const arrayBuffer = await audioResp.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // 2. Skicka till OpenAI för transkribering
    const formData = new FormData();
    // Typen spelar mindre roll här, OpenAI försöker autodetektera
    formData.append(
      "file",
      new Blob([audioBuffer], { type: "audio/webm" }),
      "audio.webm"
    );
    formData.append("model", "gpt-4o-mini-transcribe");

    const openaiAudioResp = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: formData,
      }
    );

    if (!openaiAudioResp.ok) {
      const errText = await openaiAudioResp.text();
      console.error("Fel från OpenAI audio:", openaiAudioResp.status, errText);
      return res.status(500).json({
        ok: false,
        error: "Fel vid transkribering hos OpenAI",
        details: errText,
      });
    }

    const audioJson = await openaiAudioResp.json();
    const transcript = audioJson.text || "";

    console.log("[/api/summarize] Transcript längd:", transcript.length);

    // 3. Be GPT sammanfatta på svenska
    const promptLocale = locale || "sv-SE";
    const languageHint =
      promptLocale.toLowerCase().startsWith("sv") ? "svenska" : "samma språk som texten";

    const summaryResp = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                `Du är en hjälpsam assistent som transkriberar och sammanfattar ljud. ` +
                `Svara på ${languageHint}. Ge både en kort sammanfattning och gärna lite review-ton om det passar.`,
            },
            {
              role: "user",
              content:
                "Här är transkriberingen av ljudet:\n\n" +
                transcript +
                "\n\nSammanfatta innehållet tydligt.",
            },
          ],
        }),
      }
    );

    if (!summaryResp.ok) {
      const errText = await summaryResp.text();
      console.error("Fel från OpenAI summary:", summaryResp.status, errText);
      return res.status(500).json({
        ok: false,
        error: "Fel vid textsammanfattning hos OpenAI",
        details: errText,
      });
    }

    const summaryJson = await summaryResp.json();
    const summaryText =
      summaryJson.choices?.[0]?.message?.content?.trim() || "";

    return res.json({
      ok: true,
      transcript,
      summary: summaryText,
    });
  } catch (err) {
    console.error("summarize error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Skicka sammanfattning via e-post (mock) ---
app.post("/api/send-summary-email", async (req, res) => {
  try {
    const { email, summary, audioUrl, locale } = req.body || {};

    if (!email || !summary) {
      return res.status(400).json({ error: "email och summary krävs" });
    }

    console.log("=== MOCK EMAIL ===");
    console.log("Till:", email);
    console.log("Språk:", locale);
    console.log("Audio URL:", audioUrl);
    console.log("Sammanfattning:", summary.slice(0, 200), "...");
    console.log("===================");

    // TODO: här kan vi senare koppla in riktig mail (Resend/Nodemailer)
    return res.json({ ok: true });
  } catch (err) {
    console.error("send-summary-email error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// --- Exportera text till PDF ---
app.post("/api/export-pdf", (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content) {
      return res
        .status(400)
        .json({ ok: false, error: "content saknas" });
    }

    // Säg till browsern att det är en PDF att ladda ner
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="kenai-sammanfattning.pdf"'
    );

    const doc = new PDFDocument();
    doc.pipe(res);

    doc.fontSize(14).text(content, {
      width: 500,
      align: "left",
    });

    doc.end();
  } catch (err) {
    console.error("export-pdf error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// --- Starta servern ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kenai backend lyssnar på port ${PORT}`);
});
