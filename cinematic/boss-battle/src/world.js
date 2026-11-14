// The set: a basalt headland over the sea at sunset. A paved plaza (the agent's post), columnar-basalt
// stacks, a dry-stone wall, street lamps and a bench, all of which the fight takes apart.
// Destruction is closed-form: each loose piece has a release time, launch velocity and spin, and its
// pose at any t comes from ballistic arcs with two bounces, so frames can be rendered in any order.
import * as THREE from 'three';
import { NOISE, SKY } from './glsl.js';
import { extend } from './shaderkit.js';
import { T, stormAt, flashAt, windAt } from './timeline.js';
import { rng, fbm2, clamp, sstep, lerp, pulse, vnoise2 } from './util.js';

export const SEA_Y = -30;
export const SUN_DIR = new THREE.Vector3(-0.55, 0.11, -0.83).normalize();
export const BLAST_AT = new THREE.Vector3(0, 12.5, -13);
const G = -9.81;

export function edgeZ(x) {
  return -36 + 14 * (fbm2(x * 0.03 + 3.1, 1.7, 4) - 0.5) + 10 * Math.max(0, Math.abs(x) - 70) / 30;
}
export function groundH(x, z) {
  const e = z - edgeZ(x);
  const plateau = 0.35 * (fbm2(x * 0.05, z * 0.05, 4) - 0.5) * sstep(16, 30, Math.hypot(x, z)) + Math.max(0, z - 50) * 0.22 * fbm2(x * 0.02, z * 0.02, 3);
  if (e > 0) return plateau - 0.15 * sstep(2, 0, e);
  // the cliff: a steep fall with ledges
  const k = clamp(-e / 9);
  const ledges = 2.5 * Math.sin(-e * 0.9 + fbm2(x * 0.1, z * 0.1, 3) * 6) * k * (1 - k);
  return lerp(plateau, SEA_Y - 6, Math.pow(k, 0.65)) + ledges;
}

const SKY_UNI = () => ({ uSunDir: { value: SUN_DIR.clone() }, uStorm: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 } });

