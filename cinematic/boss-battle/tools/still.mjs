// node tools/still.mjs out_dir t1 t2 ... (seconds)   -> PNG stills for quick look
import fs from 'node:fs';
import path from 'node:path';
import { serve, openFilm, grab, dataToBuf } from './lib.mjs';
const [out, ...ts] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const { server, port } = await serve();
const w = +(process.env.W || 960), h = +(process.env.H || 402);
const { browser, page, logs } = await openFilm(port, { w, h, msaa: +(process.env.MSAA ?? 4) });
for (const s of ts) {
  const n = Math.round(+s * 30);
  const a = Date.now();
  const r = await grab(page, n, { jpeg: true, quality: 0.9, stats: true });
  fs.writeFileSync(path.join(out, `t${String(s).padStart(5, '0')}.jpg`), dataToBuf(r.data));
  console.log(s, r.shot, Date.now() - a + 'ms', JSON.stringify(r.stats));
}
const errs = logs.filter((l) => /error|warn/i.test(l));
if (errs.length) console.log(errs.slice(0, 20).join('\n'));
await browser.close();
server.close();
