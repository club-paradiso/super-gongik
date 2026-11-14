// Shared harness: static server for the workspace + headless Chromium (SwiftShader WebGL2).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };

export async function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

export async function openFilm(port, { w = 1280, h = 536, msaa = 4 } = {}) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?w=${w}&h=${h}&msaa=${msaa}`);
  const t0 = Date.now();
  while (!(await page.evaluate(() => !!window.__READY).catch(() => false))) {
    if (logs.some((l) => l.startsWith('PAGEERROR'))) throw new Error('page error:\n' + logs.join('\n'));
    if (Date.now() - t0 > 240000) throw new Error('ready timeout\n' + logs.join('\n'));
    await new Promise((r) => setTimeout(r, 200));
  }
  return { browser, page, logs };
}

export async function grab(page, n, opts) {
  return page.evaluate(([n, o]) => window.__renderFrame(n, o), [n, opts]);
}
export const dataToBuf = (d) => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');
