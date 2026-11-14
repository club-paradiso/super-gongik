// Automated checks for the film.
//   node tools/qa.mjs            run all checks against qa/baselines
//   node tools/qa.mjs --update   (re)write the baselines from the current render
// Checks: timeline invariants, page errors, determinism (repeat + out-of-order renders must be
// byte-identical), per-frame sanity (not black, not blown out, not flat), SSIM visual regression vs
// baselines, and the score (length, peak, loudness, impact alignment).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { serve, openFilm, grab, dataToBuf, ROOT } from './lib.mjs';
import { T, SHOTS, DUR, FPS, FRAMES } from '../src/timeline.js';

const UPDATE = process.argv.includes('--update');
const QW = 640, QH = 268;
const BASE = path.join(ROOT, 'qa/baselines'), CUR = path.join(ROOT, 'qa/current');
fs.mkdirSync(BASE, { recursive: true });
fs.rmSync(CUR, { recursive: true, force: true });
fs.mkdirSync(CUR, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// ---- 1. timeline invariants
{
  const ts = SHOTS.map((s) => s[0]);
  check('shots start at 0 and are strictly increasing', ts[0] === 0 && ts.every((t, i) => i === 0 || t > ts[i - 1]));
  check('every shot lasts >= 1.0 s', ts.every((t, i) => (i < ts.length - 1 ? ts[i + 1] : DUR) - t >= 1.0));
  check('film is exactly 90 s at 30 fps', DUR === 90 && FPS === 30 && FRAMES === 2700);
  const beats = Object.values(T);
  check('all beats inside the film', beats.every((t) => t >= 0 && t < DUR));
}

// ---- 2. frames: one per shot (midpoint) + key beats
const frames = [];
SHOTS.forEach(([t0], i) => {
  const t1 = i < SHOTS.length - 1 ? SHOTS[i + 1][0] : DUR;
  frames.push({ name: `shot${String(i).padStart(2, '0')}-${SHOTS[i][1]}`, n: Math.round(((t0 + t1) / 2) * FPS) });
});
for (const [k, dt] of [['LAND', 0.3], ['TAIL', 0.35], ['CLAW', 0.1], ['BREATH', 2.0], ['LAMP_HIT', 0.2], ['LEAP', 1.0], ['SLAM', 0.6], ['DEPART', 2.0]])
  frames.push({ name: `beat-${k}`, n: Math.round((T[k] + dt) * FPS) });

const { server, port } = await serve();
const { browser, page, logs } = await openFilm(port, { w: QW, h: QH, msaa: 4 });
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
const png = async (n) => dataToBuf((await grab(page, n, { png: true })).data);

// ---- 3. determinism: the same frame rendered first, after a jump across the film, and again
{
  const probe = Math.round((T.BREATH + 1.5) * FPS);
  const a = sha(await png(probe));
  await png(Math.round(80 * FPS));
  await png(10);
  const b = sha(await png(probe));
  await png(probe + 1);
  const c = sha(await png(probe));
  check('determinism: repeat + out-of-order renders are byte-identical', a === b && b === c, `frame ${probe}`);
}

// ---- 4. sanity + regression
let worst = 1;
for (const f of frames) {
  const r = await grab(page, f.n, { png: true, stats: true });
  const file = path.join(CUR, f.name + '.png');
  fs.writeFileSync(file, dataToBuf(r.data));
  const s = r.stats;
  const ok = s.mean > 10 && s.mean < 235 && s.std > 6 && s.clip < 0.35;
  check(`sanity ${f.name} (t=${(f.n / FPS).toFixed(2)})`, ok, `mean ${s.mean.toFixed(0)} std ${s.std.toFixed(0)} clip ${(s.clip * 100).toFixed(1)}%`);
  const bfile = path.join(BASE, f.name + '.jpg');
  if (UPDATE || !fs.existsSync(bfile)) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-q:v', '2', bfile]);
    continue;
  }
  const o = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-i', bfile, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /All:([0-9.]+)/.exec(o.stderr);
  const ssim = m ? +m[1] : 0;
  worst = Math.min(worst, ssim);
  check(`regression ${f.name}`, ssim >= 0.97, `SSIM ${ssim.toFixed(4)}`);
}
const pageErrors = logs.filter((l) => /PAGEERROR|error/i.test(l));
check('no page errors or WebGL errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
await browser.close();
server.close();

// contact sheet of this run
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-pattern_type', 'glob', '-i', path.join(CUR, '*.png'), '-vf', `scale=320:-1,tile=5x${Math.ceil(frames.length / 5)}:padding=2`, '-frames:v', '1', path.join(CUR, 'sheet.jpg')]);

// ---- 5. the score
{
  const wav = path.join(ROOT, 'out/qa-score.wav');
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  execFileSync('node', [path.join(ROOT, 'audio/score.mjs'), wav]);
  const b = fs.readFileSync(wav);
  const n = (b.length - 44) / 4;
  check('score length is 90 s', Math.abs(n / 48000 - DUR) < 0.01, (n / 48000).toFixed(3) + ' s');
  const rms = (t0, t1) => {
    let s = 0, c = 0;
    for (let i = Math.round(t0 * 48000); i < Math.round(t1 * 48000); i++) {
      const v = b.readInt16LE(44 + i * 4) / 32768;
      s += v * v;
      c++;
    }
    return Math.sqrt(s / c);
  };
  const pre = rms(T.SLAM - 0.2, T.SLAM - 0.02), hit = rms(T.SLAM, T.SLAM + 0.15);
  check('score: the slam lands on its frame (post/pre energy)', hit > 3 * pre, `ratio ${(hit / pre).toFixed(1)}`);
  const land = rms(T.LAND, T.LAND + 0.1) / rms(T.LAND - 0.3, T.LAND - 0.05);
  check('score: the landing hit lands on its frame', land > 1.5, `ratio ${land.toFixed(1)}`);
  const o = spawnSync('ffmpeg', ['-hide_banner', '-i', wav, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const I = +(/I:\s+(-?[0-9.]+) LUFS/.exec(o.stderr.slice(o.stderr.lastIndexOf('Summary'))) || [0, 0])[1];
  const P = +(/Peak:\s+(-?[0-9.]+) dBFS/.exec(o.stderr.slice(o.stderr.lastIndexOf('Summary'))) || [0, 0])[1];
  check('score loudness in [-20, -10] LUFS, true peak < 0 dBFS', I > -20 && I < -10 && P < 0, `I ${I} LUFS, peak ${P} dBFS`);
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(ROOT, 'qa/report.json'), JSON.stringify({ date: new Date().toISOString(), size: [QW, QH], worstSSIM: worst, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed${UPDATE ? ' (baselines updated)' : ''}`);
process.exit(failed.length ? 1 : 0);