export function buildWorld(scene) {
  const W = { groups: [], debris: [], bursts: [], uniforms: [] };
  const skyU = SKY_UNI();
  W.skyU = skyU;

  // ---------- sky dome ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: skyU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: `uniform vec3 uSunDir; uniform float uStorm, uFlash, uTime; varying vec3 vD; ${NOISE} ${SKY}
        void main(){ gl_FragColor = vec4(skyColor(normalize(vD), true), 1.); }`,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  W.sky = sky;

  // ---------- terrain ----------
  const tg = new THREE.PlaneGeometry(420, 380, 260, 240);
  tg.rotateX(-Math.PI / 2);
  tg.translate(0, 0, 30);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    let y = groundH(x, z);
    // push the cliff face out and in so it is not a smooth sheet
    const e = z - edgeZ(x);
    if (e < 0 && e > -14) {
      const n = (fbm2(x * 0.18, y * 0.18, 3) - 0.5) * 3.2;
      tp.setZ(i, z + n);
    }
    tp.setY(i, y);
  }
  tg.computeVertexNormals();
  const terrainMat = extend(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), {
    uniforms: { uFrost: { value: new THREE.Vector4(0, 0, -6, 0) } },
    color: /* glsl */ `
      float slope = 1. - clamp(vNW.y, 0., 1.);
      float n = fbm2(vW.xz * 0.35);
      float n2 = vn2(vW.xz * 3.1);
      vec3 grass = mix(vec3(0.085, 0.10, 0.035), vec3(0.17, 0.15, 0.06), n);
      float colx = (vW.x + vW.z * 0.35) * 0.24 + fbm2(vW.xz * 0.04) * 2.;
      float cj = abs(fract(colx) - 0.5);
      float joints = smoothstep(0.03, 0.0, cj - 0.46) * 0.8;
      float band = 0.5 * smoothstep(0.47, 0.5, abs(fract(vW.y * 0.12 + h12(vec2(floor(colx), 1.)) ) - 0.5) + 0.02);
      vec3 rock = mix(vec3(0.035, 0.033, 0.04), vec3(0.10, 0.09, 0.095), fbm3(vW * vec3(0.12, 0.04, 0.12)) ) * (0.75 + 0.5 * h12(vec2(floor(colx), 7.)));
      rock *= 1. - 0.35 * max(joints, band);
      float rk = smoothstep(0.28, 0.5, slope + (n - .5) * .3);
      diffuseColor.rgb = mix(grass, rock, rk) * (0.85 + 0.3 * n2);
      hgt = rk * (1. - max(joints, band)) + (1. - rk) * n2 * 0.15;
      float fd = length(vW.xz - uFrost.xy);
      float fr = uFrost.w * (1. - smoothstep(uFrost.z * 0.4, uFrost.z, fd + (vn2(vW.xz*0.8)-.5)*3.));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.86, 0.95), fr * 0.8);
    `,
    bump: 0.9,
  });
  W.uniforms.push(terrainMat.userData.u);
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // height map for the sea's foam line
  const HM = 128, hm = new Float32Array(HM * HM);
  for (let j = 0; j < HM; j++) for (let i = 0; i < HM; i++) hm[j * HM + i] = groundH(-210 + (i / (HM - 1)) * 420, -160 + (j / (HM - 1)) * 380);
  const hmTex = new THREE.DataTexture(hm, HM, HM, THREE.RedFormat, THREE.FloatType);
  hmTex.magFilter = hmTex.minFilter = THREE.LinearFilter;
  hmTex.needsUpdate = true;

  // ---------- sea ----------
  const seaU = { ...skyU, uHM: { value: hmTex }, uCam: { value: new THREE.Vector3() }, uFogCol: { value: new THREE.Color() }, uBlast: { value: new THREE.Vector4(0, 0, 0, 0) } };
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2).translate(0, SEA_Y, 0),
    new THREE.ShaderMaterial({
      uniforms: seaU,
      fog: false,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir, uCam, uFogCol; uniform float uStorm, uFlash, uTime; uniform sampler2D uHM; uniform vec4 uBlast;
        varying vec3 vW; ${NOISE} ${SKY}
        vec3 waves(vec2 p, float t, float dist){
          vec2 g = vec2(0.);
          float amp = 0.55, fr = 0.09;
          for (int i = 0; i < 7; i++) {
            float a = float(i) * 2.399 + 0.6;
            vec2 dir = vec2(cos(a), sin(a));
            float ph = dot(p, dir) * fr + t * sqrt(9.8 * fr) * 1.0;
            g += dir * cos(ph) * amp * fr;
            amp *= 0.62; fr *= 1.71;
          }
          g *= 1.0 - smoothstep(60., 900., dist) * 0.85;
          return normalize(vec3(-g.x, 1.0, -g.y));
        }
        void main(){
          vec3 V = vW - uCam; float dist = length(V); V /= dist;
          vec3 N = waves(vW.xz, uTime, dist);
          N = normalize(mix(N, vec3(0,1,0), 0.15));
          vec3 R = reflect(V, N); R.y = abs(R.y);
          float fres = 0.02 + 0.98 * pow(1. - max(dot(-V, N), 0.), 5.);
          vec3 refl = skyColor(R, false);
          vec3 deep = vec3(0.012, 0.02, 0.04) * (1. - uStorm * 0.5);
          vec3 c = mix(deep, refl, fres);
          float spec = pow(max(dot(R, uSunDir), 0.), 600.) * 60. + pow(max(dot(R, uSunDir), 0.), 40.) * 0.6;
          c += vec3(1.0, 0.55, 0.25) * spec * (1. - uStorm * 0.8);
          // foam where the sea meets the cliff
          vec2 uv = vec2((vW.x + 210.) / 420., (vW.z + 160.) / 380.);
          float hgt = texture2D(uHM, uv).r;
          float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
          float foam = inside * smoothstep(${(SEA_Y - 5).toFixed(1)}, ${(SEA_Y + 0.6).toFixed(1)}, hgt) * (0.55 + 0.45 * sin(uTime * 1.3 + vW.x * 0.2 + vn2(vW.xz * .3) * 6.));
          foam *= smoothstep(0.35, 0.75, vn2(vW.xz * 0.9 + uTime * 0.3));
          c = mix(c, vec3(0.55, 0.42, 0.45) * (1. - uStorm * .5), clamp(foam, 0., 1.) * 0.8);
          // blast ripple ring
          float br = length(vW.xz - uBlast.xy);
          c += vec3(1.2, 0.8, 0.6) * uBlast.w * exp(-pow((br - uBlast.z) * 0.15, 2.)) * 0.6;
          // haze to the horizon
          vec3 hz = skyBase(normalize(vec3(V.x, 0.02, V.z)));
          c = mix(c, hz, smoothstep(150., 3500., dist) * 0.92);
          gl_FragColor = vec4(c, 1.);
        }`,
    }),
  );
  sea.frustumCulled = false;
  scene.add(sea);
  W.seaU = seaU;

  // ---------- sea stacks and far headlands ----------
  const rockMat = extend(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), {
    color: `float cx = atan(vL.z, vL.x) * 5.; float j = smoothstep(0.08, 0., abs(fract(cx) - .5) - .42); diffuseColor.rgb = mix(vec3(0.035,0.03,0.04), vec3(0.11,0.095,0.1), fbm3(vW*vec3(0.08,0.02,0.08))) * (1. - 0.6 * j); hgt = 1. - j;`,
    bump: 0.6,
  });
  const stack = (x, z, r, h, seed) => {
    const g = new THREE.CylinderGeometry(r * 0.55, r, h, 22, 24);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const a = Math.atan2(pz, px);
      const k = 1 + 0.35 * (fbm2(a * 1.5 + seed, py * 0.08 + seed, 4) - 0.5) * 2;
      p.setXYZ(i, px * k, py, pz * k);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, rockMat);
    m.position.set(x, SEA_Y + h / 2 - 4, z);
    m.castShadow = true;
    scene.add(m);
  };
  stack(-75, -120, 9, 42, 1);
  stack(-48, -150, 6, 30, 2);
  stack(62, -135, 11, 52, 3);
  stack(120, -260, 18, 60, 4);
  // far islands on the horizon
  const ig = new THREE.PlaneGeometry(4000, 200, 200, 8).rotateX(-Math.PI / 2);
  const ip = ig.attributes.position;
  for (let i = 0; i < ip.count; i++) {
    const x = ip.getX(i), z = ip.getZ(i);
    const k = 1 - Math.abs(z) / 100;
    ip.setY(i, Math.max(0, (fbm2(x * 0.004, 2, 5) - 0.42) * 260) * k);
  }
  ig.computeVertexNormals();
  const isl = new THREE.Mesh(ig, new THREE.MeshBasicMaterial({ color: 0x1a0f22, fog: false }));
  isl.position.set(300, SEA_Y, -1900);
  isl.rotation.y = 0.12;
  scene.add(isl);
  W.island = isl;

  // ---------- the plaza ----------
  const plazaMat = extend(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), {
    uniforms: { uFrost: terrainMat.userData.u.uFrost, uSeal: { value: 0 } },
    color: /* glsl */ `
      vec2 q = vW.xz / 1.25; vec2 cell = floor(q + vec2(floor(q.y) * 0.5, 0.)); vec2 f = fract(q + vec2(floor(q.y) * 0.5, 0.));
      float grout = smoothstep(0.0, 0.025, min(min(f.x, 1.-f.x), min(f.y, 1.-f.y)));
      float tone = h12(cell);
      vec3 stone = mix(vec3(0.2, 0.19, 0.185), vec3(0.27, 0.255, 0.245), tone) * (0.92 + 0.12 * vn2(vW.xz * 1.5));
      diffuseColor.rgb = mix(vec3(0.09), stone, grout);
      hgt = grout * (0.6 + 0.4 * vn2(vW.xz * 6.)) ;
      float fd = length(vW.xz - uFrost.xy);
      float fr = uFrost.w * (1. - smoothstep(uFrost.z * 0.4, uFrost.z, fd + (vn2(vW.xz*0.8)-.5)*3.));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.88, 0.97), fr * 0.85);
      float ring = smoothstep(17.6, 17.8, length(vW.xz)) ;
      diffuseColor.rgb *= 1. - ring * 0.4;
    `,
    rough: `roughnessFactor = mix(roughnessFactor, 0.25, 0.0);`,
    bump: 0.35,
  });
  W.uniforms.push(plazaMat.userData.u);
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(18, 96).rotateX(-Math.PI / 2), plazaMat);
  plaza.position.y = 0.06;
  plaza.receiveShadow = true;
  scene.add(plaza);
  // granite curb
  const curb = new THREE.Mesh(new THREE.TorusGeometry(18, 0.22, 8, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55504c, roughness: 0.8 }));
  curb.position.y = 0.08;
  curb.receiveShadow = curb.castShadow = true;
  scene.add(curb);

  // ---------- grass ----------
  {
    const blade = new THREE.BufferGeometry();
    const bw = 0.06, bh = 1;
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-bw, 0, 0, bw, 0, 0, -bw * 0.6, bh * 0.5, 0, bw * 0.6, bh * 0.5, 0, 0, bh, 0], 3));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    const N = 26000, R = rng(77);
    const gm = extend(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), {
      uniforms: { uTime: { value: 0 }, uWind: { value: 0.3 }, uBlast: { value: new THREE.Vector4(0, 0, 0, 0) } },
      vertex: /* glsl */ `
        vec4 ip = instanceMatrix * vec4(0.,0.,0.,1.);
        float k = position.y;
        float ph = ip.x * 0.21 + ip.z * 0.17;
        float sway = (sin(uTime * 2.1 + ph) * 0.5 + sin(uTime * 3.7 + ph * 1.7) * 0.25) * uWind + uWind * 0.6;
        transformed.x += sway * k * k * 0.5;
        transformed.z += sway * k * k * 0.25;
        // shock front flattens the grass outward
        vec2 d = ip.xz - uBlast.xy; float dl = length(d);
        float front = uBlast.w * smoothstep(uBlast.z + 4., uBlast.z - 2., dl);
        transformed.y *= 1. - front * 0.6;
      `,
      color: `diffuseColor.rgb *= mix(vec3(0.09,0.11,0.03), vec3(0.32,0.27,0.09), vL.y) * (0.7 + 0.6 * h12(floor(vW.xz*3.)));`,
    });
    W.grassU = gm.userData.u;
    W.uniforms.push(gm.userData.u);
    const grass = new THREE.InstancedMesh(blade, gm, N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    let n = 0;
    for (let tries = 0; tries < N * 4 && n < N; tries++) {
      const a = R() * Math.PI * 2, r = 18.6 + Math.pow(R(), 0.9) * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (z - edgeZ(x) < 1.5) continue;
      if (fbm2(x * 0.08, z * 0.08, 3) < 0.38) continue;
      p.set(x, groundH(x, z) - 0.02, z);
      e.set((R() - 0.5) * 0.5, R() * Math.PI, (R() - 0.5) * 0.5);
      q.setFromEuler(e);
      const h = 0.35 + R() * 0.65;
      s.set(1, h, 1);
      m.compose(p, q, s);
      grass.setMatrixAt(n++, m);
    }
    grass.count = n;
    grass.frustumCulled = false;
    scene.add(grass);
  }

  // ---------- breakable pieces ----------
  const basaltMat = extend(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, flatShading: true }), {
    varyings: 'varying float vId;',
    vertex: 'vId = float(gl_InstanceID);',
    color: /* glsl */ `
      vec3 lp = vL * vec3(1., 2.5, 1.) + vId * 7.31;
      float n = fbm3(lp * 0.9);
      diffuseColor.rgb = mix(vec3(0.045, 0.043, 0.048), vec3(0.15, 0.14, 0.15), n) * (0.85 + 0.3 * h12(vec2(vId, 3.)));
      float cap = smoothstep(0.42, 0.5, abs(vL.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.2), cap * 0.6);
      hgt = n;
    `,
    bump: 0.4,
  });
  const pieces = []; // {geoKey, rest: {p, q, s}, tr, v0, w, axis, groundY, half}
  const R = rng(1234);
  const addPiece = (kind, pos, quat, scale, half) => {
    const pc = { kind, p: pos.clone(), q: quat.clone(), s: scale.clone(), half, tr: Infinity, v0: new THREE.Vector3(), w: 0, axis: new THREE.Vector3(1, 0, 0) };
    pieces.push(pc);
    return pc;
  };
  const pillarSets = {};
  const makeCluster = (name, cx, cz, heights) => {
    const set = [];
    heights.forEach((h, i) => {
      const a = (i / heights.length) * Math.PI * 2 + R() * 0.5;
      const rr = heights.length > 1 ? 0.9 + R() * 0.5 : 0;
      // cluster C is a stair: one column after another, rising toward the sea
      const x = name === 'C' ? cx + (R() - 0.5) * 0.12 : cx + Math.cos(a) * rr;
      const z = name === 'C' ? cz - i * 1.1 : cz + Math.sin(a) * rr;
      const rad = 0.55 + R() * 0.2;
      let y = groundH(x, z) - 0.3;
      const rot = R() * Math.PI;
      let left = h + 0.3;
      while (left > 0.05) {
        const sh = Math.min(left, 0.7 + R() * 0.7);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 0.04, rot, (R() - 0.5) * 0.04));
        set.push(addPiece('col', new THREE.Vector3(x, y + sh / 2, z), q, new THREE.Vector3(rad, sh, rad), sh / 2));
        y += sh + 0.01;
        left -= sh;
      }
    });
    pillarSets[name] = set;
  };
  makeCluster('A', -10, -12, [4.5, 6.2, 3.4, 5.4, 2.6, 7.0]);
  makeCluster('B', 11, -16, [5.6, 3.8, 6.8, 4.4, 2.8]);
  makeCluster('C', 5, -2.5, [2.0, 3.6, 5.2, 6.8]);
  makeCluster('D', 16, 8, [3.2, 4.8, 2.4]);
  W.columnTop = (i) => {
    const set = pillarSets.C;
    // top of column i of the stair: highest piece near its x
    const z = -2.5 - i * 1.1;
    let top = 0;
    for (const pc of set) if (Math.abs(pc.p.z - z) < 0.3) top = Math.max(top, pc.p.y + pc.half);
    return new THREE.Vector3(5, top, z);
  };

  // dry-stone wall (dol-dam)
  const wallStones = [];
  for (let x = -26; x < -12; x += 0.62) {
    for (let row = 0; row < 3; row++) {
      const xx = x + (row % 2) * 0.3 + (R() - 0.5) * 0.1;
      const z = -1 + (R() - 0.5) * 0.15;
      const s = new THREE.Vector3(0.32 + R() * 0.12, 0.26 + R() * 0.08, 0.3 + R() * 0.1);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(R() * 3, R() * 3, R() * 3));
      wallStones.push(addPiece('stone', new THREE.Vector3(xx, groundH(xx, z) + 0.25 + row * 0.42, z), q, s, 0.26));
    }
  }

  // instanced meshes for the two kinds
  const colGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1);
  const stoneGeo = new THREE.DodecahedronGeometry(1, 0);
  const stoneMat = extend(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), {
    varyings: 'varying float vId;',
    vertex: 'vId = float(gl_InstanceID);',
    color: `diffuseColor.rgb = mix(vec3(0.05,0.045,0.05), vec3(0.16,0.15,0.14), fbm3(vL*1.5+vId)); hgt = vn3(vL*3.+vId*3.);`,
    bump: 0.8,
  });
  const cols = pieces.filter((p) => p.kind === 'col');
  const stones = pieces.filter((p) => p.kind === 'stone');
  const colMesh = new THREE.InstancedMesh(colGeo, basaltMat, cols.length);
  const stoneMesh = new THREE.InstancedMesh(stoneGeo, stoneMat, stones.length);
  for (const m of [colMesh, stoneMesh]) {
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    scene.add(m);
  }

  // break events: set release times and velocities
  const breakSet = (set, t0, origin, dirBias, speed, spread, delayPerM = 0) => {
    for (const pc of set) {
      const d = pc.p.clone().sub(origin);
      const dist = d.length();
      d.y = Math.max(d.y, 0.2);
      d.normalize().multiplyScalar(0.6).add(dirBias).normalize();
      pc.tr = t0 + dist * delayPerM + R() * 0.06;
      const sp = speed * (0.6 + R() * 0.6) * (1 + 0.15 * pc.p.y);
      pc.v0.copy(d).multiplyScalar(sp).add(new THREE.Vector3((R() - 0.5) * spread, R() * spread * 0.6, (R() - 0.5) * spread));
      pc.w = (R() - 0.5) * 14;
      pc.axis.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
    }
  };
  // tail sweep hits cluster A from its right (dragon side) and throws it left and toward the camera side
  breakSet(pillarSets.A, T.TAIL + 0.28, new THREE.Vector3(-6, 1.5, -15), new THREE.Vector3(-0.8, 0.35, 0.5), 11, 4, 0.03);
  // the breath sweep hits cluster B
  breakSet(pillarSets.B, T.PILLAR_HIT, new THREE.Vector3(9, 2.0, -17), new THREE.Vector3(0.5, 0.5, 0.6), 9, 5, 0.02);
  // the blast takes the stair, the wall and cluster D
  const blastGround = new THREE.Vector3(BLAST_AT.x, 0, BLAST_AT.z);
  const shock = (p) => T.BLAST + p.clone().setY(0).distanceTo(blastGround) / 70;
  for (const set of [pillarSets.C, pillarSets.D, wallStones]) {
    for (const pc of set) {
      const d = pc.p.clone().sub(blastGround).setY(0);
      const dist = d.length();
      d.normalize();
      pc.tr = shock(pc.p) + R() * 0.05;
      const sp = 26 / (1 + dist * 0.07);
      pc.v0.copy(d).multiplyScalar(sp * (0.7 + R() * 0.6));
      pc.v0.y = sp * (0.25 + R() * 0.35);
      pc.w = (R() - 0.5) * 12;
      pc.axis.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
    }
  }
  // precompute ballistic segments
  for (const pc of pieces) {
    if (!isFinite(pc.tr)) continue;
    const segs = [];
    let p = pc.p.clone(), v = pc.v0.clone(), tt = pc.tr;
    for (let b = 0; b < 3; b++) {
      const gy = Math.max(groundH(p.x + v.x * 0.5, p.z + v.z * 0.5), SEA_Y) + pc.half * 0.8;
      // solve p.y + v.y*τ + G/2 τ² = gy
      const A = 0.5 * G, B = v.y, C = p.y - gy;
      const disc = B * B - 4 * A * C;
      let tau = disc > 0 ? (-B - Math.sqrt(disc)) / (2 * A) : 0.5;
      if (!(tau > 0.02)) tau = 0.02;
      segs.push({ t0: tt, p: p.clone(), v: v.clone(), dur: tau });
      const hit = p.clone().addScaledVector(v, tau);
      hit.y += 0.5 * G * tau * tau;
      const vy = v.y + G * tau;
      tt += tau;
      p = hit;
      v = new THREE.Vector3(v.x * 0.45, -vy * 0.32, v.z * 0.45);
      if (b === 0) W.bursts.push({ p: hit.clone(), t: tt, s: Math.min(1.4, pc.half * 0.9 + 0.2), kind: 'dust' });
    }
    pc.segs = segs;
    pc.rest = { p, t: tt };
  }
  // dust where things break
  W.bursts.push({ p: new THREE.Vector3(-10, 1, -12), t: T.TAIL + 0.28, s: 3.5, kind: 'dust' });
  W.bursts.push({ p: new THREE.Vector3(11, 1, -16), t: T.PILLAR_HIT, s: 3.2, kind: 'dust' });

  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpQ2 = new THREE.Quaternion();
  const poseAt = (pc, t, outP, outQ) => {
    if (!(t >= pc.tr)) {
      outP.copy(pc.p);
      outQ.copy(pc.q);
      return;
    }
    let tau = t - pc.tr;
    const last = pc.segs[pc.segs.length - 1];
    if (t >= pc.rest.t) {
      outP.copy(pc.rest.p);
      tau = pc.rest.t - pc.tr;
    } else {
      let s = pc.segs[0];
      for (const sg of pc.segs) if (t >= sg.t0) s = sg;
      const d = t - s.t0;
      outP.copy(s.p).addScaledVector(s.v, d);
      outP.y += 0.5 * G * d * d;
    }
    tmpQ2.setFromAxisAngle(pc.axis, pc.w * Math.min(tau, (last.t0 - pc.tr) + last.dur * 0.5));
    outQ.copy(tmpQ2).multiply(pc.q);
  };
  W.updatePieces = (t) => {
    let i = 0;
    for (const pc of cols) {
      poseAt(pc, t, tmpP, tmpQ);
      tmpM.compose(tmpP, tmpQ, pc.s);
      colMesh.setMatrixAt(i++, tmpM);
    }
    i = 0;
    for (const pc of stones) {
      poseAt(pc, t, tmpP, tmpQ);
      tmpM.compose(tmpP, tmpQ, pc.s);
      stoneMesh.setMatrixAt(i++, tmpM);
    }
    colMesh.instanceMatrix.needsUpdate = true;
    stoneMesh.instanceMatrix.needsUpdate = true;
  };

  // ---------- lamps ----------
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.45, metalness: 0.8 });
  const lampHeadMat = (k) => new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1.0, 0.62, 0.3), emissiveIntensity: k });
  const lamps = [];
  const mkLamp = (x, z, fall) => {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 5, 10), poleMat);
    pole.position.y = 2.5;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0.45, 4.9, 0);
    const hm = lampHeadMat(6);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.28, 0.3, 12), hm);
    head.position.set(0.9, 4.8, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.4, 10), poleMat);
    base.position.y = 0.2;
    g.add(pole, arm, head, base);
    g.traverse((o) => (o.castShadow = true));
    const pivot = new THREE.Group();
    pivot.position.set(x, groundH(x, z), z);
    pivot.add(g);
    scene.add(pivot);
    const L = { pivot, g, hm, fall, x, z };
    lamps.push(L);
    return L;
  };
  // fall: [t0, dirAngle, maxTilt, off]
  mkLamp(-12, -16, [T.LAMP_HIT, -2.3, 1.45, true]);
  mkLamp(12.5, -5, [T.BLAST + 13 / 70, 0.3, 0.9, true]);
  mkLamp(-14, 6, [T.BLAST + 22 / 70, 2.5, 0.55, false]);
  mkLamp(13, 11, [Infinity, 0, 0, false]);
  lamps.forEach((L) => (L.g.rotation.y = Math.atan2(-L.z, -L.x) * -1));
  W.lamps = lamps;
  W.updateLamps = (t) => {
    const storm = stormAt(t);
    for (const L of lamps) {
      const [t0, dir, tilt, off] = L.fall;
      const k = t >= t0 ? Math.min(1, Math.pow((t - t0) / 0.9, 2)) : 0;
      // falls fast, rings once on the ground
      const bounce = t >= t0 + 0.9 ? 0.05 * Math.exp(-(t - t0 - 0.9) * 6) * Math.sin((t - t0 - 0.9) * 30) : 0;
      L.pivot.rotation.set(0, 0, 0);
      L.pivot.rotateY(dir);
      L.pivot.rotateZ(-(k * tilt + bounce));
      const roarFlicker = t > T.ROAR && t < T.ROAR_END ? 0.5 + 0.5 * Math.sign(Math.sin(t * 37 + L.x)) : 1;
      let e = (3 + 3 * storm) * roarFlicker;
      if (off && t >= t0) e *= Math.max(0, 1 - (t - t0) * 4) + (t - t0 < 0.4 ? 3 * Math.abs(Math.sin((t - t0) * 60)) : 0);
      L.hm.emissiveIntensity = e;
    }
  };

  // ---------- bench (one rigid piece, blown by the blast) ----------
  {
    const bench = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x4a2f22, roughness: 0.7 });
    const iron = poleMat;
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.14), wood);
      b.position.set(0, 0.45, -0.18 + i * 0.18);
      bench.add(b);
      const bb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.04), wood);
      bb.position.set(0, 0.62 + i * 0.14, -0.3);
      bench.add(bb);
    }
    for (const sx of [-0.8, 0.8]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.45, 0.5), iron);
      l.position.set(sx, 0.22, -0.05);
      bench.add(l);
    }
    bench.traverse((o) => (o.castShadow = o.receiveShadow = true));
    scene.add(bench);
    const home = new THREE.Vector3(7, 0.05, 6);
    const pc = { p: home.clone(), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.6, 0)), half: 0.3, tr: Infinity, v0: new THREE.Vector3(), w: 6, axis: new THREE.Vector3(0.3, 0.2, 1).normalize() };
    const d = home.clone().sub(blastGround).setY(0);
    pc.tr = T.BLAST + d.length() / 70;
    pc.v0.copy(d.normalize().multiplyScalar(9)).setY(6);
    // reuse the ballistic solver
    const segs = [];
    let p = pc.p.clone(), v = pc.v0.clone(), tt = pc.tr;
    for (let b = 0; b < 3; b++) {
      const A = 0.5 * G, B = v.y, C = p.y - 0.05;
      let tau = (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A);
      if (!(tau > 0.02)) tau = 0.02;
      segs.push({ t0: tt, p: p.clone(), v: v.clone(), dur: tau });
      const hit = p.clone().addScaledVector(v, tau);
      hit.y = 0.05;
      const vy = v.y + G * tau;
      tt += tau;
      p = hit;
      v = new THREE.Vector3(v.x * 0.45, -vy * 0.3, v.z * 0.45);
    }
    pc.segs = segs;
    pc.rest = { p, t: tt };
    W.updateBench = (t) => {
      poseAt(pc, t, bench.position, bench.quaternion);
    };
  }

  // ---------- frost decal state ----------
  W.frostU = terrainMat.userData.u.uFrost;

  W.update = (t, camera) => {
    const storm = stormAt(t), fl = flashAt(t);
    for (const u of [skyU]) {
      u.uStorm.value = storm;
      u.uFlash.value = fl;
      u.uTime.value = t;
    }
    W.sky.position.copy(camera.position);
    W.seaU.uCam.value.copy(camera.position);
    W.grassU.uTime.value = t;
    W.grassU.uWind.value = windAt(t);
    // blast front for grass/sea
    const bk = t - T.BLAST;
    const bw = bk > 0 && bk < 4 ? Math.max(0, 1 - bk / 3.5) : 0;
    W.grassU.uBlast.value.set(BLAST_AT.x, BLAST_AT.z, bk * 70, bw);
    W.seaU.uBlast.value.set(BLAST_AT.x, BLAST_AT.z, bk * 70, bw * 0.6);
    // frost: from the breath, stays and slowly melts
    const fw = 0.8 * sstep(T.BREATH + 0.3, T.BREATH + 2, t) * (1 - 0.85 * sstep(T.BREATH_END + 2, T.BREATH_END + 16, t));
    W.frostU.value.set(-1.5, -8.5, 3 + 3 * sstep(T.BREATH, T.BREATH_END, t), fw);
    W.updatePieces(t);
    W.updateLamps(t);
    W.updateBench(t);
  };
  return W;
}
