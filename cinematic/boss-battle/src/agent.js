// The social-service agent: a procedural humanoid in the SUPER-GONGIK uniform as drawn in the app icon
// (navy cap, blue short-sleeve work shirt, Korean-flag chest patch, round shoulder emblem, dark navy
// trousers, black boots) plus a name tag. He carries an oversized official seal on a handle: the seal-hammer.
// Animation: a joint hierarchy driven by a pose library, procedural run/walk cycles and a keyed root path.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { T } from "./timeline.js";
import { track, keyed, sstep, clamp, lerp, win, pulse, TAU } from "./util.js";
import { extend } from "./shaderkit.js";
import { groundH } from "./world.js";
import { SEAL_TEX } from "./dragon.js";

// ---------- colours (sampled from docs/design/app-icon V3) ----------
const C = {
  shirt: 0x2e5aa6,
  shirtDark: 0x24498a,
  trousers: 0x18223f,
  cap: 0x1c2950,
  boots: 0x0c0c10,
  skin: 0xd9a27c,
  hair: 0x141012,
  belt: 0x111114,
};

function flagTexture() {
  // Taegukgi drawn procedurally: white field, red/blue taegeuk, four trigrams
  const W = 300,
    H = 200;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  const cx = W / 2,
    cy = H / 2,
    r = H / 4;
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.atan2(2, 3));
  g.fillStyle = "#cd2e3a";
  g.beginPath();
  g.arc(0, 0, r, Math.PI, 0);
  g.fill();
  g.fillStyle = "#0047a0";
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI);
  g.fill();
  g.fillStyle = "#cd2e3a";
  g.beginPath();
  g.arc(-r / 2, 0, r / 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#0047a0";
  g.beginPath();
  g.arc(r / 2, 0, r / 2, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // trigrams: bars along the diagonals. pattern: 1 = solid, 0 = broken (from the centre outward)
  const tri = [
    [-1, -1, [1, 1, 1]], // geon (top-left)
    [1, 1, [0, 0, 0]], // gon (bottom-right)
    [1, -1, [0, 1, 0]], // gam (top-right)
    [-1, 1, [1, 0, 1]], // ri (bottom-left)
  ];
  g.fillStyle = "#000";
  for (const [sx, sy, pat] of tri) {
    g.save();
    const ang = Math.atan2(sy * 2, sx * 3);
    g.translate(cx, cy);
    g.rotate(ang);
    const bw = H / 12,
      bl = H / 4,
      gap = H / 24;
    pat.forEach((solid, i) => {
      const d = r + H / 8 + i * (bw + gap);
      if (solid) g.fillRect(d, -bl / 2, bw, bl);
      else {
        g.fillRect(d, -bl / 2, bw, bl / 2 - gap / 2);
        g.fillRect(d, gap / 2, bw, bl / 2 - gap / 2);
      }
    });
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function emblemTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#16213f";
  g.beginPath();
  g.arc(64, 64, 62, 0, TAU);
  g.fill();
  g.strokeStyle = "#d8b25a";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(64, 64, 52, 0, TAU);
  g.stroke();
  // a stylised dragon-and-shield mark (original): S curve inside a shield
  g.fillStyle = "#d8b25a";
  g.beginPath();
  g.moveTo(64, 26);
  g.lineTo(94, 38);
  g.quadraticCurveTo(94, 84, 64, 102);
  g.quadraticCurveTo(34, 84, 34, 38);
  g.closePath();
  g.fill();
  g.strokeStyle = "#16213f";
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(78, 44);
  g.bezierCurveTo(44, 44, 84, 74, 50, 86);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function nameTagTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#111";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#eee";
  g.font = "bold 34px DejaVu Sans, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("SOCIAL SERVICE", 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const fabric = (color, scale = 70) =>
  extend(new THREE.MeshStandardMaterial({ color, roughness: 0.82 }), {
    color: `float w = vn3(vL * ${scale.toFixed(1)}) * 0.5 + vn3(vL * ${(scale * 3.1).toFixed(1)}) * 0.5; diffuseColor.rgb *= 0.9 + 0.2 * w; hgt = w;`,
    bump: 0.004,
  });

export function buildAgent(scene) {
  const A = { st: {} };
  const M = {
    shirt: fabric(C.shirt),
    shirtDark: fabric(C.shirtDark),
    trousers: fabric(C.trousers),
    cap: fabric(C.cap, 90),
    boots: new THREE.MeshStandardMaterial({
      color: C.boots,
      roughness: 0.35,
      metalness: 0.1,
    }),
    skin: new THREE.MeshStandardMaterial({ color: C.skin, roughness: 0.6 }),
    hair: new THREE.MeshStandardMaterial({ color: C.hair, roughness: 0.75 }),
    belt: new THREE.MeshStandardMaterial({
      color: C.belt,
      roughness: 0.4,
      metalness: 0.3,
    }),
    buckle: new THREE.MeshStandardMaterial({
      color: 0xb8b8c0,
      roughness: 0.25,
      metalness: 1,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xd2a84a,
      roughness: 0.3,
      metalness: 1,
    }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0b0a0c, roughness: 0.15 }),
    eyeW: new THREE.MeshStandardMaterial({ color: 0xe9e3dc, roughness: 0.3 }),
    flag: new THREE.MeshStandardMaterial({
      map: flagTexture(),
      roughness: 0.7,
    }),
    emblem: new THREE.MeshStandardMaterial({
      map: emblemTexture(),
      roughness: 0.6,
    }),
    tag: new THREE.MeshStandardMaterial({
      map: nameTagTexture(),
      roughness: 0.4,
    }),
  };
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const joint = (parent, x, y, z) => {
    const j = new THREE.Group();
    j.position.set(x, y, z);
    parent.add(j);
    return j;
  };
  const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 3, r);
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);

  const root = new THREE.Group();
  scene.add(root);
  const hips = joint(root, 0, 0.98, 0);
  // pelvis / trousers seat
  mesh(rbox(0.36, 0.22, 0.24, 0.08), M.trousers, hips, 0, -0.04, 0);
  mesh(rbox(0.37, 0.06, 0.25, 0.02), M.belt, hips, 0, 0.08, 0);
  mesh(rbox(0.07, 0.05, 0.02, 0.01), M.buckle, hips, 0, 0.08, 0.13);
  const spine = joint(hips, 0, 0.1, 0);
  // abdomen (shirt tucked in)
  mesh(rbox(0.34, 0.24, 0.22, 0.09), M.shirt, spine, 0, 0.1, 0);
  const chest = joint(spine, 0, 0.22, 0);
  const torso = mesh(rbox(0.42, 0.34, 0.25, 0.1), M.shirt, chest, 0, 0.1, 0);
  torso.scale.set(1, 1, 1);
  // collar, placket, pockets
  for (const s of [1, -1]) {
    const col = mesh(
      rbox(0.12, 0.05, 0.1, 0.02),
      M.shirtDark,
      chest,
      0.06 * s,
      0.29,
      0.07,
    );
    col.rotation.set(0.5, 0, -0.5 * s);
    mesh(
      rbox(0.11, 0.12, 0.02, 0.01),
      M.shirtDark,
      chest,
      0.1 * s,
      0.13,
      0.126,
    );
  }
  mesh(rbox(0.025, 0.36, 0.01, 0.005), M.shirtDark, chest, 0, 0.08, 0.128);
  // Korean flag on the wearer's left chest, name tag on the right
  const flag = mesh(
    new THREE.PlaneGeometry(0.09, 0.06),
    M.flag,
    chest,
    0.1,
    0.215,
    0.1265,
  );
  flag.castShadow = false;
  const tag = mesh(
    new THREE.PlaneGeometry(0.1, 0.025),
    M.tag,
    chest,
    -0.1,
    0.215,
    0.1265,
  );
  tag.castShadow = false;
  const neck = joint(chest, 0, 0.3, 0);
  mesh(cap(0.055, 0.06), M.skin, neck, 0, 0.04, 0);
  const head = joint(neck, 0, 0.1, 0);
  const skull = mesh(
    new THREE.SphereGeometry(0.105, 24, 18),
    M.skin,
    head,
    0,
    0.1,
    0.0,
  );
  skull.scale.set(0.95, 1.12, 1.05);
  const jawM = mesh(rbox(0.15, 0.08, 0.13, 0.04), M.skin, head, 0, 0.03, 0.025);
  jawM.rotation.x = 0.15;
  mesh(
    new THREE.SphereGeometry(0.02, 8, 6),
    M.skin,
    head,
    0,
    0.08,
    0.115,
  ).scale.set(0.8, 1.3, 1);
  // mouth
  mesh(
    rbox(0.045, 0.008, 0.01, 0.003),
    new THREE.MeshStandardMaterial({ color: 0x7a4a3c, roughness: 0.6 }),
    head,
    0,
    0.048,
    0.112,
  );
  for (const s of [1, -1]) {
    mesh(
      new THREE.SphereGeometry(0.018, 10, 8),
      M.eyeW,
      head,
      0.038 * s,
      0.115,
      0.09,
    ).scale.set(1.2, 0.7, 0.6);
    mesh(
      new THREE.SphereGeometry(0.011, 8, 6),
      M.eye,
      head,
      0.038 * s,
      0.115,
      0.1,
    );
    const brow = mesh(
      rbox(0.04, 0.008, 0.01, 0.003),
      M.hair,
      head,
      0.04 * s,
      0.14,
      0.098,
    );
    brow.rotation.z = -0.15 * s;
    mesh(
      new THREE.SphereGeometry(0.025, 8, 6),
      M.skin,
      head,
      0.103 * s,
      0.1,
      0,
    ).scale.set(0.4, 1, 0.7);
  }
  // hair (short, visible under the cap)
  const hair = mesh(
    new THREE.SphereGeometry(0.11, 20, 12, 0, TAU, 0, 1.8),
    M.hair,
    head,
    0,
    0.115,
    -0.012,
  );
  hair.scale.set(0.98, 1.0, 1.06);
  // cap: crown, band, brim, badge
  const capG = joint(head, 0, 0.175, 0.005);
  const crown = mesh(
    new THREE.SphereGeometry(0.118, 24, 12, 0, TAU, 0, Math.PI / 2),
    M.cap,
    capG,
    0,
    0,
    0,
  );
  crown.scale.set(1, 0.72, 1.08);
  mesh(
    new THREE.CylinderGeometry(0.119, 0.119, 0.04, 24, 1, true),
    M.cap,
    capG,
    0,
    -0.012,
    0,
  ).scale.set(1, 1, 1.08);
  const brimShape = new THREE.Shape();
  brimShape.absarc(0, 0, 0.12, Math.PI * 0.05, Math.PI * 0.95, false);
  brimShape.lineTo(0, -0.02);
  const brim = mesh(
    new THREE.ExtrudeGeometry(brimShape, {
      depth: 0.008,
      bevelEnabled: false,
      curveSegments: 16,
    }),
    M.cap,
    capG,
    0,
    -0.028,
    0.07,
  );
  brim.rotation.x = Math.PI / 2 - 0.12;
  brim.scale.set(1.25, 0.95, 1);
  mesh(
    new THREE.CircleGeometry(0.022, 16),
    M.gold,
    capG,
    0,
    0.035,
    0.124,
  ).rotation.x = -0.35;
  A.capG = capG;

  // arms
  const arm = (s) => {
    const sh = joint(chest, 0.235 * s, 0.22, 0);
    mesh(new THREE.SphereGeometry(0.075, 12, 10), M.shirt, sh, 0, 0, 0);
    const upper = mesh(cap(0.058, 0.18), M.shirt, sh, 0, -0.12, 0);
    // rolled short sleeve opening
    mesh(
      new THREE.CylinderGeometry(0.066, 0.066, 0.04, 14),
      M.shirtDark,
      sh,
      0,
      -0.2,
      0,
    );
    mesh(cap(0.045, 0.1), M.skin, sh, 0, -0.24, 0);
    if (s > 0) {
      // round emblem on the left sleeve
      const em = mesh(
        new THREE.CircleGeometry(0.035, 20),
        M.emblem,
        sh,
        0.06,
        -0.09,
        0.0,
      );
      em.rotation.y = Math.PI / 2;
    }
    const el = joint(sh, 0, -0.29, 0);
    mesh(cap(0.044, 0.19), M.skin, el, 0, -0.13, 0);
    const wr = joint(el, 0, -0.26, 0);
    const hand = mesh(
      rbox(0.075, 0.1, 0.035, 0.015),
      M.skin,
      wr,
      0,
      -0.05,
      0.005,
    );
    const thumb = mesh(cap(0.014, 0.03), M.skin, wr, -0.035 * s, -0.035, 0.025);
    thumb.rotation.z = 0.6 * s;
    return { sh, el, wr, hand };
  };
  const L = arm(1),
    R = arm(-1);
  // legs
  const leg = (s) => {
    const hp = joint(hips, 0.095 * s, -0.06, 0);
    mesh(cap(0.082, 0.3), M.trousers, hp, 0, -0.21, 0);
    const kn = joint(hp, 0, -0.44, 0);
    mesh(cap(0.066, 0.3), M.trousers, kn, 0, -0.2, 0);
    const an = joint(kn, 0, -0.43, 0);
    mesh(rbox(0.11, 0.13, 0.13, 0.03), M.boots, an, 0, -0.01, 0);
    mesh(rbox(0.11, 0.08, 0.27, 0.035), M.boots, an, 0, -0.07, 0.05);
    mesh(rbox(0.115, 0.02, 0.28, 0.008), M.belt, an, 0, -0.105, 0.05);
    return { hp, kn, an };
  };
  const LL = leg(1),
    RL = leg(-1);

  // ---------- the seal-hammer ----------
  const hammer = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0x3b2418,
    roughness: 0.55,
  });
  mesh(
    new THREE.CylinderGeometry(0.022, 0.026, 1.05, 10),
    wood,
    hammer,
    0,
    0.42,
    0,
  );
  mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.06, 10),
    M.gold,
    hammer,
    0,
    -0.08,
    0,
  );
  mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10),
    M.gold,
    hammer,
    0,
    0.93,
    0,
  );
  const lacquer = new THREE.MeshStandardMaterial({
    color: 0x7a0f12,
    roughness: 0.3,
    metalness: 0.2,
  });
  const hHead = joint(hammer, 0, 1.02, 0);
  const sealBody = mesh(
    new RoundedBoxGeometry(0.42, 0.24, 0.24, 3, 0.04),
    lacquer,
    hHead,
    0,
    0,
    0,
  );
  mesh(new THREE.BoxGeometry(0.44, 0.03, 0.26), M.gold, hHead, 0, 0.0, 0);
  // the seal face (on +x end) glows
  const sealU = { uTex: { value: SEAL_TEX() }, uGlow: { value: 0 } };
  const face = mesh(
    new THREE.PlaneGeometry(0.22, 0.22),
    new THREE.ShaderMaterial({
      uniforms: sealU,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uGlow; varying vec2 vUv; void main(){ float m = texture2D(uTex, vUv).r; vec3 base = vec3(0.35,0.03,0.03); vec3 c = mix(base, vec3(4.0, 0.7, 0.35) * (0.2 + uGlow), m); gl_FragColor = vec4(c, 1.); }`,
    }),
    hHead,
    0.2105,
    0,
    0,
  );
  face.rotation.y = Math.PI / 2;
  face.castShadow = false;
  // glowing rim
  const rimMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3, 0.4, 0.2),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rim = mesh(
    new THREE.TorusGeometry(0.15, 0.012, 8, 32),
    rimMat,
    hHead,
    0.212,
    0,
    0,
  );
  rim.rotation.y = Math.PI / 2;
  rim.castShadow = false;
  A.hammer = hammer;
  A.hammerHead = hHead;
  A.sealU = sealU;
  // the hammer lives on the back until it is drawn
  const backSlot = joint(chest, 0, 0.12, -0.16);
  const handSlot = joint(R.wr, 0, -0.07, 0.01);
  A.root = root;

  // ---------- choreography ----------
  // root path [t, x, y, z, yaw] (yaw: facing direction, 0 = +z)
  const ROOT = track([
    [0, 7.6, 0, 16.0, Math.PI + 0.43],
    [4.4, 7.6, 0, 16.0, Math.PI + 0.43],
    [8.4, 0.5, 0, 1.0, Math.PI + 0.25],
    [9.2, 0.5, 0, 1.0, Math.PI],
    [33.5, 0.5, 0, 1.0, Math.PI],
    [36.9, -1.6, 0, -11.0, Math.PI + 0.15],
    [37.55, -3.0, 0, -14.4, Math.PI + 0.25],
    [38.6, -3.0, 0, -14.6, Math.PI + 0.1],
    [40.6, -3.0, 0, -14.6, Math.PI + 0.05],
    [42.2, -2.6, 0, -13.6, Math.PI],
    [43.1, -1.5, 0, -7.0, Math.PI],
    [52.4, -1.5, 0, -7.0, Math.PI],
    [57.8, -1.4, 0, -6.6, Math.PI - 0.4],
    [58.4, -0.6, 0, -5.4, 0.6],
    [60.6, 3.5, 0, 4.0, 0.15],
    [61.4, 5.4, 0, 6.0, Math.PI * 0.75],
    [62.4, 5.6, 0, 4.4, Math.PI],
    [64.0, 5.2, 0, 1.0, Math.PI],
    [64.6, 5.0, 2.0, -2.5, Math.PI],
    [65.2, 5.0, 3.6, -3.6, Math.PI],
    [65.8, 5.0, 5.2, -4.7, Math.PI],
    [66.45, 5.0, 6.8, -5.8, Math.PI],
    [67.4, 3.2, 11.5, -8.4, Math.PI],
    [68.2, 1.6, 13.4, -10.3, Math.PI],
    [69.0, 0.55, 12.25, -11.75, Math.PI],
    [69.4, 0.6, 12.9, -11.2, Math.PI],
    [70.0, 0.75, 9.0, -10.0, Math.PI],
    [70.6, 0.8, 0.0, -9.2, Math.PI],
    [77.8, 0.8, 0.0, -9.2, Math.PI],
    [79.6, 0.5, 0.0, -11.3, Math.PI],
    [85.6, 0.5, 0.0, -11.3, Math.PI],
    [86.8, 0.5, 0.0, -11.3, Math.PI - 0.7],
  ]);
  // stance / clip timeline [t, clip, blendIn]
  const TL = [
    [0, "idle", 0.1],
    [4.4, "walk", 0.4],
    [8.4, "idle", 0.6],
    [9.6, "lookUp", 1.2],
    [16.5, "idle", 1.0],
    [19.5, "brace", 0.6],
    [23.6, "braceWind", 0.3],
    [26.6, "idle", 0.8],
    [31.0, "draw", 0.4],
    [32.2, "ready", 0.6],
    [33.5, "run", 0.3],
    [36.9, "slide", 0.2],
    [37.7, "ready", 0.5],
    [39.7, "parry", 0.35],
    [41.2, "ready", 0.5],
    [42.15, "knocked", 0.1],
    [43.3, "ready", 0.5],
    [44.4, "ward", 0.45],
    [48.3, "deflect", 0.3],
    [50.4, "ready", 0.8],
    [52.6, "lookUp", 0.8],
    [57.7, "run", 0.4],
    [64.0, "climb", 0.2],
    [66.4, "leap", 0.15],
    [68.3, "swing", 0.4],
    [69.05, "smash", 0.1],
    [69.6, "fall", 0.3],
    [70.55, "land", 0.08],
    [72.6, "idleHammer", 1.0],
    [77.8, "walk", 0.4],
    [79.6, "reach", 0.6],
    [81.0, "lookUp", 0.8],
    [85.3, "restHammer", 0.6],
    [86.6, "capTip", 0.5],
    [88.0, "restHammer", 0.8],
  ];
  const Z = () => ({
    hips: [0, 0, 0],
    spine: [0, 0, 0],
    chest: [0, 0, 0],
    neck: [0, 0, 0],
    head: [0, 0, 0],
    lSh: [0, 0, 0.12],
    lEl: [0, 0, 0],
    lWr: [0, 0, 0],
    rSh: [0, 0, -0.12],
    rEl: [0, 0, 0],
    rWr: [0, 0, 0],
    lHp: [0, 0, 0],
    lKn: [0, 0, 0],
    lAn: [0, 0, 0],
    rHp: [0, 0, 0],
    rKn: [0, 0, 0],
    rAn: [0, 0, 0],
    drop: 0,
    hammer: "back",
  });
  const pose = (o) => Object.assign(Z(), o);
  const runCycle = (ph, amp = 1) => {
    const s = Math.sin(ph),
      c = Math.cos(ph);
    return pose({
      hips: [0.08 * amp, 0.12 * s * amp, 0],
      spine: [0.12 * amp, 0, 0],
      chest: [0.08 * amp, -0.22 * s * amp, 0],
      neck: [-0.1 * amp, 0, 0],
      lHp: [-0.85 * s * amp, 0, 0.03],
      lKn: [0.25 + (0.95 * Math.max(0, -c) + 0.2) * amp, 0, 0],
      lAn: [0.2 * s * amp, 0, 0],
      rHp: [0.85 * s * amp, 0, -0.03],
      rKn: [0.25 + (0.95 * Math.max(0, c) + 0.2) * amp, 0, 0],
      rAn: [-0.2 * s * amp, 0, 0],
      lSh: [0.9 * s * amp, 0, 0.18],
      lEl: [-1.3 * amp, 0, 0],
      rSh: [-0.9 * s * amp, 0, -0.18],
      rEl: [-1.3 * amp, 0, 0],
      drop: 0.05 * amp * (1 - Math.abs(c)),
    });
  };
  const walkCycle = (ph) => {
    const s = Math.sin(ph),
      c = Math.cos(ph);
    return pose({
      hips: [0, 0.06 * s, 0],
      chest: [0, -0.08 * s, 0],
      lHp: [-0.42 * s, 0, 0.02],
      lKn: [0.1 + 0.5 * Math.max(0, -c), 0, 0],
      rHp: [0.42 * s, 0, -0.02],
      rKn: [0.1 + 0.5 * Math.max(0, c), 0, 0],
      lSh: [0.35 * s, 0, 0.12],
      lEl: [-0.25, 0, 0],
      rSh: [-0.35 * s, 0, -0.12],
      rEl: [-0.25, 0, 0],
      drop: 0.02 * (1 - Math.abs(c)),
    });
  };
  const CLIPS = {
    idle: (t) =>
      pose({
        chest: [0.02 * Math.sin(t * 1.4), 0, 0],
        lSh: [0, 0, 0.1],
        rSh: [0, 0, -0.1],
        lEl: [-0.15, 0, 0],
        rEl: [-0.15, 0, 0],
        lHp: [0, 0, 0.05],
        rHp: [0, 0, -0.05],
      }),
    idleHammer: (t) =>
      pose({
        chest: [0.02 * Math.sin(t * 1.4), 0, 0],
        lSh: [0, 0, 0.1],
        lEl: [-0.15, 0, 0],
        rSh: [-0.15, 0, -0.18],
        rEl: [-2.15, 0, 0],
        rWr: [0.1, 0, 0],
        lHp: [0, 0, 0.06],
        rHp: [0, 0, -0.06],
        hammer: "hand",
      }),
    walk: (t) => walkCycle(t * 2 * Math.PI * 0.95),
    lookUp: (t) =>
      pose({
        neck: [-0.35, 0, 0],
        head: [-0.35, 0, 0],
        chest: [-0.08, 0, 0],
        lSh: [0, 0, 0.12],
        rSh: [0, 0, -0.12],
        lHp: [0, 0, 0.06],
        rHp: [0, 0, -0.06],
        hammer: t > T.DRAW ? "hand" : "back",
        rEl: t > T.DRAW ? [-0.4, 0, 0] : [0, 0, 0],
      }),
    brace: () =>
      pose({
        hips: [0, 0.3, 0],
        spine: [0.1, 0, 0],
        chest: [0.05, -0.2, 0],
        head: [-0.1, 0.2, 0],
        lHp: [-0.35, 0, 0.18],
        lKn: [0.45, 0, 0],
        rHp: [0.2, 0, -0.2],
        rKn: [0.25, 0, 0],
        lSh: [-0.3, 0, 0.25],
        lEl: [-0.8, 0, 0],
        rSh: [0.2, 0, -0.3],
        rEl: [-0.4, 0, 0],
        drop: 0.08,
      }),
    braceWind: (t) =>
      pose({
        hips: [0, 0.3, 0],
        spine: [0.25, 0, 0],
        chest: [0.2, -0.15, 0],
        head: [0.1, 0.25, 0],
        lHp: [-0.5, 0, 0.2],
        lKn: [0.7, 0, 0],
        rHp: [0.35, 0, -0.2],
        rKn: [0.35, 0, 0],
        lSh: [-1.6, 0, 0.3],
        lEl: [-1.4, 0, 0],
        lWr: [0.0, 0, 0],
        rSh: [0.2, 0, -0.35],
        rEl: [-0.3, 0, 0],
        drop: 0.14 + 0.01 * Math.sin(t * 30),
      }),
    draw: (t) => {
      const k = sstep(T.DRAW, T.DRAW + 0.9, t);
      return pose({
        hips: [0, 0.2 * k, 0],
        chest: [0.05, -0.3 + 0.4 * k, 0],
        rSh: [lerp(-2.6, -1.2, k), 0, lerp(-0.4, -0.5, k)],
        rEl: [lerp(-1.6, -0.6, k), 0, 0],
        lSh: [-0.3, 0, 0.3],
        lEl: [-0.5, 0, 0],
        lHp: [-0.2, 0, 0.12],
        lKn: [0.3, 0, 0],
        rHp: [0.15, 0, -0.12],
        rKn: [0.2, 0, 0],
        drop: 0.05,
        hammer: t > T.DRAW + 0.35 ? "hand" : "back",
      });
    },
    ready: (t) =>
      pose({
        hips: [0, 0.35, 0],
        spine: [0.12, 0, 0],
        chest: [0.05, -0.15, 0],
        head: [-0.05, 0.12, 0],
        lHp: [-0.4, 0, 0.2],
        lKn: [0.6, 0, 0],
        lAn: [0.15, 0, 0],
        rHp: [0.25, 0, -0.2],
        rKn: [0.45, 0, 0],
        lSh: [-0.6, 0, 0.35],
        lEl: [-1.1, 0, 0],
        rSh: [-0.5, 0.2, -0.3],
        rEl: [-1.3, 0, 0],
        rWr: [0.3, 0, 0],
        drop: 0.12 + 0.01 * Math.sin(t * 2.5),
        hammer: "hand",
      }),
    run: (t) =>
      Object.assign(runCycle(t * 2 * Math.PI * 1.55), {
        hammer: t > T.DRAW ? "hand" : "back",
        rSh: [-0.6 + 0.3 * Math.sin(t * 9.7), 0, -0.25],
        rEl: [-1.5, 0, 0],
      }),
    slide: () =>
      pose({
        hips: [-0.5, 0.2, 0.15],
        spine: [0.2, 0, 0],
        chest: [0.35, 0, 0],
        head: [-0.3, 0, 0],
        lHp: [-1.5, 0, 0.1],
        lKn: [0.1, 0, 0],
        rHp: [-0.3, 0, -0.1],
        rKn: [1.9, 0, 0],
        lSh: [-0.6, 0, 0.9],
        lEl: [-0.3, 0, 0],
        rSh: [-1.5, 0, -0.5],
        rEl: [-0.5, 0, 0],
        drop: 0.62,
        hammer: "hand",
      }),
    parry: (t) => {
      const k = sstep(39.7, 40.35, t);
      return pose({
        hips: [0, 0.3, 0],
        spine: [0.05, 0, 0],
        chest: [-0.1, -0.1, 0],
        head: [-0.35, 0, 0],
        lHp: [-0.5, 0, 0.25],
        lKn: [0.8, 0, 0],
        rHp: [0.4, 0, -0.25],
        rKn: [0.6, 0, 0],
        rSh: [lerp(-1.2, -2.9, k), 0, -0.2],
        rEl: [lerp(-1.2, -0.3, k), 0, 0],
        rWr: [0.6, 0, 0],
        lSh: [lerp(-0.8, -2.7, k), 0, 0.25],
        lEl: [-0.5, 0, 0],
        drop: 0.18 + 0.12 * pulse(t, 40.4, 0.02, 0.3),
        hammer: "hand",
      });
    },
    knocked: (t) => {
      const k = sstep(42.15, 42.7, t);
      return pose({
        hips: [-0.2, 0.1, 0],
        spine: [0.3, 0, 0],
        chest: [0.3 - 0.4 * pulse(t, 42.2, 0.03, 0.3), 0, 0],
        head: [0.3, 0, 0],
        lHp: [-1.0, 0, 0.3],
        lKn: [1.5, 0, 0],
        rHp: [0.5, 0, -0.3],
        rKn: [1.2, 0, 0],
        lSh: [-0.8, 0, 1.1],
        lEl: [-0.4, 0, 0],
        rSh: [-1.0, 0, -0.6],
        rEl: [-1.2, 0, 0],
        drop: 0.35 + 0.1 * k,
        hammer: "hand",
      });
    },
    ward: (t) =>
      pose({
        hips: [0, 0.2, 0],
        spine: [0.15, 0, 0],
        chest: [0.1, 0.0, 0],
        head: [-0.1, 0, 0],
        lHp: [-0.6, 0, 0.25],
        lKn: [0.85, 0, 0],
        lAn: [0.2, 0, 0],
        rHp: [0.5, 0, -0.25],
        rKn: [0.5, 0, 0],
        rSh: [-1.55, 0, -0.1],
        rEl: [-0.35, 0, 0],
        rWr: [-1.4, 0, 0],
        lSh: [-1.45, 0, 0.15],
        lEl: [-0.4, 0, 0],
        drop: 0.2 + 0.02 * Math.sin(t * 40) * win(t, 45, 50.5),
        hammer: "hand",
      }),
    deflect: (t) =>
      pose({
        hips: [0, -0.1, 0],
        spine: [0.15, 0, 0],
        chest: [0.1, -0.45, 0.1],
        head: [-0.1, 0.3, 0],
        lHp: [-0.6, 0, 0.3],
        lKn: [0.9, 0, 0],
        rHp: [0.5, 0, -0.25],
        rKn: [0.55, 0, 0],
        rSh: [-1.5, 0.3, -0.2],
        rEl: [-0.4, 0, 0],
        rWr: [-1.4, 0, 0.5],
        lSh: [-1.4, 0, 0.1],
        lEl: [-0.4, 0, 0],
        drop: 0.24 + 0.02 * Math.sin(t * 40),
        hammer: "hand",
      }),
    climb: (t) =>
      Object.assign(runCycle(t * 2 * Math.PI * 1.7, 1.15), {
        hammer: "hand",
        rSh: [-0.9, 0, -0.25],
        rEl: [-1.6, 0, 0],
      }),
    leap: (t) => {
      const k = sstep(66.4, 67.2, t);
      return pose({
        hips: [-0.3 * k, 0, 0],
        spine: [-0.1, 0, 0],
        chest: [-0.2 * k, 0, 0],
        head: [-0.2, 0, 0],
        lHp: [-1.6 * k, 0, 0.1],
        lKn: [2.0 * k, 0, 0],
        rHp: [lerp(-0.5, 0.3, k), 0, -0.1],
        rKn: [lerp(0.4, 0.6, k), 0, 0],
        rSh: [-2.7 * k - 0.4, 0, -0.3],
        rEl: [-0.8, 0, 0],
        lSh: [-1.8 * k, 0, 0.5],
        lEl: [-0.5, 0, 0],
        hammer: "hand",
      });
    },
    swing: (t) => {
      const k = sstep(68.3, 68.95, t);
      return pose({
        hips: [-0.3 + 0.2 * k, 0, 0],
        spine: [lerp(-0.4, 0.2, k), 0, 0],
        chest: [lerp(-0.5, 0.45, k), 0, 0],
        head: [lerp(-0.3, 0.1, k), 0, 0],
        lHp: [-1.5, 0, 0.15],
        lKn: [1.8, 0, 0],
        rHp: [lerp(0.4, -0.6, k), 0, -0.1],
        rKn: [lerp(0.6, 1.2, k), 0, 0],
        rSh: [lerp(-3.4, -1.4, k), 0, -0.2],
        rEl: [lerp(-0.9, -0.1, k), 0, 0],
        rWr: [lerp(-0.6, -1.3, k), 0, 0],
        lSh: [lerp(-3.2, -1.3, k), 0, 0.2],
        lEl: [lerp(-0.6, -0.1, k), 0, 0],
        lWr: [0, 0, 0],
        hammer: "hand",
      });
    },
    smash: () =>
      pose({
        hips: [-0.1, 0, 0],
        spine: [0.3, 0, 0],
        chest: [0.5, 0, 0],
        head: [0.15, 0, 0],
        lHp: [-1.4, 0, 0.15],
        lKn: [1.7, 0, 0],
        rHp: [-0.6, 0, -0.1],
        rKn: [1.2, 0, 0],
        rSh: [-1.25, 0, -0.2],
        rEl: [-0.05, 0, 0],
        rWr: [-1.35, 0, 0],
        lSh: [-1.2, 0, 0.2],
        lEl: [-0.1, 0, 0],
        hammer: "hand",
      }),
    fall: (t) =>
      pose({
        hips: [0.3, 0, 0],
        spine: [-0.2, 0, 0],
        chest: [-0.2, 0, 0],
        head: [0.2, 0, 0],
        lHp: [-0.9, 0, 0.3],
        lKn: [1.4, 0, 0],
        rHp: [-0.5, 0, -0.3],
        rKn: [1.0, 0, 0],
        rSh: [-2.0, 0, -0.5],
        rEl: [-0.6, 0, 0],
        lSh: [-0.4, 0, 1.4],
        lEl: [-0.3, 0, 0],
        hammer: "hand",
      }),
    land: (t) => {
      const k = sstep(70.55, 70.75, t),
        up = sstep(71.8, 72.6, t);
      return pose({
        hips: [-0.15 * (1 - up), 0.15, 0],
        spine: [0.5 * (1 - up), 0, 0],
        chest: [0.4 * (1 - up), 0, 0],
        head: [-0.5 * (1 - up), 0, 0],
        lHp: [lerp(-1.5, -0.2, up), 0, 0.15],
        lKn: [lerp(2.3, 0.3, up), 0, 0],
        lAn: [0.4 * (1 - up), 0, 0],
        rHp: [lerp(0.6, 0.1, up), 0, -0.1],
        rKn: [lerp(2.4, 0.2, up), 0, 0],
        rAn: [-0.8 * (1 - up), 0, 0],
        lSh: [lerp(-0.6, -0.1, up), 0, lerp(0.15, 0.1, up)],
        lEl: [-0.1, 0, 0],
        lWr: [0.2, 0, 0],
        rSh: [lerp(-0.3, -0.25, up), 0, lerp(-0.6, -0.15, up)],
        rEl: [lerp(-0.4, -1.2, up), 0, 0],
        drop: lerp(0.62 * k, 0, up),
        hammer: "hand",
      });
    },
    reach: (t) =>
      pose({
        chest: [0.08, 0, 0],
        head: [0.05, 0, 0],
        lSh: [-1.3, 0, 0.1],
        lEl: [-0.3, 0, 0],
        lWr: [0.4, 0, 0],
        rSh: [-0.2, 0, -0.15],
        rEl: [-1.1, 0, 0],
        lHp: [-0.2, 0, 0.06],
        lKn: [0.1, 0, 0],
        rHp: [0.1, 0, -0.06],
        hammer: "hand",
      }),
    capTip: (t) => {
      const k = win(t, 86.6, 88.0, 0.5, 0.5);
      return pose({
        chest: [0.02, 0.1, 0],
        head: [-0.05 + 0.08 * k, 0.15, 0],
        lSh: [lerp(0, -2.4, k), 0, lerp(0.1, 0.55, k)],
        lEl: [lerp(-0.15, -2.3, k), 0, 0],
        lWr: [0.3 * k, 0, 0],
        rSh: [-0.12, 0, -0.32],
        rEl: [-0.25, 0, 0],
        rWr: [1.3, 0, 0],
        lHp: [0, 0, 0.06],
        rHp: [0, 0, -0.06],
        hammer: "hand",
      });
    },
    // end of shift: the seal-hammer rests head-down beside the right boot
    restHammer: (t) =>
      pose({
        chest: [0.02 * Math.sin(t * 1.4), 0.1, 0],
        head: [-0.03, 0.15, 0],
        lSh: [0, 0, 0.1],
        lEl: [-0.15, 0, 0],
        rSh: [-0.12, 0, -0.32],
        rEl: [-0.25, 0, 0],
        rWr: [1.3, 0, 0],
        lHp: [0, 0, 0.06],
        rHp: [0, 0, -0.06],
        hammer: "hand",
      }),
  };
  const clipAt = (t) => {
    let i = 0;
    while (i < TL.length - 1 && t >= TL[i + 1][0]) i++;
    const [t0, name, bl] = TL[i];
    const cur = CLIPS[name](t);
    if (i === 0 || t >= t0 + bl) return cur;
    const prev = CLIPS[TL[i - 1][1]](t);
    const k = sstep(t0, t0 + bl, t);
    const out = {};
    for (const key in cur) {
      if (Array.isArray(cur[key]))
        out[key] = cur[key].map((v, n) => lerp(prev[key][n], v, k));
      else if (typeof cur[key] === "number")
        out[key] = lerp(prev[key], cur[key], k);
      else out[key] = k < 0.5 ? prev[key] : cur[key];
    }
    return out;
  };
  const J = {
    hips,
    spine,
    chest,
    neck,
    head,
    lSh: L.sh,
    lEl: L.el,
    lWr: L.wr,
    rSh: R.sh,
    rEl: R.el,
    rWr: R.wr,
    lHp: LL.hp,
    lKn: LL.kn,
    lAn: LL.an,
    rHp: RL.hp,
    rKn: RL.kn,
    rAn: RL.an,
  };
  const glowAt = (t) =>
    sstep(T.DRAW + 0.5, T.DRAW + 1.2, t) *
    (0.5 +
      0.5 * win(t, 39.6, 41.2) +
      0.9 * win(t, 44.4, 50.6, 0.4, 0.5) +
      2.5 * win(t, 66.4, 69.4, 1.2, 0.2)) *
    (1 - 0.6 * sstep(72, 76, t));
  A.glowAt = glowAt;

  A.update = (t) => {
    const [x, y, z, yaw] = ROOT(t);
    const c = clipAt(t);
    root.position.set(
      x,
      Math.max(y, 0) + groundH(x, z) * (y < 0.01 ? 1 : 0),
      z,
    );
    root.rotation.set(0, yaw, 0);
    for (const k in J) J[k].rotation.set(c[k][0], c[k][1], c[k][2], "YXZ");
    hips.position.y = 0.98 - c.drop;
    // cap brim flutter in the wind
    capG.rotation.x =
      -0.02 * win(t, T.ROAR, T.ROAR_END) * (1 + Math.sin(t * 40));
    const slot = c.hammer === "hand" ? handSlot : backSlot;
    if (hammer.parent !== slot) slot.add(hammer);
    if (c.hammer === "hand") {
      // grip in the fist: the handle runs through the palm along the hand's forward axis
      hammer.rotation.set(Math.PI / 2, 0, 0);
      hammer.position.set(0, 0, -0.08);
    } else {
      // slung across the back: seal head low at the left hip, handle up over the right shoulder
      hammer.position.set(-0.38, 0.5, -0.07);
      hammer.rotation.set(0.12, 0, -(Math.PI - 0.55));
    }
    const g = glowAt(t);
    sealU.uGlow.value = g;
    rimMat.opacity = clamp(g * 0.8, 0, 1);
    root.updateMatrixWorld(true);
    A.st.head = new THREE.Vector3(0, 0.12, 0).applyMatrix4(head.matrixWorld);
    A.st.chest = new THREE.Vector3(0, 0.1, 0).applyMatrix4(chest.matrixWorld);
    A.st.face = new THREE.Vector3(0, 0.11, 0.1).applyMatrix4(head.matrixWorld);
    A.st.seal = new THREE.Vector3(0.21, 0, 0).applyMatrix4(hHead.matrixWorld);
    A.st.sealN = new THREE.Vector3(1, 0, 0).transformDirection(
      hHead.matrixWorld,
    );
    A.st.root = root.position.clone();
    A.st.fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    A.st.glow = g;
  };
  return A;
}
