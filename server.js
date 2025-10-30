import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ---- Säkerhet ----
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ---- CORS ----
app.use(cors({ origin: true }));

// ---- JSON-stöd ----
app.use(express.json());

// ---- Statisk mapp ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Skicka startsidan ----
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Starta servern ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Servern kör på port ${PORT}`));
