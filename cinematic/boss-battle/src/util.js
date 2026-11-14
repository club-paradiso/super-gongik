// Pure math helpers shared by the picture (browser) and the score (Node).
// Nothing here reads a clock or Math.random: every value is a function of its arguments.

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, k) => a + (b - a) * k;
export const sstep = (a, b, x) => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
// 0 before a, rises over `up`, holds, falls over `dn` ending at b
export const win = (t, a, b, up = 0.3, dn = 0.3) =>
  sstep(a, a + up, t) * (1 - sstep(b - dn, b, t));
// fast attack, exponential decay impulse
export const pulse = (t, t0, att, dec) => {
  const d = t - t0;
  if (d < 0) return 0;
  if (d < att) return d / att;
  return Math.exp(-(d - att) / dec);
};
export const easeInOut = (k) =>
  k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

// Seeded PRNG (mulberry32). Same seed -> same sequence on every machine.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// integer hash -> [0,1)
export const hash1 = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
};
export const hash2 = (x, y) => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return h - Math.floor(h);
};
export function vnoise2(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy),
    b = hash2(ix + 1, iy),
    c = hash2(ix, iy + 1),
    d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
export function fbm2(x, y, oct = 5) {
  let s = 0,
    a = 0.5,
    f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise2(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}
// smooth 1-D noise in time
export const tnoise = (t, hz, seed = 0) => {
  const x = t * hz + seed * 17.13,
    i = Math.floor(x),
    f = x - i;
  return (
    lerp(
      hash1(i + seed * 101),
      hash1(i + 1 + seed * 101),
      f * f * (3 - 2 * f),
    ) *
      2 -
    1
  );
};

// Monotone cubic (Fritsch-Carlson) through keys: no overshoot, no stop-and-go between marks.
export function mono(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = [],
    m = new Array(n);
  for (let i = 0; i < n - 1; i++)
    d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++)
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i]);
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const i = lo,
      h = xs[i + 1] - xs[i],
      k = (x - xs[i]) / h,
      k2 = k * k,
      k3 = k2 * k;
    return (
      (2 * k3 - 3 * k2 + 1) * ys[i] +
      (k3 - 2 * k2 + k) * h * m[i] +
      (-2 * k3 + 3 * k2) * ys[i + 1] +
      (k3 - k2) * h * m[i + 1]
    );
  };
}
// rows: [[t, a, b, c...], ...] -> f(t) returning [a, b, c...]
export function track(rows) {
  const xs = rows.map((r) => r[0]);
  const cols = [];
  for (let c = 1; c < rows[0].length; c++)
    cols.push(
      mono(
        xs,
        rows.map((r) => r[c]),
      ),
    );
  return (t) => cols.map((f) => f(t));
}
// piecewise linear with smoothstep per segment (holds are exact)
export function keyed(rows) {
  return (t) => {
    if (t <= rows[0][0]) return rows[0][1];
    for (let i = 0; i < rows.length - 1; i++) {
      const [t0, v0] = rows[i],
        [t1, v1] = rows[i + 1];
      if (t <= t1) return lerp(v0, v1, sstep(t0, t1, t));
    }
    return rows[rows.length - 1][1];
  };
}
