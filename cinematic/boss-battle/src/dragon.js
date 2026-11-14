// The white dragon. Original procedural model and motion.
//
// Motion is two spine generators blended by wPath(t), both pure functions of film time:
//   path mode   the head runs along a keyed flight path; the body is the last LEN metres of that path
//               (precomputed arclength table), with a travelling swim wave and banking.
//   local mode  a root transform (position, yaw, pitch, roll) carries a body shape blended from a small
//               pose library (stand, roar, breath, strike, reel, bow ...).
// On top: head aim, jaw, wings (spread/flap/sweep with per-span lag and membrane billow), legs by
// two-bone IK planting on the terrain, throat glow, pupil, seal mark.
import * as THREE from 'three';
import { T } from './timeline.js';
import { track, keyed, mono, sstep, clamp, lerp, win, pulse, TAU, tnoise, rng } from './util.js';
import { extend } from './shaderkit.js';
import { groundH } from './world.js';

export const LEN = 34;
const NS = 96; // spine samples / body rings
const RAD = 22; // radial segments

// ----- radius profile along the body (u: 0 neck start .. 1 tail tip)
const rProf = mono([0, 0.08, 0.18, 0.27, 0.36, 0.48, 0.62, 0.8, 0.94, 1], [0.62, 0.66, 0.95, 1.5, 1.42, 1.15, 0.8, 0.45, 0.2, 0.05]);

// ----- head flight path (path mode). [t, x, y, z]
const HP = track([
  [4, -150, 112, -360],
  [10, -100, 98, -290],
  [14, -62, 84, -232],
  [16, -45, 70, -190],
  [17.5, -16, 54, -150],
  [19.0, 22, 40, -108],
  [20.0, 33, 27, -72],
  [21.0, 12, 12, -38],
  [21.6, 3, 8, -28],
  [22.0, 0, 6.5, -24],
  [22.6, 0, 6.5, -23.6],
  // ground phase (only the history right before takeoff matters)
  [52.4, 0, 7, -23.5],
  [53.0, 0, 12.5, -23],
  [53.7, 0, 22, -14],
  [54.6, 1, 32, 0],
  [55.6, 12, 40, 22],
  [56.8, 40, 42, 30],
  [58.0, 64, 40, 8],
  [59.2, 68, 40, -30],
  [60.4, 45, 42, -70],
  [61.6, 10, 46, -95],
  [62.8, -18, 44, -88],
  [64.0, -20, 36, -62],
  [65.2, -12, 27, -42],
  [66.6, -4, 19, -27],
  [67.8, -1, 15.5, -19.5],
  [69.0, 0, 12.8, -14.4],
  [69.5, 0, 14, -20],
  // depart
  [81.0, 0, 6, -21],
  [82.0, 0, 10, -24],
  [83.0, -6, 20, -45],
  [84.5, -25, 38, -85],
  [86.5, -60, 60, -150],
  [90, -130, 95, -280],
]);
const wPath = keyed([[0, 1], [21.3, 1], [22.3, 0], [52.9, 0], [53.6, 1], [69.0, 1], [69.25, 0], [81.5, 0], [82.3, 1]]);

// ----- local mode root [t, x, y, z, pitch, roll]
const ROOT = track([
  [20.0, 0, 9, -33, -0.25, 0],
  [21.0, 0, 4, -31, -0.15, 0],
  [22.0, 0, 0, -29, 0, 0],
  [35.8, 0, 0, -28.5, 0, 0],
  [36.4, 0, 0.3, -27.5, 0, 0],
  [38.6, 0, 0, -26.5, 0, 0],
  [39.4, -1, 0, -21.0, -0.05, 0],
  [40.2, -1.4, 0, -17.8, 0.04, 0],
  [41.4, -1, 0, -21.5, 0, 0],
  [42.2, -0.6, 0, -23.0, 0.06, 0],
  [43.4, 0, 0, -23.5, 0, 0],
  [44.5, 0, 0, -24.5, -0.04, 0],
  [50.5, 0, 0, -24.5, 0, 0],
  [52.0, 0, -0.5, -25, 0.05, 0],
  [52.8, 0, 4, -26, -0.35, 0],
  [53.6, 0, 11, -25, -0.6, 0],
  [69.0, 0, 11.6, -22.6, 0.05, 0],
  [69.1, 0, 12.2, -23.6, -0.15, 0.1],
  [70.0, 0, 18, -40, -0.5, -0.4],
  [71.5, 0, 22, -58, -0.3, 0.3],
  [73.0, 2, 20, -66, -0.1, -0.1],
  [74.0, 1, 16, -58, 0.15, 0],
  [75.4, 0, 7, -38, 0.1, 0],
  [76.5, 0, 0, -29, 0, 0],
  [80.8, 0, 0, -28, 0, 0],
  [81.4, 0, 3, -27, -0.4, 0],
  [82.2, 0, 9, -26, -0.6, 0],
]);
const YAW = keyed([[0, 0], [36.0, 0], [36.6, 1.6], [36.88, 2.6], [37.2, 3.14], [37.6, 3.9], [38.6, TAU]]);

