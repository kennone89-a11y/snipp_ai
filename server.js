const path = require('path');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Statics
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/health', (_req, res) => res.type('text').send('OK'));

// Root -> public/index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('✅ Server running on port', PORT));
