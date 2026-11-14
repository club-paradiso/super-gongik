// Boot, lights, grade timeline and the frame entry point.
// window.__renderFrame(n) renders frame n (t = n / FPS) from nothing but n: any order, any machine.
import * as THREE from "three";
import {
  FPS,
  DUR,
  FRAMES,
  T,
  stormAt,
  flashAt,
  whiteAt,
  fadeAt,
  fringeAt,
  shotAt,
} from "./timeline.js";
import { keyed, track, win, pulse, sstep, clamp } from "./util.js";
import { buildWorld, SUN_DIR, BLAST_AT } from "./world.js";
import { buildDragon, throatAt } from "./dragon.js";
import { buildAgent } from "./agent.js";
import { buildFx } from "./fx.js";
import { buildPost } from "./post.js";
import { cameraAt } from "./camera.js";

const qs = new URLSearchParams(location.search);
const W = +(qs.get("w") || 1280),
  H = +(qs.get("h") || 536);
const SAMPLES = +(qs.get("msaa") ?? 4);

const canvas = document.createElement("canvas");
canvas.width = W;
canvas.height = H;
canvas.style.width = "100%";
document.body.appendChild(canvas);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  preserveDrawingBuffer: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(new THREE.Color(0.3, 0.17, 0.25), 0.0022);
const camera = new THREE.PerspectiveCamera(45, W / H, 0.05, 9000);

// ---------- lights ----------
const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.6, 0.36), 3.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -48;
sc.right = 48;
sc.top = 48;
sc.bottom = -48;
sc.near = 1;
sc.far = 400;
sun.shadow.bias = -0.0015;
sun.shadow.normalBias = 0.12;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(
  new THREE.Color(0.36, 0.3, 0.62),
  new THREE.Color(0.28, 0.13, 0.08),
  0.9,
);
scene.add(hemi);
const storm = new THREE.DirectionalLight(new THREE.Color(0.6, 0.7, 1.0), 0);
storm.position.set(-40, 120, -200);
scene.add(storm);
// cool fill from the evening sky opposite the sun, so the white dragon reads white against the sunset
const rimL = new THREE.DirectionalLight(new THREE.Color(0.62, 0.58, 1.0), 1.5);
rimL.position.set(35, 45, 90);
scene.add(rimL);

const world = buildWorld(scene);
const dragon = buildDragon(scene);
const agent = buildAgent(scene);
const fx = buildFx(scene, world, dragon, agent);
const post = buildPost(renderer, W, H, SAMPLES);

