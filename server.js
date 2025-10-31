// server.js
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Upload-mapp (ephemeral på Render, funkar perfekt för demo) ---
const UPLOAD_DIR = path.join(process.env.TMPDIR || '/tmp', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Multer storage (behåller filändelsen om möjligt) ---
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // försök bevara ändelse
    let ext = '';
    if (file.originalname && file.originalname.includes('.')) {
      ext = path.extname(file.originalname);
    } else {
      const map = {
        'audio/webm': '.webm',
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'audio/mp4': '.m4a',
        'audio/ogg': '.ogg'
      };
      ext = map[file.mimetype] || '';
    }
    const safe = String(Date.now());
    cb(null, `audio_${safe}${ext}`);
  }
});
const upload = multer({ storage });

// --- Static ---
app.use('/uploads', express.static(UPLOAD_DIR));       // så vi kan spela upp efter upload
app.use(express.static(path.join(__dirname, 'public')));

// --- Health ---
app.get('/health', (_req, res) => res.type('text').send('OK'));

// --- Upload endpoint ---
app.post('/api/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const url = `/uploads/${req.file.filename}`;
  return res.json({ ok: true, url, filename: req.file.filename, size: req.file.size });
});

// --- Root -> index.html ---
app.get('/', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

// --- Start ---
app.listen(PORT, () => console.log('✅ Server running on port', PORT));