// ----- pose library, local body control points from neck-start to tail tip (x side, y up, z forward)
const P = (...a) => a.map((v) => new THREE.Vector3(...v));
const POSES = {
  land: P([0, 6.5, 5], [0, 5.2, 3], [0, 3.6, 1], [0, 3.0, -2], [0, 2.9, -5.5], [0, 2.6, -9], [0, 1.6, -13], [0, 1.0, -18], [1, 0.8, -23], [3, 0.6, -27]),
  stand: P([0, 7.2, 5.2], [0, 5.6, 3.2], [0, 3.8, 1.2], [0, 3.1, -1.8], [0, 3.0, -5], [0, 2.7, -8.5], [1.5, 1.2, -12], [5, 0.7, -14.5], [9, 0.6, -13], [11, 0.5, -9]),
  roarPrep: P([0, 6.5, 3.0], [0, 5.6, 2.0], [0, 4.0, 0.8], [0, 3.3, -1.8], [0, 3.0, -5], [0, 2.7, -8.5], [1.5, 1.2, -12], [5, 0.7, -14.5], [9, 0.6, -13], [11, 0.5, -9]),
  roar: P([0, 10.5, 4.4], [0, 8.2, 3.4], [0, 5.2, 1.6], [0, 3.6, -1.5], [0, 3.1, -5], [0, 2.7, -8.5], [-1.5, 1.2, -12], [-5, 0.7, -14.5], [-9, 0.6, -13], [-11, 0.5, -9]),
  lowLook: P([0, 5.0, 6.6], [0, 4.6, 4.0], [0, 3.6, 1.4], [0, 3.0, -1.8], [0, 2.9, -5], [0, 2.7, -8.5], [1.5, 1.2, -12], [5, 0.7, -14.5], [9, 0.6, -13], [11, 0.5, -9]),
  tailSwing: P([0, 5.5, 4.5], [0, 4.6, 3.0], [0, 3.5, 1.0], [0, 2.9, -2], [0, 2.8, -5.5], [0, 2.4, -9], [0, 1.8, -13], [0, 1.6, -17.5], [0, 1.5, -22], [0, 1.4, -26]),
  rearClaw: P([0, 8.2, 3.8], [0, 6.6, 2.6], [0, 4.8, 1.0], [0, 3.8, -1.8], [0, 3.1, -5], [0, 2.6, -8.5], [1.5, 1.2, -12], [5, 0.7, -14.5], [9, 0.6, -13], [11, 0.5, -9]),
  strike: P([0, 3.4, 9.6], [0, 3.6, 6.8], [0, 3.6, 3.8], [0, 3.1, 0.2], [0, 2.9, -3.5], [0, 2.6, -7], [1.5, 1.2, -11], [5, 0.7, -13.5], [9, 0.6, -12], [11, 0.5, -8]),
  inhale: P([0, 7.4, 2.4], [0, 6.2, 1.6], [0, 4.6, 0.4], [0, 3.6, -2.2], [0, 3.1, -5.5], [0, 2.7, -9], [1.5, 1.2, -12.5], [5, 0.7, -15], [9, 0.6, -13.5], [11, 0.5, -9.5]),
  breath: P([0, 4.4, 8.4], [0, 4.4, 5.6], [0, 3.9, 2.6], [0, 3.2, -0.8], [0, 2.9, -4.3], [0, 2.6, -8], [1.5, 1.2, -11.5], [5, 0.7, -14], [9, 0.6, -12.5], [11, 0.5, -8.5]),
  crouch: P([0, 5.0, 4.6], [0, 4.0, 3.0], [0, 2.9, 1.0], [0, 2.3, -1.8], [0, 2.2, -5], [0, 2.1, -8.5], [0, 1.4, -12.5], [0, 1.0, -17], [0, 0.8, -21.5], [0, 0.6, -26]),
  takeoff: P([0, 6.6, 5.8], [0, 5.0, 4.0], [0, 3.0, 1.6], [0, 1.8, -1.6], [0, 0.6, -4.8], [0, -0.8, -8], [0, -2.8, -11.5], [0, -5.0, -15], [0, -7.5, -18.5], [0, -10, -22]),
  reel: P([0, 3.6, 7.0], [0, 4.6, 4.6], [0, 4.0, 1.8], [0, 2.4, -1.2], [0, 1.0, -4.4], [0, -0.5, -7.4], [-1.5, -2.6, -10.4], [-3.5, -5.0, -13.0], [-4.5, -7.5, -15.5], [-4, -10.5, -17]),
  hover: P([0, 3.4, 6.4], [0, 3.0, 4.0], [0, 2.0, 1.4], [0, 1.0, -1.8], [0, 0.0, -5.0], [0, -1.2, -8], [0, -3.0, -11], [1.5, -5.4, -13.8], [3, -8, -16], [4, -10.6, -17.4]),
  bow: P([0, 2.3, 10.0], [0, 3.0, 7.2], [0, 3.3, 4.0], [0, 3.0, 0.4], [0, 2.8, -3.2], [0, 2.6, -6.8], [-1.5, 1.2, -10.5], [-5, 0.7, -13], [-9, 0.6, -11.5], [-11, 0.5, -7.5]),
};
const POSE_TL = [
  [0, 'stand', 0.1],
  [21.2, 'land', 0.8],
  [22.6, 'stand', 1.0],
  [23.3, 'roarPrep', 0.4],
  [23.75, 'roar', 0.35],
  [26.4, 'stand', 1.0],
  [28.8, 'lowLook', 1.2],
  [31.6, 'stand', 1.0],
  [35.7, 'tailSwing', 0.5],
  [38.3, 'stand', 0.7],
  [39.4, 'rearClaw', 0.5],
  [40.6, 'stand', 0.8],
  [41.8, 'strike', 0.4],
  [42.6, 'stand', 0.8],
  [44.0, 'inhale', 0.8],
  [45.0, 'breath', 0.25],
  [50.5, 'stand', 1.2],
  [52.0, 'crouch', 0.4],
  [52.5, 'takeoff', 0.4],
  [69.05, 'reel', 0.3],
  [72.5, 'hover', 1.5],
  [75.8, 'land', 0.8],
  [77.0, 'bow', 1.8],
  [81.0, 'takeoff', 0.8],
];
const poseOf = (t, out) => {
  let i = 0;
  while (i < POSE_TL.length - 1 && t >= POSE_TL[i + 1][0]) i++;
  const [t0, name, bl] = POSE_TL[i];
  const prev = POSE_TL[Math.max(0, i - 1)][1];
  const k = i === 0 ? 1 : sstep(t0, t0 + bl, t);
  const A = POSES[prev], B = POSES[name];
  for (let j = 0; j < B.length; j++) out[j].lerpVectors(A[j], B[j], k);
  return out;
};

// ----- acting curves
const jawAt = (t) =>
  0.08 + 0.5 * win(t, 16.3, 17.6, 0.15, 0.5) + 0.25 * win(t, 23.1, 23.7, 0.2, 0.1) + 0.95 * win(t, 23.7, 26.4, 0.12, 0.6) + 0.15 * win(t, 29.4, 30.6, 0.3, 0.4) +
  0.55 * win(t, 41.9, 42.5, 0.08, 0.2) + 0.85 * win(t, 44.85, 50.6, 0.15, 0.3) + 0.9 * win(t, 69.08, 70.6, 0.06, 0.7) + 0.5 * win(t, 82.2, 83.6, 0.3, 0.5) + 0.1 * Math.abs(tnoise(t, 6, 3)) * win(t, 23.7, 26.4);
