import fs from 'fs';
import OpenAI from 'openai';

// För produktion: läs i första hand från process.env, annars .env
let key = process.env.OPENAI_API_KEY;
if (!key && fs.existsSync('.env')) {
  const raw = fs.readFileSync('.env', 'utf8').trim();
  key = raw.startsWith('OPENAI_API_KEY=')
    ? raw.slice('OPENAI_API_KEY='.length).trim()
    : raw.trim();
}
console.log('Key prefix:', (key || '').slice(0, 7));

const openai = new OpenAI({ apiKey: key });

(async () => {
  try {
    console.log('🔍 Testar API-anslutning...');
    const models = await openai.models.list();
    console.log('✅ API fungerar! Några modeller:');
    models.data.slice(0, 6).forEach(m => console.log(' -', m.id));
  } catch (err) {
    console.error('❌ Fel:', err.status || '', err.message);
  }
})();
