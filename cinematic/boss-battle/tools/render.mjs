// Deterministic offline render -> MP4.
//   node tools/render.mjs [--w 1920] [--h 804] [--workers 3] [--msaa 4] [--from 0] [--to 2699] [--out out/film.mp4] [--crf 16]
// Each worker is its own headless Chromium rendering a contiguous frame range and piping JPEG frames
// straight into its own FFmpeg (libx264) segment. Segments are concatenated without re-encoding, the
// synthesised score is muxed, and the picture is letterboxed into 16:9.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { serve, openFilm, grab, dataToBuf, ROOT } from "./lib.mjs";
import { FRAMES, FPS } from "../src/timeline.js";

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const W = +arg("w", 1920),
  H = +arg("h", 804),
  WORKERS = +arg("workers", 3),
  MSAA = +arg("msaa", 4);
const FROM = +arg("from", 0),
  TO = +arg("to", FRAMES - 1),
  CRF = arg("crf", "16");
const OUT = path.resolve(
  arg("out", path.join(ROOT, "out/super-gongik-boss-cinematic.mp4")),
);
const OH = Math.round((W * 9) / 16 / 2) * 2; // 16:9 canvas height
const work = path.join(
  path.dirname(OUT),
  path.basename(OUT, ".mp4") + ".parts",
);
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const { server, port } = await serve();
const total = TO - FROM + 1;
const per = Math.ceil(total / WORKERS);
const t0 = Date.now();
let done = 0;
const hashes = new Array(total);
const shots = new Array(total);

async function worker(k) {
  const a = FROM + k * per,
    b = Math.min(TO, a + per - 1);
  if (a > b) return null;
  const seg = path.join(work, `seg${k}.mp4`);
  const ff = spawn(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      String(FPS),
      "-c:v",
      "mjpeg",
      "-i",
      "-",
      "-vf",
      `pad=${W}:${OH}:0:(oh-ih)/2:black,format=yuv420p`,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      CRF,
      "-r",
      String(FPS),
      seg,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const { browser, page, logs } = await openFilm(port, {
    w: W,
    h: H,
    msaa: MSAA,
  });
  for (let n = a; n <= b; n++) {
    const r = await grab(page, n, { jpeg: true, quality: 0.95 });
    const jpg = dataToBuf(r.data);
    hashes[n - FROM] = crypto
      .createHash("sha1")
      .update(jpg)
      .digest("hex")
      .slice(0, 12);
    shots[n - FROM] = r.shot;
    if (!ff.stdin.write(jpg))
      await new Promise((res) => ff.stdin.once("drain", res));
    done++;
    if (done % 50 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(
        `${done}/${total} frames  ${(el / done).toFixed(2)} s/frame  eta ${(((total - done) * el) / done / 60).toFixed(1)} min`,
      );
    }
  }
  ff.stdin.end();
  await new Promise((res, rej) =>
    ff.on("close", (c) =>
      c === 0 ? res() : rej(new Error("ffmpeg exit " + c)),
    ),
  );
  await browser.close();
  return { k, a, b, seg, errors: logs.filter((l) => /error/i.test(l)) };
}

const results = (
  await Promise.all(Array.from({ length: WORKERS }, (_, k) => worker(k)))
).filter(Boolean);
server.close();
const list = path.join(work, "list.txt");
fs.writeFileSync(list, results.map((r) => `file '${r.seg}'`).join("\n"));
const silent = path.join(work, "video.mp4");
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-y",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  list,
  "-c",
  "copy",
  silent,
]);
const wav = path.join(path.dirname(OUT), "score.wav");
execFileSync("node", [path.join(ROOT, "audio/score.mjs"), wav], {
  stdio: "inherit",
});
const startS = FROM / FPS,
  durS = total / FPS;
execFileSync("ffmpeg", [
  "-loglevel",
  "error",
  "-y",
  "-i",
  silent,
  "-ss",
  String(startS),
  "-t",
  String(durS),
  "-i",
  wav,
  "-map",
  "0:v",
  "-map",
  "1:a",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "256k",
  "-movflags",
  "+faststart",
  "-shortest",
  OUT,
]);
const report = {
  out: OUT,
  width: W,
  height: OH,
  picture: [W, H],
  fps: FPS,
  frames: total,
  from: FROM,
  to: TO,
  msaa: MSAA,
  workers: WORKERS,
  seconds: (Date.now() - t0) / 1000,
  secPerFrame: (Date.now() - t0) / 1000 / total,
  errors: results.flatMap((r) => r.errors),
  frameHashes: hashes,
  shots,
};
fs.writeFileSync(OUT.replace(/\.mp4$/, ".render.json"), JSON.stringify(report));
fs.rmSync(work, { recursive: true, force: true });
console.log(
  "wrote",
  OUT,
  `${report.seconds.toFixed(0)} s total, ${report.secPerFrame.toFixed(2)} s/frame, errors: ${report.errors.length}`,
);
