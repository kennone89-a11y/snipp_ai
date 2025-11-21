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

// --- AI-transkribering + sammanfattning (stub just nu) ---
// Denna endpoint svarar bara med en "låtsas-sammanfattning" så att
// frontend inte kraschar medan vi fixar riktiga OpenAI-anrop senare.
app.post("/api/summarize", async (req, res) => {
  try {
    const { audioUrl, url } = req.body || {};
    const usedUrl = audioUrl || url || null;

    console.log("[/api/summarize] Stub kallas. URL:", usedUrl);

    const fakeTranscript =
      "Detta är en stub-transkribering. Backend är i safe-läge just nu.";
    const fakeSummary =
      "Stub-sammanfattning: allt funkar tekniskt, men riktiga AI-svaren är inte påkopplade ännu.";

    return res.json({
      ok: true,
      transcript: fakeTranscript,
      summary: fakeSummary,
    });
  } catch (err) {
    console.error("summarize stub error:", err);
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
