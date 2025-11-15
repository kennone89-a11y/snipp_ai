// server.js - Kenai backend: statiska filer + health + build-reel (plan-läsning)

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Statisk frontend (public-mappen)
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// ----- Health-check -----
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Kenai backend är igång ✅" });
});

// ----- Reels: läs plan.json från Supabase -----

// Supabase URL behövs för att bygga public-länkarna
const SB_URL = process.env.SB_URL;

if (!SB_URL) {
  console.warn(
    "⚠️ SB_URL saknas i environment variables! /api/build-reel kommer inte fungera."
  );
}

// Hjälp-funktion för att hämta JSON
async function fetchJson(url) {
  const res = await fetch(url); // Node 22 har global fetch
  if (!res.ok) {
    throw new Error(`Failed to fetch JSON ${url} (${res.status})`);
  }
  return res.json();
}

/**
 * POST /api/build-reel
 * Body: { sessionId: "..." }
 *
 * v1: läser bara plan.json och returnerar:
 *  - basePublic (mapp-URL)
 *  - plan (innehållet i plan.json)
 *  - files[] med färdiga public URLs till alla klipp
 */
app.post("/api/build-reel", async (req, res) => {
  try {
    const { sessionId } = req.body || {};

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId saknas" });
    }

    if (!SB_URL) {
      return res
        .status(500)
        .json({ error: "SB_URL saknas på servern (kolla environment vars)" });
    }

    // Bas-URL till din public bucket:
    // audio/reels/<sessionId>/...
    const basePublic = `${SB_URL}/storage/v1/object/public/audio/reels/${sessionId}`;

    // 1. Hämta plan.json
    const planUrl = `${basePublic}/plan.json`;

    let plan;
    try {
      plan = await fetchJson(planUrl);
    } catch (err) {
      console.error("Kunde inte läsa plan.json:", err.message);
      return res.status(404).json({
        ok: false,
        error: "plan.json hittades inte eller gick inte att läsa",
        url: planUrl
      });
    }

    const clips = Array.isArray(plan.clips) ? plan.clips : [];

    // 2. Bygg lista med public URLs för klippen
    const files = clips.map((clip, index) => {
      const name =
        clip.file || clip.path || clip.name || clip.filename || `clip-${index}`;
      const url = `${basePublic}/${name}`;
      return {
        index,
        type: clip.type || "unknown",
        url,
        original: clip
      };
    });

    // 3. Skicka tillbaka info
    res.json({
      ok: true,
      sessionId,
      basePublic,
      plan,
      files
    });
  } catch (err) {
    console.error("build-reel error:", err);
    res.status(500).json({
      ok: false,
      error: "Något gick fel i /api/build-reel",
      details: err.message
    });
  }
});

// ----- Starta servern -----
app.listen(PORT, () => {
  console.log(`Kenai backend lyssnar på port ${PORT}`);
});
