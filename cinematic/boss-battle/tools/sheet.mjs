// node tools/sheet.mjs out.jpg [step_seconds] -> contact sheet across the film (low res, for review)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { serve, openFilm, grab, dataToBuf } from './lib.mjs';
const out = process.argv[2];
const list = (process.argv[3] || '').split(',').filter(Boolean).map(Number);
const ts = list.length ? list : Array.from({ length: 30 }, (_, i) => 1.5 + i * 3);
const dir = out + '.d';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const { server, port } = await serve();
const w = +(process.env.W || 480), h = Math.round(w / 2.39);
const { browser, page, logs } = await openFilm(port, { w, h, msaa: 0 });
let i = 0;
for (const s of ts) {
  const r = await grab(page, Math.round(s * 30), { jpeg: true, quality: 0.85 });
  fs.writeFileSync(path.join(dir, `${String(i++).padStart(3, '0')}.jpg`), dataToBuf(r.data));
  process.stdout.write(`${s}:${r.shot} `);
}
await browser.close();
server.close();
const cols = +(process.env.COLS || 4);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', '1', '-i', path.join(dir, '%03d.jpg'), '-vf', `drawtext=text='%{frame_num}':start_number=0:x=4:y=4:fontsize=12:fontcolor=white,tile=${cols}x${Math.ceil(ts.length / cols)}:padding=2`, '-frames:v', '1', out]);
console.log('\n' + out, logs.filter((l) => /error/i.test(l)).slice(0, 5).join('\n'));
