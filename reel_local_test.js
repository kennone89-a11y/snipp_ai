// reel_local_test.js
// Enkel lokal ffmpeg-test: slår ihop 2–3 klipp till en reel-test.mp4

import ffmpeg from 'fluent-ffmpeg';
ffmpeg.setFfmpegPath('C:\\Users\\kenno\\Downloads\\ffmpeg-8.0.1-essentials_build\\ffmpeg-8.0.1-essentials_build\\bin\\ffmpeg.exe');
ffmpeg.setFfprobePath('C:\\Users\\kenno\\Downloads\\ffmpeg-8.0.1-essentials_build\\ffmpeg-8.0.1-essentials_build\\bin\\ffprobe.exe');
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Här anger du vilka klipp som ska ingå (i ordning)
const inputDir = path.join(__dirname, 'test_clips');
const clips = [
  path.join(inputDir, 'clip1.MOV.MOV'),
  path.join(inputDir, 'clip2.MOV.MOV'),
];
 

// 2) Utfil (skapas automatiskt)
const outputDir = path.join(__dirname, 'test_output');
const outputFile = path.join(outputDir, 'reel-test.mp4');

// Se till att output-mapp finns
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Kolla att alla klipp finns
for (const file of clips) {
  if (!fs.existsSync(file)) {
    console.error('Hittar inte klipp:', file);
    process.exit(1);
  }
}

console.log('Bygger reel av klipp:');
clips.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
console.log('Utfil:', outputFile);

// 3) Bygg ffmpeg-kommando
const command = ffmpeg();

clips.forEach((file) => {
  command.input(file);
});

// Enkel concat (klipp efter varandra, samma upplösning/fps rekommenderas)
command
  .on('start', (cmd) => {
    console.log('ffmpeg startar:');
    console.log(cmd);
  })
  .on('progress', (p) => {
    if (p.percent) {
      process.stdout.write(`Progress: ${p.percent.toFixed(1)}%\r`);
    }
  })
  .on('error', (err) => {
    console.error('\nFel i ffmpeg:', err.message || err);
    process.exit(1);
  })
  .on('end', () => {
    console.log('\nKlar! Reel skapad:', outputFile);
    console.log('Öppna filen i en videospelare för att kolla resultatet.');
    process.exit(0);
  })
  .mergeToFile(outputFile, path.join(__dirname, 'tmp_ffmpeg'));
