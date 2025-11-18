// server.js – Kenai backend (Recorder + Reels + AI)
// --- Imports ---
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
app.post("/api/summarize", async (req, res) => {
  try {
    const { url } = req.body || {};

    if (!url) {
      return res.status(400).json({ error: "Ingen url skickades in." });
    }

    // 1) Hämta ljudfilen från Supabase (den publika länken)
    const fileResponse = await fetch(url);
    if (!fileResponse.ok) {
      throw new Error(`Kunde inte hämta filen (${fileResponse.status})`);
    }
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2) Spara temporärt på disk (Render -> /tmp funkar)
    const tmpFilePath = path.join(
      os.tmpdir(),
      `kenai-audio-${Date.now()}.webm`
    );
    await fs.promises.writeFile(tmpFilePath, buffer);

    // 3) Skicka till OpenAI för transkribering (svenska)
    const transcription = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file: fs.createReadStream(tmpFilePath),
      language: "sv",
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
app.post("/api/summarize", async (req, res) => {
  try {
    const { audioUrl } = req.body;

    if (!audioUrl) {
      return res.status(400).json({ ok: false, error: "audioUrl saknas i body" });
    }

    // 1. Hämta ljudfilen från Supabase-länken
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) {
      console.error("Kunde inte ladda ner ljudfil:", audioResp.status, audioResp.statusText);
      return res
        .status(500)
        .json({ ok: false, error: "Kunde inte ladda ner ljudfil från URL" });
    }

    const arrayBuffer = await audioResp.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    // 2. Skicka till OpenAI för transkribering
    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer]), "audio.wav");
    formData.append("model", "gpt-4o-mini-transcribe");
    formData.append("response_format", "json");

    const openaiAudioResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    const audioData = await openaiAudioResp.json();

    if (!openaiAudioResp.ok) {
      console.error("OpenAI audio error:", audioData);
      return res
        .status(500)
        .json({ ok: false, error: "Fel från OpenAI (audio)", details: audioData });
    }

    const transcript = audioData.text || "";

    // 3. Sammanfatta texten
    const summaryResp = await fetch("https://api.openai.com/v1/chat/completions", {
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
              "Du är en assistent som sammanfattar svenska ljudinspelningar. Var kortfattad och tydlig.",
          },
          {
            role: "user",
            content:
              "Här är transkriberingen av ett ljudklipp. Skriv först en mycket kort sammanfattning (2–4 meningar) på svenska. Efter det, om du vill, kan du lägga till viktiga punkter i punktlista.\n\n" +
              transcript,
          },
        ],
      }),
    });

    const summaryData = await summaryResp.json();

    if (!summaryResp.ok) {
      console.error("OpenAI summary error:", summaryData);
      return res
        .status(500)
        .json({ ok: false, error: "Fel från OpenAI (summary)", details: summaryData });
    }

    const summary = (summaryData.choices?.[0]?.message?.content || "").trim();

    return res.json({
      ok: true,
      transcript,
      summary,
    });
  } catch (err) {
    console.error("Fel i /api/summarize:", err);
    return res.status(500).json({ ok: false, error: "Internt serverfel i /api/summarize" });
  }
});

app.listen(PORT, () => {
  console.log(`Kenai backend lyssnar på port ${PORT}`);
});
