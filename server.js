// server.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Demo-databas i minnet (nollställs när instansen startas om) ---
const uploads = []; // { filename, url, size, ts }

// --- Upload dir (ephemeral i Render) ---
const UPLOAD_DIR = path.join(process.env.TMPDIR || '/tmp', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Multer med filstorleksgräns 25 MB ---
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `audio_${Date.now()}${path.extname(file.originalname || '')}`)
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// Statics
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/health', (_req, res) => res.type('text').send('OK'));

// API: ladda upp
app.post('/api/upload', (req, res, next) => upload.single('audio')(req, res, err => {
  if (err) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok:false, error:'Filen är för stor (max 25 MB).' });
    return next(err);
  }
  if (!req.file) return res.status(400).json({ ok:false, error:'Ingen fil bifogad.' });

  const url = `/uploads/${req.file.filename}`;
  uploads.unshift({ filename: req.file.filename, url, size: req.file.size, ts: Date.now() });
  if (uploads.length > 20) uploads.pop(); // håll listan liten

  return res.json({ ok:true, url, filename: req.file.filename, size: req.file.size });
}));

// API: lista senaste
app.get('/api/uploads', (_req, res) => {
  res.json({ ok:true, items: uploads });
});

// Root
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Global felhanterare
app.use((err, _req, res, _next) => {
  console.error('Upload error:', err);
  res.status(500).json({ ok:false, error:'Serverfel vid uppladdning.' });
});

app.listen(PORT, () => console.log('✅ Server running on port', PORT));
