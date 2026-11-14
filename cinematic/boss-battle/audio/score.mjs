// Original score + sound design, synthesised sample by sample (no samples, no libraries).
// Every cue is placed from the same beat sheet the picture uses (src/timeline.js).
// Usage: node audio/score.mjs out.wav
import fs from "node:fs";
import { T, DUR, STRIKES, windAt } from "../src/timeline.js";
import { rng, clamp, win, pulse } from "../src/util.js";

const SR = 48000;
const N = Math.ceil(SR * DUR);
const L = new Float32Array(N),
  R = new Float32Array(N);
// separate buses so the music can be ducked under impacts
const busM = [new Float32Array(N), new Float32Array(N)];
const busF = [new Float32Array(N), new Float32Array(N)];
const rnd = rng(9001);
const TAU = Math.PI * 2;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const NOTE = (s) => {
  const m = s.match(/^([A-G])(#|b)?(-?\d)$/);
  const base =
    { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] +
    (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 12 * (+m[3] + 1) + base;
};

// ---------------- primitives ----------------
function place(bus, t0, sig, gain = 1, pan = 0) {
  const i0 = Math.round(t0 * SR);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain,
    gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
  for (let i = 0; i < sig.length; i++) {
    const j = i0 + i;
    if (j < 0 || j >= N) continue;
    bus[0][j] += sig[i] * gl;
    bus[1][j] += sig[i] * gr;
  }
}
const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));
function noise(sec) {
  const b = buf(sec);
  for (let i = 0; i < b.length; i++) b[i] = rnd() * 2 - 1;
  return b;
}
// RBJ biquad, cutoff may be a function of time (seconds) - recomputed every 32 samples
function biquad(x, type, f, q = 0.707) {
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0,
    b0,
    b1,
    b2,
    a1,
    a2;
  const coef = (fc) => {
    const w = (TAU * clamp(fc, 10, SR * 0.45)) / SR,
      cs = Math.cos(w),
      al = Math.sin(w) / (2 * q);
    let B0, B1, B2;
    if (type === "lp") {
      B0 = (1 - cs) / 2;
      B1 = 1 - cs;
      B2 = (1 - cs) / 2;
    } else if (type === "hp") {
      B0 = (1 + cs) / 2;
      B1 = -(1 + cs);
      B2 = (1 + cs) / 2;
    } else {
      B0 = al;
      B1 = 0;
      B2 = -al;
    }
    const A0 = 1 + al;
    b0 = B0 / A0;
    b1 = B1 / A0;
    b2 = B2 / A0;
    a1 = (-2 * cs) / A0;
    a2 = (1 - al) / A0;
  };
  for (let i = 0; i < x.length; i++) {
    if (i % 32 === 0) coef(typeof f === "function" ? f(i / SR) : f);
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
const env = (x, fn) => {
  for (let i = 0; i < x.length; i++) x[i] *= fn(i / SR);
  return x;
};
const adsr = (a, d, s, r, len) => (t) =>
  t < a
    ? t / a
    : t < a + d
      ? 1 - (1 - s) * ((t - a) / d)
      : t < len
        ? s
        : s * Math.max(0, 1 - (t - len) / r);
function osc(sec, freq, shape = "saw", phase0 = 0) {
  const b = buf(sec);
  let ph = phase0;
  for (let i = 0; i < b.length; i++) {
    const f = typeof freq === "function" ? freq(i / SR) : freq;
    ph += f / SR;
    ph -= Math.floor(ph);
    b[i] =
      shape === "saw"
        ? 2 * ph - 1
        : shape === "sq"
          ? ph < 0.5
            ? 1
            : -1
          : shape === "tri"
            ? 1 - 4 * Math.abs(ph - 0.5)
            : Math.sin(ph * TAU);
  }
  return b;
}
const mixInto = (a, b, g = 1) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) a[i] += b[i] * g;
  return a;
};

// ---------------- instruments ----------------
function horn(midi, dur, vel = 1) {
  const f = mtof(midi),
    len = dur + 0.6;
  const x = osc(
    len,
    (t) => f * (1 + 0.004 * Math.sin(t * 5.5 * TAU) * Math.min(1, t / 0.4)),
    "saw",
  );
  mixInto(x, osc(len, f * 1.003, "saw"), 0.8);
  mixInto(x, osc(len, f * 0.5, "tri"), 0.4);
  const e = adsr(0.09, 0.2, 0.8, 0.45, dur);
  const y = biquad(x, "lp", (t) => 400 + 2200 * vel * e(t), 0.9);
  return env(y, (t) => e(t) * 0.22 * vel);
}
function strings(midis, dur, att = 0.8, cut = 1500, vel = 1) {
  const len = dur + 1.4;
  const x = buf(len);
  for (const m of midis)
    for (const d of [-0.006, 0, 0.007])
      mixInto(x, osc(len, mtof(m) * (1 + d), "saw", rnd()), 0.18);
  const e = adsr(att, 0.3, 0.9, 1.2, dur);
  return env(
    biquad(x, "lp", cut, 0.6),
    (t) => e(t) * vel * (1 + 0.04 * Math.sin(t * 6 * TAU)),
  );
}
function choir(midis, dur, att = 1.0, vel = 1, vowel = "a") {
  const len = dur + 1.8;
  const src = buf(len);
  for (const m of midis)
    for (const d of [-0.005, 0.004])
      mixInto(
        src,
        osc(
          len,
          (t) => mtof(m) * (1 + d) * (1 + 0.006 * Math.sin(t * 5 * TAU + m)),
          "saw",
          rnd(),
        ),
        0.2,
      );
  const F =
    vowel === "a"
      ? [
          [700, 6],
          [1150, 8],
          [2800, 12],
        ]
      : [
          [400, 6],
          [800, 8],
          [2600, 12],
        ];
  const y = buf(len);
  F.forEach(([fc, q], k) =>
    mixInto(y, biquad(src, "bp", fc, q), [1, 0.6, 0.25][k]),
  );
  const e = adsr(att, 0.5, 0.85, 1.6, dur);
  return env(y, (t) => e(t) * vel * 1.6);
}
function pluck(midi, dur, vel = 1) {
  const f = mtof(midi);
  const x = osc(dur + 0.3, f, "saw");
  mixInto(x, osc(dur + 0.3, f * 1.01, "sq"), 0.3);
  const y = biquad(x, "lp", (t) => 300 + 2600 * Math.exp(-t * 14), 1.2);
  return env(y, (t) => Math.exp(-t * 5) * 0.25 * vel * Math.min(1, t / 0.004));
}
function taiko(f0 = 62, vel = 1, dec = 0.45) {
  const len = 1.6;
  const x = osc(len, (t) => f0 * (1 + 1.6 * Math.exp(-t / 0.018)), "sine");
  env(x, (t) => Math.exp(-t / dec));
  const n = biquad(noise(0.2), "lp", 1600);
  mixInto(
    x,
    env(n, (t) => Math.exp(-t / 0.02)),
    0.6,
  );
  return env(x, () => vel * 0.9);
}
function snareTap(vel = 1) {
  const n = biquad(noise(0.25), "bp", 2200, 0.8);
  return env(n, (t) => Math.exp(-t / 0.05) * vel * 0.5);
}
function boom(vel = 1, f0 = 55, dec = 1.6) {
  const x = osc(
    dec * 4,
    (t) => f0 * (0.55 + 0.45 * Math.exp(-t / 0.25)),
    "sine",
  );
  env(x, (t) => Math.exp(-t / dec) * Math.min(1, t / 0.003));
  const n = biquad(noise(1.2), "lp", (t) => 3000 * Math.exp(-t * 4) + 120);
  mixInto(
    x,
    env(n, (t) => Math.exp(-t / 0.18)),
    0.7,
  );
  return env(x, () => vel);
}
function clang(f0 = 380, vel = 1, dec = 1.4) {
  const len = dec * 3;
  const x = buf(len);
  const ratios = [1, 2.76, 5.4, 8.93, 13.34, 18.64, 3.17, 6.6];
  ratios.forEach((r, k) =>
    mixInto(
      x,
      env(osc(len, f0 * r, "sine", rnd()), (t) =>
        Math.exp(-t / (dec / (1 + k * 0.6))),
      ),
      0.5 / (1 + k * 0.4),
    ),
  );
  mixInto(
    x,
    env(biquad(noise(0.3), "hp", 2500), (t) => Math.exp(-t / 0.03)),
    0.8,
  );
  return env(x, () => vel * 0.6);
}
function crumble(len = 1.5, vel = 1) {
  // many small grains: debris settling
  const x = buf(len + 0.3);
  const n = Math.round(60 * len);
  for (let k = 0; k < n; k++) {
    const t0 = Math.pow(rnd(), 1.6) * len,
      i0 = Math.round(t0 * SR);
    const g = biquad(noise(0.06), "bp", 300 + rnd() * 2500, 1.5);
    const a = (1 - t0 / len) * (0.3 + rnd());
    for (let i = 0; i < g.length && i0 + i < x.length; i++)
      x[i0 + i] += g[i] * Math.exp(-i / SR / 0.015) * a;
  }
  mixInto(
    x,
    env(biquad(noise(len), "lp", 180), (t) => Math.exp(-t / (len * 0.4))),
    0.8,
  );
  return env(x, () => vel * 0.6);
}
function roar(dur, f0 = 72, vel = 1, bright = 1) {
  const len = dur + 0.6;
  const e = (t) =>
    Math.min(1, t / 0.15) *
    (t < dur ? 1 - 0.25 * (t / dur) : Math.max(0, 1 - (t - dur) / 0.6));
  const pitch = (t) =>
    f0 *
    (1 + 0.25 * Math.sin(Math.min(1, t / dur) * Math.PI)) *
    (1 + 0.02 * Math.sin(t * 31 * TAU));
  const x = osc(len, pitch, "saw");
  mixInto(
    x,
    osc(len, (t) => pitch(t) * 1.51, "saw"),
    0.5,
  );
  env(x, (t) => 0.6 + 0.4 * Math.sin(t * 28 * TAU));
  const n = noise(len);
  const nf = buf(len);
  mixInto(
    nf,
    biquad(
      n,
      "bp",
      (t) => 500 + 600 * bright * Math.sin(Math.min(1, t / dur) * Math.PI),
      2,
    ),
    1.4,
  );
  mixInto(
    nf,
    biquad(
      n,
      "bp",
      (t) => 1400 + 900 * bright * Math.sin(Math.min(1, t / dur) * Math.PI),
      3,
    ),
    0.8,
  );
  const y = biquad(x, "lp", 900 + 900 * bright, 0.8);
  mixInto(y, nf, 0.9);
  mixInto(
    y,
    env(
      osc(len, (t) => pitch(t) * 0.5, "sine"),
      () => 1,
    ),
    0.6,
  );
  return env(y, (t) => e(t) * vel * 0.8);
}
function whoosh(len = 0.9, vel = 1, up = true) {
  const n = noise(len);
  const y = biquad(
    n,
    "bp",
    (t) => (up ? 300 + 3000 * (t / len) : 3300 - 3000 * (t / len)),
    1.2,
  );
  return env(y, (t) => Math.sin(Math.PI * clamp(t / len)) ** 2 * vel * 0.9);
}
function flap(vel = 1) {
  const n = biquad(noise(0.5), "lp", (t) => 900 * Math.exp(-t * 6) + 80);
  mixInto(
    n,
    env(
      osc(0.5, (t) => 70 * Math.exp(-t * 2), "sine"),
      (t) => Math.exp(-t / 0.12),
    ),
    0.8,
  );
  return env(n, (t) => Math.min(1, t / 0.06) * Math.exp(-t / 0.15) * vel);
}
function thunder(vel = 1) {
  const len = 6;
  const crack = env(biquad(noise(0.4), "hp", 1800), (t) => Math.exp(-t / 0.05));
  const rum = biquad(noise(len), "lp", (t) => 400 * Math.exp(-t / 1.5) + 60);
  const am = rng(Math.floor(vel * 1000));
  let a = 1;
  env(rum, (t) => {
    if (Math.floor(t * 20) !== Math.floor((t - 1 / SR) * 20))
      a = 0.4 + am() * 0.9;
    return a * Math.exp(-t / 1.8) * Math.min(1, t / 0.2);
  });
  const x = buf(len);
  mixInto(x, crack, 0.9);
  for (let i = 0; i < rum.length; i++) {
    const j = i + Math.round(0.25 * SR);
    if (j < x.length) x[j] += rum[i] * 2.2;
  }
  return env(x, () => vel);
}
function riser(len, vel = 1) {
  const n = noise(len);
  const y = biquad(n, "bp", (t) => 200 + 5000 * Math.pow(t / len, 2), 2);
  mixInto(
    y,
    env(
      osc(len, (t) => 80 + 300 * Math.pow(t / len, 2), "saw"),
      () => 0.15,
    ),
    1,
  );
  return env(y, (t) => Math.pow(t / len, 2) * vel);
}
function chime(midi, vel = 1) {
  const f = mtof(midi);
  const x = buf(2.5);
  [1, 2.0, 3.01, 4.2].forEach((r, k) =>
    mixInto(
      x,
      env(osc(2.5, f * r, "sine"), (t) => Math.exp(-t / (1.2 / (1 + k)))),
      [1, 0.4, 0.2, 0.1][k],
    ),
  );
  return env(x, (t) => vel * 0.25 * Math.min(1, t / 0.002));
}

// ---------------- the score ----------------
const M = busM,
  FX = busF;
const motif = (t0, root, vel, scale = 1, major = false) => {
  const iv = major ? [0, 4, 7, 5, 4, 2, 0] : [0, 3, 7, 5, 3, 2, 0];
  const du = [0.5, 0.5, 1.0, 0.5, 0.5, 0.5, 1.6].map((d) => d * scale);
  let t = t0;
  iv.forEach((s, i) => {
    place(M, t, horn(root + s, du[i] * 0.95, vel), 1, -0.15);
    t += du[i];
  });
};
const D3 = NOTE("D3"),
  D4 = NOTE("D4"),
  A2 = NOTE("A2");
const chord = (root, q) =>
  q === "m" ? [root, root + 3, root + 7] : [root, root + 4, root + 7];

// 0-9 dawn: low pad, sea, gentle motif
place(M, 0.0, strings([D3 - 12, D3 - 5, D3 + 3], 9.5, 3.0, 700, 0.55));
motif(4.8, D4 - 12, 0.5, 1.15);
place(M, 8.0, strings([D3 - 12, D3 - 2, D3 + 2], 3, 1.5, 600, 0.4)); // Bb colour
// 9-16 storm: tension cluster, timpani-ish rolls
place(M, 9.0, strings([D3 - 12, D3 - 11, D3 - 5], 7.5, 1.5, 500, 0.6));
for (let t = 12.0; t < 16; t += 0.125)
  place(
    M,
    t,
    taiko(48, 0.12 + 0.25 * ((t - 12) / 4), 0.25),
    1,
    (rnd() - 0.5) * 0.4,
  );
place(FX, 13.6, riser(2.4, 0.5));
// 16-22 the dragon theme: low strings + choir
const dragonTheme = (t0, vel, rootMidi = A2) => {
  [
    [0, 1.5],
    [1, 1.5],
    [0, 1.5],
    [-5, 1.5],
  ].reduce((t, [s, d]) => {
    place(M, t, strings([rootMidi + s, rootMidi + s + 12], d, 0.15, 900, vel));
    return t + d;
  }, t0);
};
dragonTheme(16.0, 0.9);
place(M, 16.0, choir(chord(NOTE("Bb3"), "M"), 3.0, 0.6, 0.6));
place(M, 19.0, choir(chord(NOTE("A3"), "M"), 3.0, 0.4, 0.7));
place(M, 16.0, taiko(55, 0.9, 0.8));
place(M, 19.0, taiko(55, 0.8, 0.8));
// 22 landing, 23.6 roar
place(
  M,
  23.6,
  strings([D3 - 12, D3 - 11, D3 - 6, D3 + 1], 3.0, 0.1, 1200, 0.7),
);
place(M, 26.4, strings([D3 - 12, D3 - 11], 4.6, 1.5, 450, 0.5));
// 28.5 eye: heartbeat
for (let t = 28.6; t < 31; t += 0.78) {
  place(M, t, taiko(44, 0.5, 0.2));
  place(M, t + 0.22, taiko(44, 0.3, 0.2));
}
// 31 DRAW: the agent's theme, full
motif(31.05, D4, 1.0, 0.9);
motif(31.05, D4 - 12, 0.6, 0.9);
place(M, 31.0, taiko(60, 1, 0.6));
place(M, 31.0, strings(chord(D3, "m"), 2.4, 0.2, 2000, 0.6));
// 33.5-44 the fight: ostinato + drums at 120 bpm (0.5 s beats)
const progression = [
  [D3, "m"],
  [NOTE("Bb2"), "M"],
  [NOTE("C3"), "M"],
  [NOTE("A2"), "M"],
];
const ost = [0, 0, 3, 0, 7, 0, 5, 3];
const fightBar = (t0, bars, vel = 1, drums = true) => {
  for (let b = 0; b < bars; b++) {
    const [root, q] = progression[b % 4];
    const tb = t0 + b * 2;
    for (let i = 0; i < 8; i++)
      place(
        M,
        tb + i * 0.25,
        pluck(
          root + 12 + ost[i] - (q === "M" && ost[i] === 3 ? -1 : 0),
          0.22,
          vel * 0.8,
        ),
        1,
        i % 2 ? 0.3 : -0.3,
      );
    place(M, tb, strings(chord(root, q), 1.9, 0.08, 1400, 0.35 * vel));
    if (drums) {
      for (let i = 0; i < 4; i++)
        place(
          M,
          tb + i * 0.5,
          taiko(i % 2 ? 72 : 52, (i % 2 ? 0.55 : 0.9) * vel, 0.35),
        );
      for (let i = 0; i < 8; i++)
        if (i % 4 === 3 || rnd() < 0.2)
          place(M, tb + i * 0.25 + 0.125, snareTap(0.35 * vel), 1, 0.2);
    }
  }
};
fightBar(33.5, 5, 0.95);
fightBar(43.5 - 2, 1, 0.8);
// 44 inhale: drums out, riser
place(FX, 43.6, riser(1.45, 0.9));
place(M, 44.0, choir([NOTE("D4"), NOTE("Eb4"), NOTE("A4")], 1.1, 0.8, 0.5));
// 45-50.5 breath: heavy half-time + choir
for (let t = 45.0; t < 50.5; t += 1.0) place(M, t, taiko(48, 1.0, 0.5));
for (let t = 45.5; t < 50.5; t += 1.0) place(M, t, taiko(80, 0.5, 0.25));
place(
  M,
  45.0,
  choir([NOTE("D4"), NOTE("F4"), NOTE("A4"), NOTE("C5")], 5.2, 0.3, 0.7),
);
dragonTheme(45.0, 0.75, NOTE("D2"));
// 52.4 takeoff -> 53.5 flyby soaring
place(M, 52.4, taiko(50, 1, 0.9));
place(
  M,
  53.5,
  strings([NOTE("D4"), NOTE("F4"), NOTE("A4")], 2.0, 0.3, 3000, 0.4),
);
place(
  M,
  55.5,
  strings([NOTE("Bb3"), NOTE("D4"), NOTE("F4")], 2.0, 0.3, 3000, 0.4),
);
motif(53.6, D4 + 12, 0.6, 0.6);
motif(53.6, D4, 0.6, 0.6);
fightBar(53.5, 2, 0.7, true);
// 58-64 run and dive
fightBar(58.0, 3, 1.0);
dragonTheme(61.0, 0.7, NOTE("D2"));
// 64-66.5 columns: accelerating taps into the leap
for (let k = 0, t = 64.0; t < 66.45; k++) {
  place(M, t, snareTap(0.3 + 0.5 * ((t - 64) / 2.5)), 1, k % 2 ? 0.3 : -0.3);
  t += Math.max(0.06, 0.25 - 0.08 * (t - 64));
}
place(FX, 64.0, riser(2.5, 0.8));
place(M, 64.0, strings([D3, D3 + 7, D3 + 12], 2.5, 0.3, 2000, 0.6));
// 66.5-68.7 the leap in slow motion: one held high chord and a heartbeat
place(M, 66.5, choir([NOTE("A4"), NOTE("D5"), NOTE("F5")], 2.1, 0.4, 0.8));
place(M, 66.5, strings([NOTE("D2"), NOTE("A2")], 2.1, 0.2, 400, 0.6));
for (let t = 66.6; t < 68.7; t += 0.9) {
  place(M, t, taiko(40, 0.6, 0.25));
  place(M, t + 0.25, taiko(40, 0.35, 0.25));
}
// 69 SLAM
place(
  M,
  T.SLAM,
  choir(
    [NOTE("D3"), NOTE("A3"), NOTE("D4"), NOTE("F#4"), NOTE("A4")],
    1.4,
    0.01,
    1.0,
  ),
);
place(
  M,
  T.SLAM,
  strings(
    [NOTE("D2"), NOTE("D3"), NOTE("F#3"), NOTE("A3")],
    2.5,
    0.01,
    2400,
    0.8,
  ),
);
// 73-77 settle: resolution in D major
place(M, 73.0, strings(chord(D3, "M"), 4.0, 2.0, 900, 0.5));
// 77 bow: the theme, gentle, in major
motif(77.4, D4, 0.55, 1.15, true);
place(M, 77.0, strings([D3 - 12, D3 + 4, D3 + 9], 4.0, 1.5, 900, 0.4));
// 81 depart: everything, major
place(
  M,
  81.0,
  strings(
    [NOTE("D3"), NOTE("A3"), NOTE("D4"), NOTE("F#4")],
    4.2,
    0.8,
    2600,
    0.7,
  ),
);
place(M, 81.0, choir([NOTE("D4"), NOTE("F#4"), NOTE("A4")], 4.0, 1.2, 0.7));
dragonTheme(81.0, 0.5, NOTE("D3"));
motif(81.6, D4 + 12, 0.7, 0.75, true);
place(M, 81.2, taiko(50, 0.9, 0.9));
// 85-90 end: last chord, the shift-end chime
place(
  M,
  85.0,
  strings([NOTE("D3"), NOTE("A3"), NOTE("F#4")], 4.0, 1.0, 1200, 0.45),
);
place(M, 85.6, horn(NOTE("D4"), 3.0, 0.4), 1, -0.2);
place(M, T.TITLE2 + 0.1, chime(NOTE("E6"), 0.8), 1, 0.3);
place(M, T.TITLE2 + 0.55, chime(NOTE("C6"), 0.8), 1, 0.3);

// ---------------- foley ----------------
// wind and sea beds (continuous)
{
  const wind = noise(DUR),
    wind2 = noise(DUR);
  const wl = biquad(wind, "bp", (t) => 300 + 900 * windAt(t), 0.7),
    wr = biquad(wind2, "bp", (t) => 320 + 950 * windAt(t), 0.7);
  for (let i = 0; i < N; i++) {
    const t = i / SR,
      a =
        0.12 *
        (0.3 + windAt(t)) *
        (1 - 0.6 * win(t, T.SLAM - 0.4, T.SLAM + 0.05, 0.3, 0.01));
    FX[0][i] += wl[i] * a;
    FX[1][i] += wr[i] * a;
  }
  const sea = biquad(noise(DUR), "lp", 500);
  for (let i = 0; i < N; i++) {
    const t = i / SR,
      a = 0.25 * (0.6 + 0.4 * Math.sin(t * 0.7)) * (t < 9 ? 1 : 0.35);
    FX[0][i] += sea[i] * a;
    FX[1][i] += sea[(i + 4000) % N] * a;
  }
}
// footsteps (walk 4.4-8.4, run 33.5-36.9, run 57.7-64, climb)
const step = (t, v) =>
  place(
    FX,
    t,
    env(biquad(noise(0.08), "bp", 900, 1), (x) => Math.exp(-x / 0.018) * v),
    1,
    (rnd() - 0.5) * 0.3,
  );
for (let t = 4.5; t < 8.4; t += 0.53) step(t, 0.35);
for (let t = 33.6; t < 36.9; t += 0.32) step(t, 0.5);
for (let t = 57.8; t < 64.0; t += 0.32) step(t, 0.45);
for (let t = 64.0; t < 66.45; t += 0.3) step(t, 0.6);
// thunder
STRIKES.forEach((s, k) =>
  place(FX, s, thunder(0.8 + 0.2 * (k % 2)), 1, k % 2 ? 0.4 : -0.4),
);
// dragon voice
place(FX, 16.3, roar(1.3, 140, 0.6, 1.6), 1, -0.3);
place(FX, T.ROAR, roar(T.ROAR_END - T.ROAR, 68, 1.2, 1.0));
place(FX, 29.4, roar(1.2, 50, 0.35, 0.3));
place(FX, 41.9, roar(0.6, 90, 0.7, 1.2), 1, -0.2);
place(FX, 69.1, roar(1.5, 160, 0.9, 2.0), 1, 0.2);
place(FX, 82.2, roar(1.4, 110, 0.6, 1.4), 1, -0.3);
// wing beats: downstrokes at the dragon's flap rate (1.05 Hz) while flying
const flapWins = [
  [19.5, 22.3, 0.5],
  [52.4, 56.0, 1.0],
  [61.6, 63.0, 0.6],
  [69.1, 76.4, 0.6],
  [81.2, 90, 0.7],
];
for (const [a, b, v] of flapWins)
  for (let t = Math.ceil(a * 1.05) / 1.05; t < b; t += 1 / 1.05)
    place(FX, t + 0.1, flap(v), 1, (rnd() - 0.5) * 0.5);
// impacts
place(FX, T.LAND, boom(1.0, 48, 1.4));
place(FX, T.LAND + 0.08, crumble(1.4, 0.7));
place(FX, T.TAIL - 0.35, whoosh(0.7, 0.9));
place(FX, T.TAIL + 0.28, boom(0.8, 70, 0.6));
place(FX, T.TAIL + 0.3, crumble(2.6, 1.0), 1, -0.4);
place(
  FX,
  T.SLIDE,
  env(
    biquad(noise(0.7), "bp", 600, 0.8),
    (t) => Math.sin(Math.PI * clamp(t / 0.7)) * 0.5,
  ),
);
place(FX, T.CLAW - 0.4, whoosh(0.45, 0.7, false));
place(FX, T.CLAW, clang(420, 1.0, 1.6));
place(FX, T.CLAW, boom(0.5, 80, 0.4));
place(FX, T.KNOCK, clang(300, 0.7, 1.0));
place(FX, T.KNOCK, boom(0.6, 60, 0.6));
place(
  FX,
  T.KNOCK + 0.05,
  env(biquad(noise(1.0), "bp", 500, 0.7), (t) => Math.exp(-t / 0.4) * 0.6),
  1,
  0.2,
);
// breath: roaring hiss + crackle + the ward's hum
{
  const len = T.BREATH_END - T.BREATH + 0.4;
  const hiss = biquad(noise(len), "hp", 1200);
  const body = biquad(noise(len), "bp", 420, 0.6);
  const x = buf(len);
  mixInto(x, hiss, 0.5);
  mixInto(x, body, 1.1);
  for (let k = 0; k < 220; k++) {
    const i0 = Math.round(rnd() * (len - 0.05) * SR);
    for (let i = 0; i < 300; i++)
      x[i0 + i] += (rnd() * 2 - 1) * Math.exp(-i / 60) * 0.8;
  }
  env(
    x,
    (t) =>
      Math.min(1, t / 0.15) *
      Math.max(0, Math.min(1, (len - t) / 0.4)) *
      (0.8 + 0.2 * Math.sin(t * 9 * TAU)),
  );
  place(FX, T.BREATH, x, 0.9);
  const hum = osc(6.4, 110, "sine");
  mixInto(hum, osc(6.4, 165.5, "sine"), 0.6);
  mixInto(hum, osc(6.4, 330, "tri"), 0.15);
  env(
    hum,
    (t) =>
      Math.min(1, t / 0.4) *
      Math.min(1, (6.4 - t) / 0.5) *
      0.3 *
      (0.8 + 0.2 * Math.sin(t * 7 * TAU)),
  );
  place(FX, 44.5, hum, 1, -0.2);
}
place(FX, T.LAMP_HIT, clang(900, 0.6, 0.8), 1, -0.5);
place(FX, T.LAMP_HIT + 0.85, clang(600, 0.5, 0.6), 1, -0.5);
place(FX, T.PILLAR_HIT, boom(0.6, 75, 0.5), 1, 0.5);
place(FX, T.PILLAR_HIT + 0.05, crumble(2.2, 0.9), 1, 0.5);
place(FX, T.TAKEOFF + 0.2, boom(0.7, 45, 1.0));
place(FX, T.TAKEOFF + 0.2, whoosh(1.4, 0.8));
place(FX, 55.2, whoosh(1.6, 0.6));
place(FX, 62.6, whoosh(1.8, 0.8));
place(FX, 66.45, whoosh(0.8, 0.6));
// THE SLAM
place(FX, T.SLAM, boom(1.6, 42, 2.4));
place(FX, T.SLAM, clang(260, 1.4, 2.6));
place(FX, T.SLAM, clang(520, 0.7, 1.8), 1, 0.4);
place(FX, T.SLAM + 0.3, crumble(3.5, 1.3), 1, -0.3);
place(FX, T.SLAM + 0.12, whoosh(2.2, 1.0, false));
{
  const ring = env(
    osc(3.5, 3150, "sine"),
    (t) => 0.05 * Math.exp(-t / 1.2) * Math.min(1, t / 0.05),
  );
  place(FX, T.SLAM + 0.2, ring);
}
place(FX, 70.55, boom(0.7, 70, 0.4));
place(FX, T.RELAND, boom(0.6, 50, 0.9));
place(FX, T.RELAND + 0.05, crumble(1.0, 0.5));

// ---------------- mix ----------------
// duck the music under the big hits and the pre-slam silence
const duck = (t) =>
  1 -
  0.45 * pulse(t, T.LAND, 0.02, 0.6) -
  0.4 * pulse(t, T.CLAW, 0.02, 0.4) -
  0.9 * win(t, 68.75, 69.0, 0.15, 0.01) -
  0.3 * pulse(t, T.SLAM + 0.3, 0.05, 1.0);
for (let i = 0; i < N; i++) {
  const t = i / SR,
    d = Math.max(0, duck(t));
  L[i] = busM[0][i] * 0.8 * d + busF[0][i];
  R[i] = busM[1][i] * 0.8 * d + busF[1][i];
}
// Schroeder reverb (4 combs + 2 allpasses per side, different delays left/right)
function reverb(x, delays, seed) {
  const out = new Float32Array(x.length);
  for (const [d, g] of delays.combs) {
    const line = new Float32Array(d);
    let p = 0,
      lp = 0;
    for (let i = 0; i < x.length; i++) {
      const y = line[p];
      lp = y * 0.7 + lp * 0.3;
      line[p] = x[i] + lp * g;
      out[i] += y;
      p = (p + 1) % d;
    }
  }
  let y = out;
  for (const [d, g] of delays.aps) {
    const line = new Float32Array(d);
    const o = new Float32Array(x.length);
    let p = 0;
    for (let i = 0; i < y.length; i++) {
      const b = line[p];
      const v = y[i] + b * g;
      o[i] = b - v * g;
      line[p] = v;
      p = (p + 1) % d;
    }
    y = o;
  }
  return y;
}
const rvL = reverb(L, {
  combs: [
    [1557, 0.84],
    [1617, 0.84],
    [1491, 0.84],
    [1422, 0.84],
  ],
  aps: [
    [225, 0.5],
    [556, 0.5],
  ],
});
const rvR = reverb(R, {
  combs: [
    [1580, 0.84],
    [1640, 0.84],
    [1514, 0.84],
    [1445, 0.84],
  ],
  aps: [
    [248, 0.5],
    [579, 0.5],
  ],
});
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = clamp(t / 1.0) * clamp((DUR - t) / 1.4);
  L[i] = Math.tanh((L[i] + rvL[i] * 0.09) * 0.9) * fade;
  R[i] = Math.tanh((R[i] + rvR[i] * 0.09) * 0.9) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = 0.89 / (peak || 1);
// 16-bit PCM WAV
const out = process.argv[2] || "score.wav";
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(clamp(L[i] * norm, -1, 1) * 32767), i * 4);
  data.writeInt16LE(Math.round(clamp(R[i] * norm, -1, 1) * 32767), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write("RIFF", 0);
h.writeUInt32LE(36 + data.length, 4);
h.write("WAVE", 8);
h.write("fmt ", 12);
h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20);
h.writeUInt16LE(2, 22);
h.writeUInt32LE(SR, 24);
h.writeUInt32LE(SR * 4, 28);
h.writeUInt16LE(4, 32);
h.writeUInt16LE(16, 34);
h.write("data", 36);
h.writeUInt32LE(data.length, 40);
fs.writeFileSync(out, Buffer.concat([h, data]));
console.log(
  "wrote",
  out,
  (N / SR).toFixed(2) + "s",
  "peak before norm",
  peak.toFixed(3),
);
