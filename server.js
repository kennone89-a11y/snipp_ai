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

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

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
app.listen(PORT, () => {
  console.log(`Kenai backend lyssnar på port ${PORT}`);
});
