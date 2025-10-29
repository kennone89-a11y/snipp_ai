import fs from 'fs';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Miljövariabler: process.env först (Render/Prod), annars .env (lokalt)
let API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8').trim();
    API_KEY = raw.startsWith('OPENAI_API_KEY=') ? raw.slice('OPENAI_API_KEY='.length).trim() : raw.trim();
  }
}
const ALLOWED = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);

const app = express();

// Säkerhet
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS (om ALLOWED är tomt -> tillåt alla)
app.use(cors({ origin: ALLOWED.length ? ALLOWED : true }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hårda mappar för lagring
const uploadsDir = path.join(__dirname, 'uploads');
const textsDir   = path.join(__dirname, 'texts');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(textsDir))   fs.mkdirSync(textsDir,   { recursive: true });

// Multer: spara med rätt ändelse
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    let ext = '.webm';
    const mt = (file.mimetype || '').toLowerCase();
    if (mt.includes('wav')) ext = '.wav';
    else if (mt.includes('ogg') || mt.includes('oga')) ext = '.ogg';
    else if (mt.includes('mp3') || mt.includes('mpeg') || mt.includes('mpga')) ext = '.mp3';
    else if (mt.includes('m4a')) ext = '.m4a';
    else if (mt.includes('mp4')) ext = '.mp4';
    else if (mt.includes('flac')) ext = '.flac';
    else if (mt.includes('webm')) ext = '.webm';
    const origExt = path.extname(file.originalname || '') || ext;
    cb(null, `${Date.now()}${origExt}`);
  }
});
const upload = multer({ storage });

// OpenAI-klient
const openai = new OpenAI({ apiKey: API_KEY });

// Rate limit
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 requests/min per IP
});
app.use('/api/', limiter);

// Hälsa
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Transkribera + spara
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  const filePath = req?.file?.path;
  if (!filePath) return res.status(400).json({ error: 'Ingen ljudfil mottagen' });

  try {
    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-1'
    });

    const text = response.text || '';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `transkript_${stamp}.txt`;
    const savePath = path.join(textsDir, baseName);
    fs.writeFileSync(savePath, text, 'utf8');

    fs.unlink(filePath, () => {});
    res.json({ text, saved: true, filename: baseName });
  } catch (err) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Historik
app.get('/api/history', async (req, res) => {
  try {
    const files = fs.readdirSync(textsDir)
      .filter(n => n.toLowerCase().endsWith('.txt'))
      .map(name => {
        const p = path.join(textsDir, name);
        const s = fs.statSync(p);
        return { name, size: s.size, mtime: s.mtimeMs };
      })
      .sort((a,b) => b.mtime - a.mtime);
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hämta text
app.get('/api/text/:name', (req, res) => {
  const safe = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
  const file = path.join(textsDir, safe);
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.download(file, safe);
});

// Radera text
app.delete('/api/text/:name', (req, res) => {
  const safe = req.params.name.replace(/[^a-zA-Z0-9._-]/g, '');
  const file = path.join(textsDir, safe);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server igång på port ${PORT}`);
});