const headPitch = keyed([[0, 0], [23.6, 0], [23.9, -0.5], [26.2, -0.45], [26.8, 0], [44.0, 0], [44.6, -0.35], [45.0, 0.1], [69.05, 0], [69.2, -0.8], [70.6, -0.3], [72, 0], [77, 0], [78, 0.25], [80.5, 0.25], [81.2, -0.2], [83, 0]]);
const aimW = keyed([[0, 0], [22.4, 0], [23.0, 0.8], [23.6, 0.2], [26.4, 0.2], [27.0, 0.9], [36.0, 0.9], [36.3, 0], [38.4, 0], [38.9, 0.9], [44.0, 0.9], [44.6, 0.5], [45.0, 0.95], [50.5, 0.95], [51.5, 0.6], [52.5, 0], [76.5, 0], [77.5, 0.8], [81, 0.8], [81.5, 0]]);
const spreadAt = keyed([[0, 1], [21.4, 1], [22.4, 0.5], [23.4, 0.55], [23.9, 1.05], [26.4, 1.0], [27.4, 0.38], [35.8, 0.4], [36.2, 0.7], [38.6, 0.4], [44.0, 0.45], [50.5, 0.5], [51.8, 0.9], [52.4, 1], [61.6, 1], [63.4, 0.5], [68.4, 0.55], [69.2, 1], [76.0, 1], [77.2, 0.25], [80.6, 0.3], [81.2, 1]]);
const flapAmp = keyed([[0, 0.22], [20.4, 0.3], [21.1, 1.0], [22.3, 0.2], [23.4, 0.05], [52.0, 0.1], [52.4, 1.0], [54.6, 0.9], [55.6, 0.3], [60.6, 0.3], [61.6, 0.75], [62.8, 0.15], [68.8, 0.15], [69.1, 1.0], [73.0, 0.85], [76.4, 0.6], [77.2, 0.02], [80.8, 0.05], [81.2, 1.1], [85, 0.7]]);
const flapBase = keyed([[0, 0.05], [22.3, 0.05], [23.6, 0.05], [24.0, 0.55], [26.3, 0.5], [27.0, 0.1], [62.8, 0.1], [63.5, -0.05], [68.6, 0.0], [69.1, 0.2]]);
const sweepAt = keyed([[0, 0.1], [61.6, 0.1], [63.2, 0.65], [68.6, 0.6], [69.2, 0.1]]);
const plantW = keyed([[0, 0], [21.7, 0], [22.0, 1], [52.2, 1], [52.8, 0], [76.1, 0], [76.5, 1], [81.2, 1], [81.7, 0]]);
const clawW = keyed([[0, 0], [39.3, 0], [39.8, 1], [40.9, 1], [41.5, 0]]);
const CLAW = track([[39.3, -3.2, 2.0, -17], [39.9, -3.4, 4.6, -16.2], [40.4, -2.9, 1.95, -14.6], [40.9, -3.0, 1.6, -14.8], [41.5, -2.5, 0.6, -16.5]]);
export const throatAt = (t) => win(t, T.INHALE + 0.2, T.BREATH_END + 0.1, 0.8, 0.4);
const pupilAt = keyed([[0, 0.28], [29.2, 0.32], [29.9, 0.07], [31.5, 0.1], [69.1, 0.1], [69.3, 0.45], [72, 0.3], [77, 0.25], [79, 0.4]]);
export const sealMarkAt = (t) => (t < T.SLAM ? 0 : 1);
export const sealGlowAt = (t) => (t < T.SLAM ? 0 : 3 * pulse(t, T.SLAM, 0.02, 1.2) + 0.9 * (1 - sstep(T.BOW + 3, T.DEPART + 3, t)) + 0.25);

// ----- materials
function skinMaterial(kind) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0 });
  const isBody = kind === 'body';
  return extend(m, {
    uniforms: { uThroat: { value: 0 }, uSunV: { value: new THREE.Vector3() } },
    varyings: 'varying vec2 vUv2;',
    vertex: isBody ? 'vUv2 = uv;' : 'vUv2 = vec2(0.);',
    fragHead: /* glsl */ `
      vec2 cell3(vec3 p){ vec3 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
        for (int z=-1; z<=1; z++) for (int y=-1; y<=1; y++) for (int x=-1; x<=1; x++){
          vec3 o = vec3(x,y,z); vec3 r = o + vec3(h13(i+o), h13(i+o+17.1), h13(i+o+31.7)) - f; float d = dot(r,r);
          if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        return vec2(sqrt(d1), sqrt(d2)); }
    `,
    color: isBody
      ? /* glsl */ `
      float v = vUv2.y, u = vUv2.x;
      float ru = 0.26;
      vec2 g = vec2(u / ru, v * 46.);
      float row = floor(g.y);
      g.x += mod(row, 2.) * 0.5;
      vec2 f = fract(g) - 0.5;
      float d = length(vec2(f.x * 1.25 + 0.18, f.y));
      float sc = clamp(1. - d * 1.9, 0., 1.);
      float belly = smoothstep(0.16, 0.07, abs(v - 0.75));
      float plate = smoothstep(0.0, 0.08, fract(u / 0.5)) * smoothstep(1.0, 0.86, fract(u / 0.5));
      float top = smoothstep(0.22, 0.0, abs(v - 0.25));
      vec3 ivory = vec3(0.86, 0.80, 0.70);
      vec3 violet = vec3(0.42, 0.36, 0.62);
      vec3 cream = vec3(0.93, 0.83, 0.66);
      vec3 c = mix(violet, ivory, smoothstep(0.0, 0.3, sc));
      c = mix(c, ivory * 0.92 + violet * 0.08, top * 0.45);
      c = mix(c, cream * (0.75 + 0.25 * plate), belly);
      float lowside = smoothstep(0.45, 0.62, v) * (1. - belly);
      c = mix(c, c * vec3(0.72, 0.68, 0.95), lowside * 0.5);
      diffuseColor.rgb = c * (0.92 + 0.12 * h12(floor(g)));
      hgt = mix(sc, plate, belly);
      `
      : /* glsl */ `
      float n1 = vn3(vL * 9.0), n2 = vn3(vL * 24.0 + 3.1);
      float sc = 0.55 + 0.45 * (clamp(1.0 - abs(n1 * 2. - 1.) * 1.6, 0., 1.) * 0.6 + n2 * 0.4);
      vec3 ivory = vec3(0.86, 0.80, 0.70);
      vec3 violet = vec3(0.45, 0.38, 0.64);
      diffuseColor.rgb = mix(violet, ivory, smoothstep(0.0, 0.3, sc)) * diffuseColor.rgb;
      hgt = sc;
      `,
    rough: `roughnessFactor = mix(0.85, 0.38, hgt);`,
    bump: isBody ? 0.08 : 0.012,
    emissive: isBody
      ? /* glsl */ `
      float thr = smoothstep(0.3, 0.0, vUv2.x / 34.) * smoothstep(0.2, 0.05, abs(vUv2.y - 0.75));
      totalEmissiveRadiance += vec3(0.35, 0.85, 1.6) * uThroat * thr * (0.7 + 0.6 * hgt) * 3.0;
      // warm transmitted rim from the low sun through thin edges
      float rim = pow(1. - abs(dot(normal, normalize(vViewPosition))), 3.);
      totalEmissiveRadiance += vec3(0.9, 0.42, 0.25) * rim * 0.35 * max(dot(normalize(vViewPosition), -uSunV) , 0.);
      `
      : /* glsl */ `
      float rim = pow(1. - abs(dot(normal, normalize(vViewPosition))), 3.);
      totalEmissiveRadiance += vec3(0.9, 0.42, 0.25) * rim * 0.3 * max(dot(normalize(vViewPosition), -uSunV), 0.);
      `,
  });
}

// tapered tube along a curve, radius r(k), optional vertex colour gradient
function taperTube(pts, r0, r1, seg = 20, rad = 8, c0, c1) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const frames = curve.computeFrenetFrames(seg, false);
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const k = i / seg, p = curve.getPointAt(k), r = lerp(r0, r1, Math.pow(k, 0.9));
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * TAU;
      pos.push(p.x + r * (Math.cos(a) * N.x + Math.sin(a) * B.x), p.y + r * (Math.cos(a) * N.y + Math.sin(a) * B.y), p.z + r * (Math.cos(a) * N.z + Math.sin(a) * B.z));
      if (c0) {
        const c = c0.clone().lerp(c1, Math.pow(k, 1.5));
        col.push(c.r, c.g, c.b);
      }
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j, b = a + rad + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (c0) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// box mapped into a tapered rounded wedge along +z
function wedge(len, w0, w1, h0, h1, round = 0.8) {
  const g = new THREE.BoxGeometry(1, 1, 1, 6, 6, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 2, y = p.getY(i) * 2;
    const z = (p.getZ(i) + 0.5) * len;
    const k = z / len;
    // superellipse rounding
    const m = Math.max(Math.abs(x), Math.abs(y));
    if (m > 0) {
      const l = Math.hypot(x, y);
      const s = lerp(1, m / l, round);
      x *= s;
      y *= s;
    }
    p.setXYZ(i, (x * lerp(w0, w1, k)) / 2, (y * lerp(h0, h1, k)) / 2, z);
  }
  g.computeVertexNormals();
  return g;
}

function sealTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = 16;
  g.strokeRect(24, 24, 208, 208);
  g.lineWidth = 6;
  g.strokeRect(44, 44, 168, 168);
  // a geometric seal script: interlocking strokes (not a real character)
  g.lineWidth = 14;
  g.lineCap = 'square';
  const L = (a, b, c2, d) => {
    g.beginPath();
    g.moveTo(a, b);
    g.lineTo(c2, d);
    g.stroke();
  };
  L(72, 72, 184, 72);
  L(128, 72, 128, 184);
  L(72, 128, 184, 128);
  L(72, 184, 184, 184);
  L(72, 72, 72, 128);
  L(184, 128, 184, 184);
  L(100, 100, 100, 156);
  L(156, 100, 156, 156);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
export const SEAL_TEX = () => sealTexture();

export function buildDragon(scene) {
  const D = { st: {} };
  const bodyMat = skinMaterial('body');
  const partMat = skinMaterial('part');
  D.mats = [bodyMat, partMat];

  // ---------- body tube ----------
  const nv = NS * (RAD + 1);
  const bodyGeo = new THREE.BufferGeometry();
  const bPos = new Float32Array(nv * 3), bNor = new Float32Array(nv * 3), bUv = new Float32Array(nv * 2);
  const bIdx = [];
  for (let i = 0; i < NS - 1; i++)
    for (let j = 0; j < RAD; j++) {
      const a = i * (RAD + 1) + j, b = a + RAD + 1;
      bIdx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  for (let i = 0; i < NS; i++) for (let j = 0; j <= RAD; j++) {
    bUv[(i * (RAD + 1) + j) * 2] = (i / (NS - 1)) * LEN;
    bUv[(i * (RAD + 1) + j) * 2 + 1] = j / RAD;
  }
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  bodyGeo.setAttribute('normal', new THREE.BufferAttribute(bNor, 3));
  bodyGeo.setAttribute('uv', new THREE.BufferAttribute(bUv, 2));
  bodyGeo.setIndex(bIdx);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = body.receiveShadow = true;
  body.frustumCulled = false;
  scene.add(body);

  // ---------- head ----------
  const head = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = head) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const skull = add(new THREE.SphereGeometry(1, 28, 18), partMat, 0, 0.42, 0.75);
  skull.scale.set(0.82, 0.72, 1.05);
  add(wedge(2.9, 1.3, 0.72, 0.95, 0.5), partMat, 0, 0.36, 1.1).rotation.x = 0.08;
  const brow = (s) => {
    const b = add(new THREE.SphereGeometry(1, 16, 10), partMat, 0.5 * s, 0.86, 1.32);
    b.scale.set(0.3, 0.19, 0.62);
    b.rotation.set(0.25, 0.25 * s, 0.3 * s);
  };
  brow(1);
  brow(-1);
  // sculpt: nose ridge, cheekbones, nostril flares, chin
  const blob = (x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0, parent = head) => {
    const m = add(new THREE.SphereGeometry(1, 18, 12), partMat, x, y, z, parent);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    return m;
  };
  blob(0, 0.72, 2.3, 0.26, 0.14, 1.35, 0.12);
  for (const s of [1, -1]) {
    blob(0.66 * s, 0.32, 1.05, 0.3, 0.34, 0.72, 0, 0.2 * s);
    blob(0.26 * s, 0.6, 3.72, 0.2, 0.14, 0.3, 0.1);
    blob(0.45 * s, 0.42, 2.6, 0.18, 0.2, 0.9, 0.05, 0.12 * s);
  }
  // nostrils
  const dark = new THREE.MeshStandardMaterial({ color: 0x120a14, roughness: 0.9 });
  for (const s of [1, -1]) add(new THREE.SphereGeometry(0.08, 8, 6), dark, 0.22 * s, 0.56, 3.85);
  // jaw
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.06, 0.65);
  head.add(jaw);
  const lj = add(wedge(3.05, 1.05, 0.55, 0.42, 0.24), partMat, 0, -0.2, 0.1, jaw);
  lj.rotation.x = -0.04;
  blob(0, -0.38, 1.6, 0.32, 0.16, 1.0, 0, 0, 0, jaw);
  // mouth interior (glows for the breath)
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x3a0f1e, roughness: 0.6, emissive: new THREE.Color(0.35, 0.85, 1.6), emissiveIntensity: 0 });
  add(wedge(2.8, 0.85, 0.45, 0.25, 0.12), mouthMat, 0, 0.0, 0.3, jaw);
  const palate = add(wedge(2.8, 0.95, 0.5, 0.18, 0.1), mouthMat, 0, 0.12, 0.95);
  palate.rotation.x = 0.06;
  // teeth
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xf0e8d8, roughness: 0.35 });
  const tooth = new THREE.ConeGeometry(0.055, 0.3, 6);
  for (const s of [1, -1])
    for (let i = 0; i < 9; i++) {
      const k = i / 8;
      const up = add(tooth, toothMat, s * lerp(0.56, 0.3, k), lerp(0.02, 0.18, k), 1.25 + k * 2.55);
      up.rotation.x = Math.PI;
      up.scale.setScalar(i === 1 ? 1.8 : 1);
      const lo = add(tooth, toothMat, s * lerp(0.46, 0.24, k), -0.02, 0.6 + k * 2.4, jaw);
      lo.scale.setScalar(i === 2 ? 1.7 : 0.9);
    }
  // horns
  const hornMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.1 });
  const hc0 = new THREE.Color(0.85, 0.78, 0.62), hc1 = new THREE.Color(0.12, 0.09, 0.22);
  for (const s of [1, -1]) {
    add(taperTube(P([0.42 * s, 0.95, 0.55], [0.75 * s, 1.35, -0.4], [1.05 * s, 1.55, -1.6], [1.2 * s, 1.3, -2.9], [1.15 * s, 1.55, -3.6]), 0.22, 0.015, 24, 10, hc0, hc1), hornMat);
    add(taperTube(P([0.62 * s, 0.55, 0.35], [1.0 * s, 0.5, -0.4], [1.35 * s, 0.35, -1.2]), 0.12, 0.01, 12, 8, hc0, hc1), hornMat);
    // cheek frills
    for (let i = 0; i < 4; i++) {
      const fr = add(new THREE.ConeGeometry(0.12, 0.9 - i * 0.12, 5), partMat, s * (0.72 + i * 0.05), 0.1 - i * 0.08, 0.2 - i * 0.28);
      fr.rotation.set(-1.9, 0, s * (1.1 + i * 0.15));
      fr.scale.set(1, 1, 0.35);
    }
  }
  // whiskers (eastern style), animated
  const whiskerMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.6 });
  const whiskers = [];
  for (const s of [1, -1]) {
    const g = taperTube(P([0, 0, 0], [0.4 * s, -0.1, -0.6], [0.9 * s, -0.5, -1.6], [1.2 * s, -1.0, -2.8], [1.5 * s, -1.2, -4.0]), 0.05, 0.006, 20, 5);
    const w = add(g, whiskerMat, 0.36 * s, 0.38, 3.45);
    whiskers.push(w);
  }
  // mane tufts on the skull
  const maneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6e8, roughness: 0.7, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const s = i % 2 ? 1 : -1;
    const m = add(new THREE.ConeGeometry(0.16, 1.6 + (i % 3) * 0.4, 4), maneMat, s * (0.15 + 0.08 * i), 1.0 - i * 0.03, 0.2 - i * 0.18);
    m.rotation.set(-2.2 + i * 0.05, 0, s * 0.35);
    m.scale.set(1, 1, 0.3);
  }
  // eyes
  const eyeU = { uPupil: { value: 0.28 }, uGlow: { value: 1 } };
  const eyeMat = new THREE.ShaderMaterial({
    uniforms: eyeU,
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = normalize(position); vN = normalMatrix * normal; vec4 mv = modelViewMatrix * vec4(position,1.); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uPupil, uGlow; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        float r = length(vP.xy);
        vec3 iris = mix(vec3(2.4, 1.1, 0.25), vec3(0.9, 0.25, 0.08), smoothstep(0.1, 0.75, r));
        iris *= 0.75 + 0.5 * fract(sin(atan(vP.y, vP.x) * 40.) * 43.7) * 0.4;
        float slit = smoothstep(uPupil * sqrt(max(0., 1. - vP.y*vP.y)) + 0.03, uPupil * sqrt(max(0.,1.-vP.y*vP.y)), abs(vP.x));
        vec3 c = mix(iris * uGlow, vec3(0.01), slit * step(0., vP.z));
        c = mix(vec3(0.05,0.02,0.03), c, smoothstep(-0.3, 0.2, vP.z));
        float spec = pow(max(dot(normalize(vN), normalize(vec3(0.3,0.6,1.))), 0.), 60.);
        c += spec * 1.5;
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  for (const s of [1, -1]) {
    const e = add(new THREE.SphereGeometry(0.19, 20, 14), eyeMat, 0.58 * s, 0.66, 1.62);
    e.rotation.set(0, s * 1.15, 0);
  }
  // the seal mark on the brow (appears at SLAM)
  const sealU = { uTex: { value: sealTexture() }, uGlow: { value: 0 }, uShow: { value: 0 } };
  const sealMark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.9),
    new THREE.ShaderMaterial({
      uniforms: sealU,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uGlow, uShow; varying vec2 vUv;
        void main(){ float m = texture2D(uTex, vUv).r; vec3 c = vec3(0.55, 0.02, 0.03) + vec3(3.0, 0.5, 0.25) * uGlow; gl_FragColor = vec4(c, m * uShow * 0.95); }`,
    }),
  );
  sealMark.position.set(0, 1.135, 1.28);
  sealMark.rotation.x = -Math.PI / 2 + 0.28;
  head.add(sealMark);
  scene.add(head);
  D.head = head;

  // ---------- capsule / cone instances for limbs, wing bones, spines ----------
  const capGeo = new THREE.CapsuleGeometry(1, 1, 6, 12);
  const limbs = new THREE.InstancedMesh(capGeo, partMat, 64);
  limbs.castShadow = true;
  limbs.frustumCulled = false;
  scene.add(limbs);
  const coneGeo = new THREE.ConeGeometry(1, 1, 6);
  coneGeo.translate(0, 0.5, 0);
  const clawMat = new THREE.MeshStandardMaterial({ color: 0x2a2236, roughness: 0.3, metalness: 0.2 });
  const claws = new THREE.InstancedMesh(coneGeo, clawMat, 40);
  claws.castShadow = true;
  claws.frustumCulled = false;
  scene.add(claws);
  const spineMat = new THREE.MeshStandardMaterial({ color: 0xd8cfe6, roughness: 0.45 });
  const NSP = 58;
  const spines = new THREE.InstancedMesh(coneGeo, spineMat, NSP);
  spines.castShadow = true;
  spines.frustumCulled = false;
  scene.add(spines);

  // ---------- wing membranes ----------
  const NA = 9, NB = 7, PAN = 4;
  const wingVerts = PAN * NA * NB;
  const memMat = extend(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, side: THREE.DoubleSide }), {
    uniforms: { uSunV: { value: new THREE.Vector3() } },
    varyings: 'varying vec2 vUv2;',
    vertex: 'vUv2 = uv;',
    color: /* glsl */ `
      float vein = smoothstep(0.035, 0.0, abs(fract(vUv2.x * 5.0 + vn2(vUv2 * 9.) * 0.6) - 0.5) - 0.44);
      float cell = vn2(vUv2 * vec2(14., 22.));
      vec3 c = mix(vec3(0.80, 0.74, 0.86), vec3(0.62, 0.55, 0.85), vUv2.y);
      c = mix(c, vec3(0.36, 0.28, 0.58), vein * 0.6);
      diffuseColor.rgb = c * (0.9 + 0.15 * cell);
      hgt = vein + cell * 0.3;
    `,
    bump: 0.03,
    emissive: /* glsl */ `
      vec3 vv = normalize(vViewPosition);
      float back = pow(max(dot(vv, -uSunV), 0.), 3.0);
      totalEmissiveRadiance += vec3(1.25, 0.48, 0.32) * back * (1.0 - 0.5 * hgt) * 0.9;
    `,
  });
  const wings = [1, -1].map((side) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wingVerts * 3), 3));
    const uv = new Float32Array(wingVerts * 2);
    const idx = [];
    for (let p = 0; p < PAN; p++)
      for (let a = 0; a < NA; a++)
        for (let b = 0; b < NB; b++) {
          const k = p * NA * NB + a * NB + b;
          uv[k * 2] = (p + b / (NB - 1)) / PAN;
          uv[k * 2 + 1] = a / (NA - 1);
          if (a < NA - 1 && b < NB - 1) {
            const i0 = k, i1 = k + 1, i2 = k + NB, i3 = k + NB + 1;
            idx.push(i0, i2, i1, i1, i2, i3);
          }
        }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, memMat);
    m.castShadow = true;
    m.frustumCulled = false;
    scene.add(m);
    return { side, mesh: m, geo: g };
  });
  D.mats.push(memMat);

  // ---------- path arclength table ----------
  const HZ = 60, T0 = 0, T1 = 92;
  const nTab = (T1 - T0) * HZ + 1;
  const tabP = new Float32Array(nTab * 3), tabA = new Float32Array(nTab);
  {
    let prev = null, acc = 0;
    for (let i = 0; i < nTab; i++) {
      const [x, y, z] = HP(T0 + i / HZ);
      tabP.set([x, y, z], i * 3);
      if (prev) acc += Math.hypot(x - prev[0], y - prev[1], z - prev[2]);
      tabA[i] = acc;
      prev = [x, y, z];
    }
  }
  const pathAtDist = (tNow, sigma, out) => {
    // find the point on the path that lies sigma metres (of path) behind the head at tNow
    const fi = clamp((tNow - T0) * HZ, 0, nTab - 1);
    const i0 = Math.floor(fi), fk = fi - i0;
    const aNow = lerp(tabA[i0], tabA[Math.min(nTab - 1, i0 + 1)], fk);
    const target = aNow - sigma;
    if (target <= 0) {
      out.set(tabP[0], tabP[1], tabP[2]);
      const dx = tabP[3] - tabP[0], dy = tabP[4] - tabP[1], dz = tabP[5] - tabP[2], l = Math.hypot(dx, dy, dz) || 1;
      return out.addScaledVector(new THREE.Vector3(dx / l, dy / l, dz / l), target);
    }
    let lo = 0, hi = i0 + 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tabA[mid] <= target) lo = mid; else hi = mid;
    }
    const a0 = tabA[lo], a1 = tabA[lo + 1], k = a1 > a0 ? (target - a0) / (a1 - a0) : 0;
    return out.set(lerp(tabP[lo * 3], tabP[lo * 3 + 3], k), lerp(tabP[lo * 3 + 1], tabP[lo * 3 + 4], k), lerp(tabP[lo * 3 + 2], tabP[lo * 3 + 5], k));
  };

  // ---------- scratch ----------
  const spine = Array.from({ length: NS }, () => new THREE.Vector3());
  const sLocal = Array.from({ length: NS }, () => new THREE.Vector3());
  const Tn = Array.from({ length: NS }, () => new THREE.Vector3());
  const Nn = Array.from({ length: NS }, () => new THREE.Vector3());
  const Bn = Array.from({ length: NS }, () => new THREE.Vector3());
  const ctrl = POSES.stand.map((v) => v.clone());
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), q1 = new THREE.Quaternion(), m4 = new THREE.Matrix4();
  const rootM = new THREE.Matrix4(), rootQ = new THREE.Quaternion(), rootE = new THREE.Euler();
  D.spine = spine;
  D.T = Tn;
  D.N = Nn;
  D.B = Bn;

  // resample a control polyline (Catmull-Rom) at fixed arclength steps
  const crv = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
  const resample = (out) => {
    const M = 160, ds = LEN / (NS - 1);
    let acc = 0, j = 1;
    const prev = crv.getPoint(0, v1.clone());
    out[0].copy(prev);
    const cur = new THREE.Vector3();
    for (let i = 1; i <= M && j < NS; i++) {
      crv.getPoint(i / M, cur);
      const seg = cur.distanceTo(prev);
      while (j < NS && acc + seg >= j * ds) {
        const k = (j * ds - acc) / seg;
        out[j].lerpVectors(prev, cur, k);
        j++;
      }
      acc += seg;
      prev.copy(cur);
    }
    // curve shorter than the body: carry on along the last direction
    const dir = v2.subVectors(out[j - 1], out[Math.max(0, j - 2)]).normalize();
    for (; j < NS; j++) out[j].copy(out[j - 1]).addScaledVector(dir, ds);
  };

  const computeFrames = (up0) => {
    for (let i = 0; i < NS; i++) {
      const a = spine[Math.max(0, i - 1)], b = spine[Math.min(NS - 1, i + 1)];
      Tn[i].subVectors(b, a).normalize();
    }
    // parallel transport from the head
    Nn[0].copy(up0).addScaledVector(Tn[0], -up0.dot(Tn[0])).normalize();
    for (let i = 1; i < NS; i++) {
      const axis = v1.crossVectors(Tn[i - 1], Tn[i]);
      const s = axis.length();
      Nn[i].copy(Nn[i - 1]);
      if (s > 1e-6) {
        q1.setFromAxisAngle(axis.divideScalar(s), Math.asin(clamp(s, -1, 1)));
        Nn[i].applyQuaternion(q1);
      }
      // gently pull toward world up so the body never ends upside-down on the ground
      v2.set(0, 1, 0).addScaledVector(Tn[i], -Tn[i].y);
      if (v2.lengthSq() > 0.01) Nn[i].lerp(v2.normalize(), 0.06).addScaledVector(Tn[i], -Nn[i].dot(Tn[i])).normalize();
    }
    for (let i = 0; i < NS; i++) Bn[i].crossVectors(Tn[i], Nn[i]).normalize();
  };

  D.update = (t, ctx) => {
    const wp = wPath(t);
    // ---- local spine
    poseOf(t, ctrl);
    // idle life: breathing and tail sway, neck sway
    const breathe = Math.sin(t * 1.3) * 0.12;
    for (let j = 0; j < ctrl.length; j++) {
      const k = j / (ctrl.length - 1);
      ctrl[j].x += Math.sin(t * 0.9 - j * 0.7) * 0.5 * k * k * (1 - wp);
      ctrl[j].y += breathe * (1 - k);
    }
    crv.points = ctrl;
    crv.updateArcLengths();
    resample(sLocal);
    const [rx, ry, rz, rp, rr] = ROOT(t);
    rootE.set(rp, YAW(t), rr, 'YXZ');
    rootQ.setFromEuler(rootE);
    rootM.compose(v1.set(rx, ry, rz), rootQ, v2.set(1, 1, 1));
    for (let i = 0; i < NS; i++) sLocal[i].applyMatrix4(rootM);
    // ---- path spine (+ swim wave)
    if (wp > 0) {
      const ds = LEN / (NS - 1);
      for (let i = 0; i < NS; i++) pathAtDist(t, i * ds, spine[i]);
      computeFrames(v3.set(0, 1, 0));
      const amp = 0.9 + 0.6 * win(t, 82, 90, 1, 1);
      for (let i = 1; i < NS; i++) {
        const u = i / (NS - 1);
        const w = Math.sin((i * ds) / 11 * TAU - t * 2.6) * amp * sstep(0.05, 0.35, u);
        spine[i].addScaledVector(Bn[i], w).addScaledVector(Nn[i], w * 0.35);
      }
      for (let i = 0; i < NS; i++) spine[i].lerpVectors(sLocal[i], spine[i], wp);
    } else for (let i = 0; i < NS; i++) spine[i].copy(sLocal[i]);
    // keep the belly above the ground in local mode
    for (let i = 0; i < NS; i++) {
      const gh = groundH(spine[i].x, spine[i].z) + rProf(i / (NS - 1)) * 0.75;
      if (spine[i].y < gh) spine[i].y = lerp(spine[i].y, gh, 1 - wp);
    }
    // up reference at the head: banked in flight
    let up = v3.set(0, 1, 0);
    if (wp > 0) {
      const a = new THREE.Vector3(...HP(t - 0.15)), b = new THREE.Vector3(...HP(t)), c = new THREE.Vector3(...HP(t + 0.15));
      const acc = c.add(a).addScaledVector(b, -2).divideScalar(0.0225);
      acc.y += 9.8;
      up = new THREE.Vector3(0, 1, 0).lerp(acc.normalize(), 0.55 * wp).normalize();
    } else up.set(0, 1, 0).applyQuaternion(rootQ);
    computeFrames(up);

    // ---- body mesh
    const vScale = 1 + 0.06 * throatAt(t) * Math.sin(t * 9);
    let o = 0;
    for (let i = 0; i < NS; i++) {
      const u = i / (NS - 1);
      let r = rProf(u);
      if (u > 0.2 && u < 0.4) r *= vScale + 0.03 * Math.sin(t * 1.3);
      for (let j = 0; j <= RAD; j++) {
        const a = (j / RAD) * TAU;
        const ca = Math.cos(a), sa = Math.sin(a);
        const flat = sa < 0 ? 0.82 : 1.0; // flatter belly
        const nx = ca * Bn[i].x + sa * Nn[i].x, ny = ca * Bn[i].y + sa * Nn[i].y, nz = ca * Bn[i].z + sa * Nn[i].z;
        bPos[o] = spine[i].x + r * (ca * 1.08 * Bn[i].x + sa * flat * Nn[i].x);
        bPos[o + 1] = spine[i].y + r * (ca * 1.08 * Bn[i].y + sa * flat * Nn[i].y);
        bPos[o + 2] = spine[i].z + r * (ca * 1.08 * Bn[i].z + sa * flat * Nn[i].z);
        bNor[o] = nx;
        bNor[o + 1] = ny;
        bNor[o + 2] = nz;
        o += 3;
      }
    }
    bodyGeo.attributes.position.needsUpdate = true;
    bodyGeo.attributes.normal.needsUpdate = true;
    bodyGeo.computeBoundingSphere();

    // ---- head
    const F = v1.subVectors(spine[0], spine[2]).normalize();
    const Up = v2.copy(Nn[0]);
    const X = new THREE.Vector3().crossVectors(Up, F).normalize();
    Up.crossVectors(F, X);
    m4.makeBasis(X, Up, F);
    head.quaternion.setFromRotationMatrix(m4);
    // aim toward the look target
    const aim = aimW(t) * (1 - wp);
    if (aim > 0 && ctx.lookAt) {
      const dir = v3.subVectors(ctx.lookAt, spine[0]).normalize();
      const qa = new THREE.Quaternion().setFromUnitVectors(F, dir);
      head.quaternion.premultiply(new THREE.Quaternion().slerp(qa, aim * 0.75));
    }
    head.quaternion.multiply(q1.setFromEuler(rootE.set(headPitch(t), 0, 0)));
    head.position.copy(spine[0]).addScaledVector(Nn[0], -0.25).addScaledVector(F, -0.25);
    jaw.rotation.x = jawAt(t) * 0.72;
    mouthMat.emissiveIntensity = 2.5 * win(t, 44.2, 50.7, 0.6, 0.3) + 0.3 * win(t, 23.7, 26.4);
    eyeU.uPupil.value = pupilAt(t);
    eyeU.uGlow.value = 1 + 1.5 * win(t, 23.6, 26.4, 0.2, 0.5) + win(t, 44.0, 50.5);
    whiskers.forEach((w, i) => w.rotation.set(Math.sin(t * 1.7 + i) * 0.12, Math.sin(t * 1.1 + i * 2) * 0.15 * (i ? 1 : -1), 0));
    sealU.uShow.value = sealMarkAt(t);
    sealU.uGlow.value = sealGlowAt(t);
    bodyMat.userData.u.uThroat.value = throatAt(t);
    head.updateMatrixWorld(true);
    D.st.mouth = new THREE.Vector3(0, 0.0, 3.6).applyMatrix4(head.matrixWorld);
    D.st.brow = new THREE.Vector3(0, 1.15, 1.3).applyMatrix4(head.matrixWorld);
    D.st.eyeR = new THREE.Vector3(-0.62, 0.66, 1.62).applyMatrix4(head.matrixWorld);
    D.st.headFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion);
    D.st.headUp = new THREE.Vector3(0, 1, 0).applyQuaternion(head.quaternion);
    D.st.head = head.position.clone();
    D.st.chest = spine[Math.round(0.27 * (NS - 1))].clone();
    D.st.tail = spine[NS - 1].clone();
    D.st.wPath = wp;

    // ---- legs (two-bone IK)
    let li = 0, ci = 0;
    const setCap = (a, b, r) => {
      const d = v3.subVectors(b, a);
      const len = d.length();
      q1.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      v1.addVectors(a, b).multiplyScalar(0.5);
      // capsule geometry is radius 1, straight length 1 (3 tall): scale y by len/3
      m4.compose(v1, q1, new THREE.Vector3(r, Math.max(0.05, (len) / (1 + 2)), r));
      limbs.setMatrixAt(li++, m4);
    };
    const setCone = (mesh, idx, base, dir, len, rad) => {
      q1.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v3.copy(dir).normalize());
      m4.compose(base, q1, new THREE.Vector3(rad, len, rad));
      mesh.setMatrixAt(idx, m4);
    };
    const pw = plantW(t) * (1 - wp);
    const legs = [
      [0.25, 1, 2.5, 2.4],
      [0.25, -1, 2.5, 2.4],
      [0.47, 1, 2.6, 2.6],
      [0.47, -1, 2.6, 2.6],
    ];
    const cw = clawW(t);
    const cl = CLAW(t);
    D.st.feet = [];
    for (const [u, s, a, b] of legs) {
      const i = Math.round(u * (NS - 1));
      const r = rProf(u);
      const hip = new THREE.Vector3().copy(spine[i]).addScaledVector(Bn[i], s * r * 0.8).addScaledVector(Nn[i], -r * 0.35);
      // tucked target
      const tuck = hip.clone().addScaledVector(Tn[i], 2.6).addScaledVector(Nn[i], -1.6).addScaledVector(Bn[i], s * 0.6);
      // planted target on the ground beside the body
      const fwd = v3.copy(Tn[i]).negate().setY(0).normalize();
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(-s);
      const px = hip.x + side.x * 1.4 + fwd.x * (u < 0.3 ? 1.0 : -0.3), pz = hip.z + side.z * 1.4 + fwd.z * (u < 0.3 ? 1.0 : -0.3);
      const plant = new THREE.Vector3(px, groundH(px, pz) + 0.25, pz);
      const foot = tuck.lerp(plant, pw);
      if (u < 0.3 && s === -1 && cw > 0) foot.lerp(new THREE.Vector3(cl[0], cl[1], cl[2]), cw);
      // IK
      const d = v3.subVectors(foot, hip);
      let dl = d.length();
      const maxL = a + b - 0.05;
      if (dl > maxL) {
        foot.copy(hip).addScaledVector(d.normalize(), maxL);
        dl = maxL;
      } else d.normalize();
      const cosA = clamp((a * a + dl * dl - b * b) / (2 * a * dl), -1, 1);
      const pole = new THREE.Vector3().copy(fwd).multiplyScalar(u < 0.3 ? 1 : -1).addScaledVector(d, -fwd.dot(d) * (u < 0.3 ? 1 : -1)).normalize();
      const knee = hip.clone().addScaledVector(d, a * cosA).addScaledVector(pole, a * Math.sqrt(1 - cosA * cosA));
      setCap(hip, knee, u < 0.3 ? 0.5 : 0.62);
      setCap(knee, foot, u < 0.3 ? 0.36 : 0.42);
      // toes + claws
      for (let k = -1; k <= 1; k++) {
        const td = new THREE.Vector3().copy(fwd).addScaledVector(side, k * 0.45).normalize();
        const toe = foot.clone().addScaledVector(td, 0.55);
        setCap(foot, toe, 0.2);
        setCone(claws, ci++, toe, td.clone().setY(-0.4), 0.55, 0.11);
      }
      D.st.feet.push(foot.clone());
    }

    // ---- wings
    const spread = spreadAt(t), amp = flapAmp(t), base = flapBase(t), sweep = sweepAt(t);
    const ph = t * 1.05 * TAU;
    const flap = (x) => base + amp * (Math.sin(ph - x * 0.06) * 0.9 + 0.25 * Math.sin(2 * ph - x * 0.12)) * (0.55 + x / 30);
    const dflap = amp * Math.cos(ph) * 0.9;
    const open = { E: [4.2, 1.8, 0], W: [8.6, 0.6, 0], F: [[20, 2.0, 0], [18, -5.5, 0], [13.5, -9.5, 0], [7.8, -10.5, 0]] };
    const shut = { E: [1.8, -2.0, 1.2], W: [2.6, 1.2, 1.4], F: [[3.0, -9.0, 1.4], [2.7, -8.6, 1.2], [2.4, -7.9, 1.0], [2.0, -6.8, 0.8]] };
    const mix3 = (a, b, k) => [lerp(b[0], a[0], k), lerp(b[1], a[1], k), lerp(b[2], a[2], k)];
    const iw = Math.round(0.22 * (NS - 1)), ib = Math.round(0.46 * (NS - 1));
    D.st.wingTips = [];
    for (const W of wings) {
      const s = W.side;
      const r = rProf(0.22);
      const S = new THREE.Vector3().copy(spine[iw]).addScaledVector(Nn[iw], r * 0.72).addScaledVector(Bn[iw], s * r * 0.5);
      const fw = v3.copy(Tn[iw]).negate();
      const ax = new THREE.Vector3().copy(Bn[iw]).multiplyScalar(s), ay = fw.clone(), az = Nn[iw].clone();
      const toW = (p2) => {
        // p2 = [span, fwd, up] in wing coords -> flap about the forward axis with span lag, sweep back
        let [x, y, z] = p2;
        const sw = sweep * (x / 20);
        const xs = x * Math.cos(sw) - y * Math.sin(sw) * 0, ys = y - x * Math.sin(sw);
        const f = flap(xs);
        const xx = xs * Math.cos(f) - z * Math.sin(f), zz = xs * Math.sin(f) + z * Math.cos(f);
        return new THREE.Vector3().copy(S).addScaledVector(ax, xx).addScaledVector(ay, ys).addScaledVector(az, zz);
      };
      const k = clamp(spread, 0, 1.1);
      const E = toW(mix3(open.E, shut.E, k)), Wr = toW(mix3(open.W, shut.W, k));
      const Fs = open.F.map((f, n) => toW(mix3(f, shut.F[n], k)));
      const Bt = new THREE.Vector3().copy(spine[ib]).addScaledVector(Nn[ib], rProf(0.46) * 0.6).addScaledVector(Bn[ib], s * rProf(0.46) * 0.5);
      // bones
      setCap(S, E, 0.42);
      setCap(E, Wr, 0.3);
      for (let n = 0; n < 4; n++) setCap(Wr, Fs[n], 0.13 - n * 0.015);
      setCone(claws, ci++, Wr, E.clone().sub(Wr).negate().add(new THREE.Vector3(0, 0.5, 0)), 0.6, 0.08);
      D.st.wingTips.push(Fs[0].clone());
      // membrane
      const nrm = new THREE.Vector3().crossVectors(v1.subVectors(Fs[0], S), v2.subVectors(Bt, S)).normalize().multiplyScalar(s);
      const pos = W.geo.attributes.position.array;
      let o2 = 0;
      const billow = -clamp(dflap, -1, 1) * 0.8 * k;
      for (let p = 0; p < PAN; p++)
        for (let a = 0; a < NA; a++)
          for (let b = 0; b < NB; b++) {
            const ka = a / (NA - 1), kb = b / (NB - 1);
            const P2 = new THREE.Vector3();
            if (p < 3) {
              const A2 = Fs[p], B2 = Fs[p + 1];
              const edge = v1.lerpVectors(A2, B2, kb);
              const sag = 0.16 * Math.sin(Math.PI * kb) * ka * ka;
              P2.lerpVectors(Wr, edge, ka * (1 - sag));
            } else {
              const top = v1.lerpVectors(Wr, Fs[3], kb), bot = v2.lerpVectors(S, Bt, kb);
              P2.lerpVectors(top, bot, ka);
              const sag = 0.2 * Math.sin(Math.PI * kb) * ka * ka;
              P2.lerp(v3.lerpVectors(Wr, S, kb), sag);
            }
            P2.addScaledVector(nrm, billow * Math.sin(Math.PI * ka) * Math.sin(Math.PI * kb));
            pos[o2++] = P2.x;
            pos[o2++] = P2.y;
            pos[o2++] = P2.z;
          }
      W.geo.attributes.position.needsUpdate = true;
      W.geo.computeVertexNormals();
      W.geo.computeBoundingSphere();
    }
    limbs.count = li;
    limbs.instanceMatrix.needsUpdate = true;

    // ---- dorsal spines, mane and tail fin
    let si = 0;
    for (let n = 0; n < 48; n++) {
      const u = 0.02 + (n / 47) * 0.95;
      const i = Math.round(u * (NS - 1));
      const r = rProf(u);
      const h = (u < 0.2 ? 1.1 : u < 0.5 ? 0.75 : 0.9) * (1 - u * 0.6) * (0.8 + 0.4 * ((n * 7) % 3) / 2);
      const basePt = v1.copy(spine[i]).addScaledVector(Nn[i], r * 0.92);
      const dir = v2.copy(Nn[i]).addScaledVector(Tn[i], 0.9).normalize();
      const zx = v3.copy(Bn[i]).addScaledVector(dir, -Bn[i].dot(dir)).normalize();
      const xx = new THREE.Vector3().crossVectors(dir, zx);
      m4.makeBasis(xx.multiplyScalar(0.22 * (h + 0.3)), dir.clone().multiplyScalar(h * 1.4), zx.clone().multiplyScalar(0.07 + 0.05 * h));
      m4.setPosition(basePt);
      spines.setMatrixAt(si++, m4);
    }
    // tail fin
    for (const s of [1, -1]) {
      const i = NS - 2;
      const dir = v2.copy(Tn[i]).addScaledVector(Bn[i], s * 0.9).normalize();
      q1.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      m4.compose(spine[i], q1, new THREE.Vector3(0.5, 2.2, 0.08));
      spines.setMatrixAt(si++, m4);
    }
    spines.count = si;
    spines.instanceMatrix.needsUpdate = true;
    claws.count = ci;
    claws.instanceMatrix.needsUpdate = true;
  };
  D.setSun = (sunV) => {
    for (const m of D.mats) if (m.userData.u.uSunV) m.userData.u.uSunV.value.copy(sunV);
  };
  return D;
}
