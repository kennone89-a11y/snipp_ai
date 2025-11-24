// server.js
// Kenai Recorder – spela in -> ladda upp -> AI-transkribera -> sammanfatta -> PDF

const path = require('path');
const fs = require('fs');
const express = require('express');
const { OpenAI } = require('openai');
const PDFDocument = require('pdfkit');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI-klient (se till att OPENAI_API_KEY är satt i Render)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware: JSON + CORS + statiska filer
app.use(express.json({ limit: '10mb' }));

// Enkel CORS – öppet så det GARANTERAT funkar från kenai.technology
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*'); // om du vill låsa: lägg in din domän istället
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serva frontend från /public (recorder.html ligger där)
app.use(express.static(path.join(__dirname, 'public')));

// Enkel healthcheck
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Kenai backend up & running' });
});

/**
 * POST /api/summarize
 * Body: { audioUrl: string, language?: string }
 * 1) Ladda ner ljudet från Supabase URL
 * 2) Skicka till OpenAI (transkribering)
 * 3) Skicka texten till OpenAI (sammanfattning på svenska)
 * 4) Returnera { transcript, summary }
 */
app.post('/api/summarize', async (req, res) => {
  try {
    const { audioUrl, language } = req.body || {};

    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl saknas i body.' });
    }

    console.log('🔊 Hämtar ljud från:', audioUrl);

    // 1) Ladda ner ljudfilen
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Kunde inte ladda ner ljudfilen: ${audioResponse.status} ${audioResponse.statusText}`);
    }

    const arrayBuffer = await audioResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Gissa filändelse från URLen (webm / wav / m4a / mp3 etc.)
    let ext = 'webm';
    try {
      const urlWithoutQuery = audioUrl.split('?')[0];
      const parts = urlWithoutQuery.split('.');
      if (parts.length > 1) {
        ext = parts[parts.length - 1];
      }
    } catch (e) {
      // ignorerar, använder webm
    }

    const tempPath = path.join('/tmp', `kenai-recording-${Date.now()}.${ext}`);
    fs.writeFileSync(tempPath, buffer);
    console.log('💾 Sparade temporär fil:', tempPath);

    // 2) Transkribera via OpenAI
    // Rekommenderad modell: gpt-4o-mini-transcribe (nya audio-modellen)
    const transcription = await openai.audio.transcriptions.create({
      model: 'gpt-4o-mini-transcribe', // eller 'whisper-1' om du vill
      file: fs.createReadStream(tempPath),
      language: language || 'sv', // svenska som default
    });

    const transcriptText =
      transcription.text ||
      transcription.output_text ||
      '';

    console.log('📝 Transcript (första 200 tecken):', transcriptText.slice(0, 200));

    // 3) Sammanfatta transcript via chat
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Du är en svensk assistent. Sammanfatta inspelningen kortfattat och tydligt. ' +
            'Ge helst 3–7 punkter och en kort helhetsbeskrivning. Skriv på svenska.',
        },
        {
          role: 'user',
          content: transcriptText || 'Transkriptionen var tom.',
        },
      ],
      temperature: 0.3,
    });

    const summaryText = completion.choices[0]?.message?.content?.trim() || '';

    // 4) Städa temporär fil
    try {
      fs.unlinkSync(tempPath);
    } catch (e) {
      console.warn('Kunde inte ta bort tempfil:', e.message);
    }

    // 5) Skicka tillbaka resultat
    res.json({
      ok: true,
      transcript: transcriptText,
      summary: summaryText,
    });
  } catch (err) {
    console.error('❌ Fel i /api/summarize:', err);
    res.status(500).json({
      ok: false,
      error: 'Något gick fel när AI skulle transkribera/sammanfatta.',
      details: err.message,
    });
  }
});

/**
 * POST /api/export-pdf
 * Body: { summary: string, transcript?: string }
 * Returnerar en PDF-stream (attachment) direkt till klienten.
 */
app.post('/api/export-pdf', (req, res) => {
  try {
    const { summary, transcript } = req.body || {};

    if (!summary) {
      return res.status(400).json({ error: 'summary saknas i body.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="kenai-sammanfattning.pdf"');

    const doc = new PDFDocument();

    doc.pipe(res);

    doc.fontSize(20).text('Kenai – Sammanfattning av inspelning', {
      align: 'center',
    });

    doc.moveDown();

    doc.fontSize(14).text('Sammanfattning:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12).text(summary, { align: 'left' });

    if (transcript) {
      doc.moveDown();
      doc.fontSize(14).text('Full transkription:', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(transcript, {
        align: 'left',
      });
    }

    doc.end();
  } catch (err) {
    console.error('❌ Fel i /api/export-pdf:', err);
    res.status(500).json({ error: 'Kunde inte skapa PDF.' });
  }
});

/**
 * POST /api/send-summary-email
 * Body: { email: string, summary: string, transcript?: string }
 * Just nu: mock – loggar bara till servern.
 */
app.post('/api/send-summary-email', (req, res) => {
  try {
    const { email, summary, transcript } = req.body || {};

    if (!email || !summary) {
      return res
        .status(400)
        .json({ error: 'email och summary måste finnas i body.' });
    }

    console.log('📧 MOCK EMAIL');
    console.log('Till:', email);
    console.log('Sammanfattning (första 200 tecken):', summary.slice(0, 200));
    if (transcript) {
      console.log('Transcriptlängd:', transcript.length);
    }

    res.json({ ok: true, message: 'Mock-email skickad (loggad i servern).' });
  } catch (err) {
    console.error('❌ Fel i /api/send-summary-email:', err);
    res.status(500).json({ error: 'Kunde inte mock-skicka mail.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Kenai backend lyssnar på port ${PORT}`);
});
