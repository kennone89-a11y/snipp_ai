// server.js (CommonJS, stabil)
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// 1) Dela ut /public som webroot (så /surf.jpg funkar)
app.use(express.static(path.join(__dirname, 'public')));

// 2) Startsidan
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 3) Healthcheck (snabb koll)
app.get('/health', (_req, res) => res.type('text').send('OK'));

app.listen(PORT, () => {
  console.log('✅ Server running on port ' + PORT);
});