// ---------- titles (Latin only: the render machine has no CJK font) ----------
const titleCanvas = document.createElement("canvas");
titleCanvas.width = W;
titleCanvas.height = H;
const tctx = titleCanvas.getContext("2d");
const titleTex = new THREE.CanvasTexture(titleCanvas);
titleTex.colorSpace = THREE.NoColorSpace;
post.comp.tTitle.value = titleTex;
let titleDrawn = -1;
const drawTitle = (which) => {
  if (titleDrawn === which) return;
  titleDrawn = which;
  tctx.clearRect(0, 0, W, H);
  if (which === 0) return;
  const s = H / 536;
  tctx.textAlign = "center";
  tctx.textBaseline = "middle";
  tctx.fillStyle = "rgba(255,240,226,1)";
  tctx.shadowColor = "rgba(0,0,0,0.6)";
  tctx.shadowBlur = 18 * s;
  const spaced = (txt, x, y, sp) => {
    const chars = [...txt];
    const widths = chars.map((c) => tctx.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
    let cx = x - total / 2;
    chars.forEach((c, i) => {
      tctx.fillText(c, cx + widths[i] / 2, y);
      cx += widths[i] + sp;
    });
  };
  tctx.font = `bold ${Math.round(54 * s)}px "DejaVu Serif", serif`;
  const tx = which === 1 ? W / 2 : W * 0.3;
  spaced("SUPER-GONGIK", tx, which === 1 ? H * 0.42 : H * 0.46, 14 * s);
  tctx.font = `${Math.round(15 * s)}px "DejaVu Sans", sans-serif`;
  tctx.fillStyle = "rgba(255,214,170,0.95)";
  spaced(
    which === 1
      ? "SOCIAL SERVICE AGENT  vs  THE WHITE DRAGON"
      : "END OF SHIFT  ·  18:00",
    tx,
    which === 1 ? H * 0.53 : H * 0.57,
    5 * s,
  );
  titleTex.needsUpdate = true;
};

// ---------- grade over time ----------
const GRADE = track([
  // t, exposure, sat, gainR, gainG, gainB, rays
  [0, 1.05, 1.05, 1.06, 0.98, 0.92, 0.9],
  [8.5, 1.0, 1.0, 1.04, 0.98, 0.94, 0.8],
  [10, 0.95, 0.82, 0.93, 0.96, 1.08, 0.15],
  [21, 0.98, 0.85, 0.95, 0.97, 1.05, 0.2],
  [28, 1.0, 0.95, 1.02, 0.98, 0.96, 0.55],
  [44, 1.0, 0.95, 1.0, 0.98, 0.98, 0.55],
  [45.5, 0.95, 0.9, 0.92, 1.0, 1.1, 0.3],
  [50.5, 0.97, 0.92, 0.95, 0.99, 1.05, 0.4],
  [54, 1.03, 1.05, 1.05, 0.98, 0.93, 0.8],
  [68.8, 1.0, 1.0, 1.05, 0.96, 0.9, 0.7],
  [70, 1.08, 1.12, 1.1, 0.95, 0.86, 0.9],
  [80, 1.05, 1.08, 1.08, 0.97, 0.9, 1.0],
  [90, 1.0, 1.05, 1.08, 0.97, 0.9, 1.0],
]);
const fogDensity = keyed([
  [0, 0.0018],
  [10, 0.0028],
  [26, 0.0026],
  [32, 0.002],
  [69, 0.002],
  [70, 0.004],
  [74, 0.0026],
  [80, 0.0018],
]);

const sunScr = new THREE.Vector3();
const sunV = new THREE.Vector3();
function renderAt(n) {
  const t = Math.min(n / FPS, DUR - 1e-4);
  agent.update(t);
  dragon.update(t, { lookAt: agent.st.head });
  dragon.st.throat = throatAt(t);
  const shot = cameraAt(t, agent.st, dragon.st, camera);
  camera.updateMatrixWorld(true);
  world.update(t, camera);
  fx.update(t, camera, H / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  // light rig
  const st = stormAt(t),
    fl = flashAt(t);
  const focus =
    shot.name === "emerge" ||
    shot.name === "cloud" ||
    shot.name === "flyby" ||
    shot.name === "dive"
      ? dragon.st.chest
      : new THREE.Vector3(0, 0, -10);
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(SUN_DIR, 150);
  sun.intensity = 3.4 * (1 - 0.7 * st);
  storm.intensity = fl * 5 + st * 0.5;
  hemi.intensity = 0.85 * (1 - 0.35 * st) + 0.6 * pulse(t, T.BLAST, 0.02, 0.6);
  sunV.copy(SUN_DIR).transformDirection(camera.matrixWorldInverse);
  dragon.setSun(sunV);
  const fd = fogDensity(t);
  scene.fog.density = fd;
  scene.fog.color.setRGB(0.3 - 0.12 * st, 0.17 - 0.05 * st, 0.25 - 0.03 * st);
  // grade
  const [ex, sat, gr, gg, gb, ray] = GRADE(t);
  const c = post.comp;
  c.uExposure.value = ex * (1 + 0.15 * fl);
  c.uSat.value = sat;
  c.uGain.value.set(gr, gg, gb);
  c.uWhite.value = whiteAt(t);
  c.uFade.value = fadeAt(t);
  c.uFringe.value = fringeAt(t);
  c.uFrame.value = n;
  c.uBloom.value = 0.07 + 0.08 * pulse(t, T.BLAST, 0.05, 1.0);
  // shock ring on screen
  const bk = t - T.BLAST;
  if (bk > 0 && bk < 1.0) {
    const p = BLAST_AT.clone().project(camera);
    c.uRing.value.set(
      p.x * 0.5 + 0.5,
      p.y * 0.5 + 0.5,
      bk * 1.4,
      (1 - bk) * (p.z < 1 ? 1 : 0),
    );
  } else c.uRing.value.set(0, 0, 0, 0);
  // titles
  const tw1 = win(t, 5.0, 8.6, 0.9, 0.9),
    tw2 = win(t, T.TITLE2, DUR, 1.0, 0.01);
  drawTitle(tw1 > 0 ? 1 : tw2 > 0 ? 2 : 0);
  c.uTitle.value = Math.max(tw1, tw2 * (1 - sstep(T.OUT + 0.4, DUR, t) * 0));
  // sun shafts: only when the sun is in front of the lens
  sunScr.copy(camera.position).addScaledVector(SUN_DIR, 1000).project(camera);
  const inFront = sunScr.z < 1 ? 1 : 0;
  const onScreen =
    inFront * sstep(1.6, 0.9, Math.max(Math.abs(sunScr.x), Math.abs(sunScr.y)));
  post.render(
    scene,
    camera,
    new THREE.Vector2(sunScr.x * 0.5 + 0.5, sunScr.y * 0.5 + 0.5),
    onScreen * ray * (1 - 0.8 * st),
  );
  return { t, shot: shot.name };
}

// QA statistics on a small copy of the frame
const statC = document.createElement("canvas");
statC.width = 64;
statC.height = 27;
const statX = statC.getContext("2d", { willReadFrequently: true });
function stats() {
  statX.drawImage(canvas, 0, 0, 64, 27);
  const d = statX.getImageData(0, 0, 64, 27).data;
  let s = 0,
    s2 = 0,
    n = 0,
    clip = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    s += l;
    s2 += l * l;
    n++;
    if (l > 250) clip++;
  }
  const mean = s / n;
  return {
    mean,
    std: Math.sqrt(Math.max(0, s2 / n - mean * mean)),
    clip: clip / n,
  };
}

window.__renderFrame = (n, opts = {}) => {
  const r = renderAt(n);
  const out = { ...r, n };
  if (opts.stats) out.stats = stats();
  if (opts.jpeg)
    out.data = canvas.toDataURL("image/jpeg", opts.quality || 0.94);
  if (opts.png) out.data = canvas.toDataURL("image/png");
  return out;
};
window.__dbg = {
  THREE,
  scene,
  dragon,
  agent,
  fx,
  world,
  post,
  camera,
  renderer,
};
window.__INFO = { W, H, FPS, DUR, FRAMES, T, three: THREE.REVISION };
// warm up: compile every program once
renderAt(0);
renderAt(Math.round(T.BREATH * FPS + 30));
renderAt(Math.round(T.BLAST * FPS + 3));
window.__READY = true;

// live preview: ?play
if (qs.has("play")) {
  const t0 = performance.now() - +(qs.get("t") || 0) * 1000;
  const loop = () => {
    const t = ((performance.now() - t0) / 1000) % DUR;
    renderAt(Math.floor(t * FPS));
    requestAnimationFrame(loop);
  };
  loop();
} else if (qs.has("f")) renderAt(+qs.get("f"));
