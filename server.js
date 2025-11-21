// Enkel Kenai-backend (stabil baseline)

// --- Imports ---
const express = require("express");
const cors = require("cors");
const PDFDocument = require("pdfkit");

// --- Setup ---
const app = express();
app.use(express.json());
app.use(cors());

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// --- AI-transkribering + sammanfattning (riktig) ---
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

    // 2. Skicka till OpenAI för transkribering (Whisper)
    const formData = new FormData();
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

    // 3. Be GPT sammanfatta på svenska (eller enligt locale)
    const promptLocale = locale || "sv-SE";
    const languageHint =
      promptLocale.toLowerCase().startsWith("sv")
        ? "svenska"
        : "samma språk som texten";

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
                `Svara på ${languageHint}. Ge både en tydlig sammanfattning och gärna lite 'review-känsla' om det passar.`,
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
      console.error(
        "Fel från OpenAI summary:",
        summaryResp.status,
        errText
      );
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

    // Här kan vi senare koppla in riktig mail (Resend/Nodemailer)
    return res.json({ ok: true });
  } catch (err) {
    console.error("send-summary-email error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// --- Exportera text till PDF (riktig) ---
app.post("/api/export-pdf", (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content) {
      return res
        .status(400)
        .json({ ok: false, error: "content saknas" });
    }

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
  console.log(`Kenai stub-backend lyssnar på port ${PORT}`);
});
