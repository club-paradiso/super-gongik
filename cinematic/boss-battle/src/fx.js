// Effects. Every particle's position, size and colour is evaluated in the vertex shader from film
// time and per-particle seeds, so the effects are stateless and frame-exact like everything else.
import * as THREE from "three";
import { NOISE } from "./glsl.js";
import { T, STRIKES, flashAt, stormAt, windAt } from "./timeline.js";
import { rng, win, pulse, sstep, clamp, lerp, keyed, track } from "./util.js";
import { SUN_DIR, BLAST_AT, groundH } from "./world.js";

const SPRITE = /* glsl */ `
  float soft(vec2 pc){ float r = length(pc - 0.5) * 2.; return smoothstep(1., 0.0, r); }
`;

// ---------------- event-driven bursts ----------------
// kinds: 0 dust (alpha), 1 sparks (additive), 2 seal energy (additive), 3 debris grit (alpha)
function burstSystem(events, perEvent, additive, seed) {
  const R = rng(seed);
  const n = events.reduce((a, e) => a + Math.round(perEvent * (e.n || 1)), 0);
  const ev = new Float32Array(n * 4),
    pr = new Float32Array(n * 4),
    sd = new Float32Array(n * 4);
  let k = 0;
  for (const e of events) {
    const m = Math.round(perEvent * (e.n || 1));
    for (let i = 0; i < m; i++, k++) {
      ev.set([e.p.x, e.p.y, e.p.z, e.t + R() * (e.spread || 0.05)], k * 4);
      pr.set(
        [e.s || 1, e.kind || 0, e.dir ? e.dir.x : 0, e.dir ? e.dir.z : 0],
        k * 4,
      );
      sd.set([R(), R(), R(), R()], k * 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(n * 3), 3),
  );
  g.setAttribute("aEv", new THREE.BufferAttribute(ev, 4));
  g.setAttribute("aPr", new THREE.BufferAttribute(pr, 4));
  g.setAttribute("aSd", new THREE.BufferAttribute(sd, 4));
  const u = {
    uTime: { value: 0 },
    uPx: { value: 800 },
    uSunDir: { value: SUN_DIR.clone() },
    uStorm: { value: 0 },
    uSlow: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aEv, aPr, aSd; uniform float uTime, uPx, uStorm; uniform vec3 uSunDir;
      varying vec4 vCol; varying float vKind;
      void main(){
        float age = uTime - aEv.w; float kind = aPr.y; vKind = kind; float s = aPr.x;
        vec3 o = aEv.xyz; vec3 p = o; float size = 0.; vec4 col = vec4(0.);
        float a = aSd.x * 6.2832; float el = aSd.y;
        if (kind < 0.5) { // dust: radial ground-hugging puff that rises and spreads
          float life = 3.5 + 3.0 * aSd.z;
          if (age > 0. && age < life) {
            vec3 dir = normalize(vec3(cos(a), 0.15 + el * 0.5, sin(a)));
            dir.xz += aPr.zw * 0.8;
            float sp = (4.0 + 8.0 * aSd.w) * s;
            float dr = (1. - exp(-age * 2.2)) / 2.2;
            p = o + dir * sp * dr + vec3(0., 0.6 * age * (0.3 + aSd.z), 0.) + vec3(0.6, 0., 0.3) * age * 0.4;
            size = (0.5 + 1.4 * aSd.z) * s * (0.5 + age * 0.7);
            float k = age / life;
            col = vec4(vec3(0.36, 0.29, 0.29) * (0.65 + 0.5 * aSd.w), 0.2 * smoothstep(0., 0.08, k) * (1. - k) * (1. - k));
          }
        } else if (kind < 1.5) { // sparks: ballistic, hot, short-lived
          float life = 0.5 + 0.9 * aSd.z;
          if (age > 0. && age < life) {
            vec3 dir = normalize(vec3(cos(a) * (1.-el), el * 1.4 + 0.2, sin(a) * (1.-el)));
            float sp = (7.0 + 14.0 * aSd.w) * s;
            p = o + dir * sp * age + vec3(0., -6.0 * age * age, 0.);
            size = 0.05 + 0.06 * aSd.z;
            float k = age / life;
            col = vec4(mix(vec3(6., 4.2, 2.2), vec3(3., 0.6, 0.1), k), 1. - k);
          }
        } else if (kind < 2.5) { // seal energy: red-gold sphere shell + embers
          float life = 1.8 + 1.6 * aSd.z;
          if (age > 0. && age < life) {
            vec3 dir = normalize(vec3(cos(a) * sqrt(1.-(el*2.-1.)*(el*2.-1.)), el * 2. - 1., sin(a) * sqrt(1.-(el*2.-1.)*(el*2.-1.))));
            float sp = (14.0 + 30.0 * aSd.w) * s;
            float dr = (1. - exp(-age * 1.8)) / 1.8;
            p = o + dir * sp * dr + vec3(0., -1.0 * age * age, 0.);
            size = (0.12 + 0.25 * aSd.z) * (1. - age / life * 0.5);
            float k = age / life;
            col = vec4(mix(vec3(7., 2.2, 0.8), vec3(2.5, 0.3, 0.1), k), (1. - k));
          }
        } else { // grit: small stones thrown up
          float life = 1.4 + 0.6 * aSd.z;
          if (age > 0. && age < life) {
            vec3 dir = normalize(vec3(cos(a), 0.8 + el * 1.5, sin(a)));
            float sp = (4.0 + 6.0 * aSd.w) * s;
            p = o + dir * sp * age + vec3(0., -9.8 * 0.5 * age * age, 0.);
            p.y = max(p.y, o.y - 0.5);
            size = 0.03 + 0.05 * aSd.z;
            col = vec4(vec3(0.06), 1. - age / life);
          }
        }
        vCol = col;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size > 0. ? clamp(size * uPx / -mv.z, 1.5, 300.) : 0.;
        if (size <= 0.) gl_Position = vec4(2., 2., 2., 1.);
      }`,
    fragmentShader: `${SPRITE} varying vec4 vCol; varying float vKind; uniform vec3 uSunDir;
      void main(){
        float m = soft(gl_PointCoord);
        if (vKind > 2.5) m = step(length(gl_PointCoord - .5), .5);
        if (m * vCol.a < 0.003) discard;
        gl_FragColor = vec4(vCol.rgb, vCol.a * m);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { pts, u };
}

export function buildFx(scene, world, dragon, agent) {
  const F = { lights: {} };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------- events ----------
  const dust = [];
  const sparks = [];
  for (const b of world.bursts)
    dust.push({ p: b.p, t: b.t, s: b.s * 0.8, kind: 0, n: 0.4 });
  // big set pieces
  dust.push({ p: V(-2, 0.3, -21), t: T.LAND, s: 2.4, kind: 0, n: 3 });
  dust.push({ p: V(2, 0.3, -21), t: T.LAND + 0.05, s: 2.4, kind: 0, n: 3 });
  dust.push({
    p: V(0, 0.4, -27),
    t: T.ROAR + 0.4,
    s: 2.2,
    kind: 0,
    n: 1.2,
    spread: 2.0,
  });
  for (let i = 0; i < 6; i++)
    dust.push({
      p: V(lerp(-1.6, -3.0, i / 5), 0.2, lerp(-11, -14.4, i / 5)),
      t: 36.95 + i * 0.1,
      s: 0.7,
      kind: 0,
      n: 0.6,
    });
  dust.push({ p: V(-3, 0.3, -14.8), t: T.CLAW, s: 1.2, kind: 0, n: 1.2 });
  for (let i = 0; i < 7; i++)
    dust.push({
      p: V(lerp(-2.6, -1.5, i / 6), 0.2, lerp(-13.6, -7.2, i / 6)),
      t: 42.2 + i * 0.12,
      s: 0.8,
      kind: 0,
      n: 0.7,
      dir: V(0, 0, 0.5),
    });
  dust.push({ p: V(0, 0.3, -25), t: T.TAKEOFF + 0.25, s: 3.4, kind: 0, n: 4 });
  dust.push({ p: V(0, 0.3, -14), t: T.BLAST + 0.12, s: 4.5, kind: 0, n: 6 });
  dust.push({ p: V(0.8, 0.2, -9.2), t: 70.55, s: 1.6, kind: 0, n: 1.5 });
  dust.push({ p: V(0, 0.3, -27), t: T.RELAND, s: 2.0, kind: 0, n: 2 });
  dust.push({ p: V(0, 0.3, -26), t: 81.2, s: 2.6, kind: 0, n: 2.5 });
  sparks.push({ p: V(-2.95, 2.0, -14.5), t: T.CLAW, s: 1, kind: 1, n: 3 });
  sparks.push({ p: V(-2.3, 1.8, -13.0), t: T.KNOCK, s: 0.8, kind: 1, n: 2 });
  sparks.push({ p: V(-12, 4.5, -16), t: T.LAMP_HIT, s: 0.7, kind: 1, n: 2 });
  sparks.push({
    p: V(-12, 0.4, -16),
    t: T.LAMP_HIT + 0.85,
    s: 0.5,
    kind: 1,
    n: 1,
  });
  sparks.push({ p: V(0, 13, -13), t: T.SLAM, s: 1.5, kind: 1, n: 4 });
  sparks.push({ p: V(0, 13, -13), t: T.SLAM, s: 1.0, kind: 2, n: 9 });
  sparks.push({
    p: V(-1.5, 1.2, -7.8),
    t: T.BREATH + 0.2,
    s: 0.9,
    kind: 1,
    n: 2,
    spread: 5,
  });
  dust.push({ p: V(-10, 0.4, -12), t: T.TAIL + 0.28, s: 1.2, kind: 3, n: 2 });
  dust.push({ p: V(11, 1, -16), t: T.PILLAR_HIT, s: 1.2, kind: 3, n: 2 });
  const dustSys = burstSystem(dust, 60, false, 11);
  const sparkSys = burstSystem(sparks, 120, true, 12);
  scene.add(dustSys.pts, sparkSys.pts);
  F.sys = [dustSys, sparkSys];

  // ---------- ambient embers & motes ----------
  {
    const N = 2500,
      R = rng(21);
    const sd = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) sd[i] = R();
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(N * 3), 3),
    );
    g.setAttribute("aSd", new THREE.BufferAttribute(sd, 4));
    const u = {
      uTime: { value: 0 },
      uPx: { value: 800 },
      uCam: { value: new THREE.Vector3() },
      uEmber: { value: 0 },
      uWind: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec4 aSd; uniform float uTime, uPx, uEmber, uWind; uniform vec3 uCam; varying vec4 vCol;
        void main(){
          vec3 box = vec3(50., 24., 50.);
          vec3 p = vec3(aSd.x, aSd.y, aSd.z) * box;
          p += vec3(1.4, 0.35 + 0.4 * aSd.w, 0.6) * uTime * (0.4 + uWind);
          p.x += sin(uTime * 0.7 + aSd.w * 30.) * 0.8;
          p = mod(p - uCam + box * 0.5, box) + uCam - box * 0.5;
          p.y = max(p.y, 0.2);
          bool ember = aSd.w > 0.72;
          float tw = 0.6 + 0.4 * sin(uTime * (3. + aSd.x * 5.) + aSd.y * 40.);
          vCol = ember ? vec4(vec3(3.2, 1.0, 0.35) * tw, uEmber) : vec4(vec3(0.5, 0.36, 0.28), 0.35);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp((ember ? 0.06 : 0.035) * uPx / -mv.z, 1., 6.);
        }`,
      fragmentShader: `${SPRITE} varying vec4 vCol; void main(){ float m = soft(gl_PointCoord); gl_FragColor = vec4(vCol.rgb, vCol.a * m); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    F.amb = u;
  }

  // ---------- breath: particle stream + beam core ----------
  const breathU = {
    uTime: { value: 0 },
    uPx: { value: 800 },
    uA: { value: new THREE.Vector3() },
    uB: { value: new THREE.Vector3() },
    uN: { value: new THREE.Vector3(0, 0, 1) },
    uD: { value: new THREE.Vector3() },
    uDefl: { value: 0 },
    uOn: { value: 0 },
  };
  {
    const N = 4500,
      R = rng(31);
    const sd = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) sd[i] = R();
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(N * 3), 3),
    );
    g.setAttribute("aSd", new THREE.BufferAttribute(sd, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: breathU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `attribute vec4 aSd; uniform float uTime, uPx, uDefl, uOn; uniform vec3 uA, uB, uN, uD; varying vec4 vCol;
        ${NOISE}
        void main(){
          float life = 0.55;
          float age = mod(uTime + aSd.x * life, life);
          vec3 ab = uB - uA; float L = length(ab); vec3 dir = ab / L;
          vec3 side = normalize(cross(dir, vec3(0.,1.,0.))); vec3 up = cross(side, dir);
          float speed = 34.;
          float s = age * speed;
          vec3 p; vec3 c;
          float a = aSd.y * 6.2832; float rr = sqrt(aSd.z);
          if (s < L) {
            float k = s / L;
            float w = (0.12 + 0.75 * k) * rr;
            p = uA + dir * s + (side * cos(a) + up * sin(a)) * w;
            p += vec3(vn3(p * 0.8 + uTime * 6.), vn3(p * 0.8 - uTime * 5.), 0.) * 0.4 * k;
            c = mix(vec3(3.5, 5.0, 6.0), vec3(0.6, 1.7, 4.2), k) * 0.22;
          } else {
            // spray off the ward: a sheet around the disc, biased toward the deflection target
            float t2 = (s - L) / speed;
            vec3 rim = (side * cos(a) + up * sin(a));
            vec3 out1 = normalize(rim * 1.3 - dir * 0.6 + vec3(0., 0.15, 0.));
            vec3 out2 = normalize(uD - uB + rim * 2.0);
            vec3 v = normalize(mix(out1, out2, uDefl * step(0.35, aSd.w)));
            float sp = (18. + 12. * aSd.w) * mix(1., 1.6, uDefl * step(0.35, aSd.w));
            p = uB + rim * 1.15 + v * sp * t2 + vec3(0., -2. * t2 * t2, 0.);
            c = vec3(0.9, 2.2, 4.0) * max(0., 1. - t2 * 2.5) * 0.25;
          }
          float sz = (0.12 + 0.3 * aSd.w) * uOn * (s < L ? 1. : 0.6);
          vCol = vec4(c, 0.28 * uOn);
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uOn > 0.001 ? clamp(sz * uPx / -mv.z, 1., 220.) : 0.;
          if (uOn < 0.001) gl_Position = vec4(2.,2.,2.,1.);
        }`,
      fragmentShader: `${SPRITE} varying vec4 vCol; void main(){ float m = soft(gl_PointCoord); m *= m; gl_FragColor = vec4(vCol.rgb, vCol.a * m); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }
  // beam cores (main + deflected): unit cylinder along +y, scaled/oriented per frame
  const beamMat = (col) =>
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOn: { value: 0 },
        uCol: { value: col },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uTime, uOn; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying vec2 vUv; ${NOISE}
        void main(){
          float f = abs(dot(normalize(vN), vV));
          float core = pow(f, 3.0);
          float n = fbm2(vec2(vUv.x * 6., vUv.y * 10. - uTime * 30.));
          vec3 c = uCol * (0.4 + 1.6 * n) * (0.3 + core * 2.5) + vec3(1.6, 2.0, 2.4) * pow(f, 12.);
          float a = uOn * (0.35 + 0.65 * n) * smoothstep(0., 0.04, vUv.y) * smoothstep(1., 0.9, vUv.y);
          gl_FragColor = vec4(c * a, 1.);
        }`,
    });
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 16, true).translate(
    0,
    0.5,
    0,
  );
  const beam = new THREE.Mesh(
    beamGeo,
    beamMat(new THREE.Vector3(0.35, 0.9, 1.8)),
  );
  const beam2 = new THREE.Mesh(
    beamGeo,
    beamMat(new THREE.Vector3(0.3, 0.8, 1.7)),
  );
  beam.frustumCulled = beam2.frustumCulled = false;
  scene.add(beam, beam2);

  // ward disc projected by the seal
  const wardU = { uTime: { value: 0 }, uOn: { value: 0 }, uHit: { value: 0 } };
  const ward = new THREE.Mesh(
    new THREE.CircleGeometry(1.35, 64),
    new THREE.ShaderMaterial({
      uniforms: wardU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy / 1.35; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: /* glsl */ `uniform float uTime, uOn, uHit; varying vec2 vP; ${NOISE}
        void main(){
          float r = length(vP); float a = atan(vP.y, vP.x);
          float rings = smoothstep(0.03, 0.0, abs(r - 0.95)) + smoothstep(0.02, 0.0, abs(r - 0.78)) * 0.8 + smoothstep(0.015, 0., abs(r - 0.55)) * 0.6;
          float sq = max(abs(vP.x), abs(vP.y));
          vec2 rp = mat2(cos(uTime), -sin(uTime), sin(uTime), cos(uTime)) * vP;
          float sq2 = max(abs(rp.x), abs(rp.y));
          float glyph = smoothstep(0.02, 0., abs(sq2 - 0.5)) + smoothstep(0.02, 0., abs(sq - 0.38)) * 0.7;
          float ticks = step(0.8, fract(a * 12. / 6.2832 + uTime * 0.5)) * smoothstep(0.86, 0.9, r) * smoothstep(0.94, 0.9, r);
          float fill = (1. - smoothstep(0.0, 1.0, r)) * 0.08 * (0.6 + 0.4 * fbm2(vP * 5. + uTime * 3.));
          float ripple = uHit * 0.5 * (0.5 + 0.5 * sin(r * 30. - uTime * 40.)) * (1. - r);
          float m = (rings + glyph + ticks + fill + ripple) * smoothstep(1.0, 0.97, r);
          gl_FragColor = vec4(vec3(2.0, 0.45, 0.2) * m * uOn + vec3(0.5, 1.0, 1.5) * ripple * uOn * 0.4, 1.);
        }`,
    }),
  );
  ward.frustumCulled = false;
  scene.add(ward);

  // ---------- shockwaves ----------
  const shellU = { uR: { value: 0 }, uOn: { value: 0 } };
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: shellU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uOn; varying vec3 vN; varying vec3 vV; void main(){ float f = 1. - abs(dot(vN, vV)); gl_FragColor = vec4(vec3(3.0, 1.1, 0.5) * pow(f, 3.) * uOn, 1.); }`,
    }),
  );
  shell.position.copy(BLAST_AT);
  shell.frustumCulled = false;
  scene.add(shell);
  const ringU = { uOn: { value: 0 }, uTime: { value: 0 } };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringU,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: /* glsl */ `uniform float uOn, uTime; varying vec2 vUv; ${NOISE}
      void main(){ float k = vUv.y; float band = smoothstep(0., 0.35, k) * smoothstep(1., 0.6, k); float n = fbm2(vec2(vUv.x * 40., uTime * 3.));
        gl_FragColor = vec4(vec3(1.4, 0.9, 0.75) * band * (0.4 + n) * uOn, 1.); }`,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 96, 4), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.frustumCulled = false;
  scene.add(ring);

  // ---------- lightning ----------
  const bolts = [];
  {
    const R = rng(41);
    const boltMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(4, 4.4, 6),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    STRIKES.forEach((st, bi) => {
      const pts = [];
      const x0 = -80 + R() * 160,
        z0 = -260 - R() * 120;
      const top = V(x0, 110 + R() * 20, z0),
        bot = V(
          x0 + (R() - 0.5) * 60,
          bi % 2 ? -30 : 40 + R() * 20,
          z0 + (R() - 0.5) * 40,
        );
      const subdiv = (a, b, d, lvl) => {
        if (lvl === 0) {
          pts.push([a, b]);
          return;
        }
        const m = a
          .clone()
          .lerp(b, 0.5)
          .add(
            V((R() - 0.5) * d, (R() - 0.5) * d * 0.3, (R() - 0.5) * d * 0.5),
          );
        subdiv(a, m, d * 0.55, lvl - 1);
        subdiv(m, b, d * 0.55, lvl - 1);
        if (lvl > 3 && R() < 0.35) {
          const br = m
            .clone()
            .add(V((R() - 0.5) * d * 1.4, -d * 0.8, (R() - 0.5) * d));
          subdiv(m, br, d * 0.4, lvl - 2);
        }
      };
      subdiv(top, bot, 50, 6);
      const pos = [];
      for (const [a, b] of pts) {
        const w = 0.7;
        pos.push(
          a.x - w,
          a.y,
          a.z,
          a.x + w,
          a.y,
          a.z,
          b.x + w,
          b.y,
          b.z,
          a.x - w,
          a.y,
          a.z,
          b.x + w,
          b.y,
          b.z,
          b.x - w,
          b.y,
          b.z,
        );
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, boltMat.clone());
      m.frustumCulled = false;
      scene.add(m);
      bolts.push({ m, t: st });
    });
  }

  // ---------- cloud bank the dragon breaks out of ----------
  {
    const N = 110,
      R = rng(51);
    const g = new THREE.PlaneGeometry(1, 1);
    const ig = new THREE.InstancedBufferGeometry().copy(g);
    const off = new Float32Array(N * 4);
    const centers = [];
    for (let i = 0; i < N; i++) {
      const p = V(
        -50 + (R() - 0.5) * 220,
        66 + R() * 46,
        -215 + (R() - 0.5) * 90,
      );
      const s = 26 + R() * 34;
      centers.push({ p, s, r: R() });
    }
    ig.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 4));
    const rnd = new Float32Array(N);
    ig.setAttribute("aR", new THREE.InstancedBufferAttribute(rnd, 1));
    ig.instanceCount = N;
    const u = {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uStorm: { value: 0 },
      uFlash: { value: 0 },
      uFade: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      transparent: true,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `attribute vec4 aOff; attribute float aR; varying vec2 vP; varying float vR; varying float vH; varying vec3 vW;
        void main(){ vP = position.xy; vR = aR; vH = aOff.y;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 w = aOff.xyz + (right * position.x + up * position.y * 0.62) * aOff.w; vW = w;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: /* glsl */ `uniform float uTime, uStorm, uFlash, uFade; uniform vec3 uSunDir; varying vec2 vP; varying float vR; varying float vH; varying vec3 vW; ${NOISE}
        void main(){
          float r = length(vP) * 2.;
          float n = fbm2(vP * 3.0 + vR * 10. + uTime * 0.03);
          float d = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.9);
          if (d < 0.01) discard;
          float lit = clamp(0.5 + dot(normalize(vec3(vP.x, vP.y + 0.2, 0.3)), normalize(vec3(uSunDir.x, uSunDir.y * 3., 0.3))) * 0.6, 0., 1.);
          vec3 c = mix(vec3(0.16, 0.10, 0.22), vec3(1.5, 0.72, 0.45), lit * (0.5 + 0.5 * n));
          c *= mix(1., 0.32, uStorm);
          c += vec3(0.7, 0.75, 1.1) * uFlash * (0.4 + n) * 0.8;
          gl_FragColor = vec4(c, d * 0.88 * uFade);
        }`,
    });
    const clouds = new THREE.Mesh(ig, mat);
    clouds.frustumCulled = false;
    clouds.renderOrder = -1;
    scene.add(clouds);
    F.clouds = { u, centers, off, ig, rnd };
  }

  // ---------- lights driven by effects ----------
  const beamLight = new THREE.PointLight(
    new THREE.Color(0.45, 0.8, 1.0),
    0,
    40,
    1.6,
  );
  const sealLight = new THREE.PointLight(
    new THREE.Color(1.0, 0.3, 0.15),
    0,
    12,
    2,
  );
  scene.add(beamLight, sealLight);
  F.lights = { beamLight, sealLight };

  const wardTarget = keyed([
    [0, 0],
    [48.3, 0],
    [48.5, 1],
    [48.95, 1],
    [49.25, 0],
    [49.3, 0],
  ]);
  const DEFL = track([
    [45, -12, 4.2, -16],
    [48.3, -12, 4.2, -16],
    [48.9, -12, 3.6, -16],
    [49.3, 4, 2.5, -18],
    [49.6, 10.5, 2.5, -16.5],
    [50.5, 13, 2.0, -15],
  ]);
  const deflOn = (t) => win(t, 48.25, 50.3, 0.15, 0.3);
  F.update = (t, camera, px) => {
    for (const s of F.sys) {
      s.u.uTime.value = t;
      s.u.uPx.value = px;
    }
    F.amb.uTime.value = t;
    F.amb.uPx.value = px;
    F.amb.uCam.value.copy(camera.position);
    F.amb.uWind.value = windAt(t) * 0.5;
    F.amb.uEmber.value =
      0.25 +
      0.75 * sstep(T.BREATH, T.BREATH + 2, t) +
      0.8 * sstep(T.BLAST, T.BLAST + 1, t);

    // breath
    const on = win(t, T.BREATH, T.BREATH_END, 0.12, 0.35);
    const mouth = dragon.st.mouth;
    const wardP = agent.st.seal.clone().addScaledVector(agent.st.sealN, 0.55);
    // the ward faces the dragon's mouth
    const wardN = mouth.clone().sub(wardP).normalize();
    breathU.uTime.value = t;
    breathU.uPx.value = px;
    breathU.uA.value.copy(mouth);
    breathU.uB.value.copy(wardP);
    breathU.uN.value.copy(wardN);
    breathU.uOn.value = on;
    const dfl = deflOn(t);
    const dp = DEFL(t);
    breathU.uD.value.set(dp[0], dp[1], dp[2]);
    breathU.uDefl.value = dfl;
    const orient = (mesh, a, b, r) => {
      const d = b.clone().sub(a);
      const L = d.length();
      mesh.position.copy(a);
      mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
      mesh.scale.set(r, L, r);
    };
    orient(beam, mouth, wardP, 0.35 + 0.08 * Math.sin(t * 40));
    beam.material.uniforms.uOn.value = on;
    beam.material.uniforms.uTime.value = t;
    orient(beam2, wardP, breathU.uD.value.clone(), 0.28);
    beam2.material.uniforms.uOn.value = on * dfl;
    beam2.material.uniforms.uTime.value = t;
    beam.visible = on > 0.001;
    beam2.visible = on * dfl > 0.001;
    // ward
    const wOn = win(t, 44.6, 50.8, 0.35, 0.5);
    ward.position.copy(wardP);
    ward.lookAt(mouth);
    ward.visible = wOn > 0.001;
    wardU.uOn.value = wOn * (1 + 0.6 * on);
    wardU.uHit.value = on;
    wardU.uTime.value = t;
    beamLight.position.copy(wardP).addScaledVector(wardN, 1.0);
    beamLight.intensity =
      on * (25 + 8 * Math.sin(t * 50)) + 10 * dragon.st.throat;
    // seal light: hammer glow, huge at the slam
    sealLight.position.copy(agent.st.seal);
    sealLight.intensity =
      agent.st.glow * 0.35 + 900 * pulse(t, T.SLAM, 0.02, 0.35);
    sealLight.distance = 12 + 40 * pulse(t, T.SLAM, 0.02, 0.6);

    // shock shell and ground ring
    const bk = t - T.BLAST;
    if (bk > 0 && bk < 1.6) {
      shell.visible = true;
      shell.scale.setScalar(2 + bk * 55);
      shellU.uOn.value = Math.pow(1 - bk / 1.6, 2) * 1.5;
    } else shell.visible = false;
    const rk = t - (T.BLAST + 0.12);
    const lk = t - T.LAND;
    if (rk > 0 && rk < 2.5) {
      ring.visible = true;
      ring.position.set(0, 0.35, -13);
      ring.scale.setScalar(1 + rk * 50);
      ringU.uOn.value = Math.pow(1 - rk / 2.5, 1.5) * 2;
    } else if (lk > 0 && lk < 1.4) {
      ring.visible = true;
      ring.position.set(0, 0.3, -24);
      ring.scale.setScalar(2 + lk * 22);
      ringU.uOn.value = Math.pow(1 - lk / 1.4, 2) * 0.8;
    } else ring.visible = false;
    ringU.uTime.value = t;

    // lightning
    for (const b of bolts) {
      const d = t - b.t;
      const e =
        d >= 0 && d < 0.6
          ? Math.exp(-d / 0.05) +
            (d > 0.1 ? 0.7 * Math.exp(-(d - 0.1) / 0.04) : 0)
          : 0;
      b.m.material.opacity = Math.min(1, e);
      b.m.visible = e > 0.01;
    }

    // clouds: sort back to front each frame (stable, pure function of camera)
    const C = F.clouds;
    C.u.uTime.value = t;
    C.u.uStorm.value = stormAt(t);
    C.u.uFlash.value = flashAt(t);
    C.u.uFade.value = 1;
    const order = C.centers
      .map((c, i) => [c.p.distanceToSquared(camera.position), i])
      .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    order.forEach(([, i], k) => {
      const c = C.centers[i];
      C.off.set([c.p.x + Math.sin(t * 0.05 + i) * 3, c.p.y, c.p.z, c.s], k * 4);
      C.rnd[k] = c.r;
    });
    C.ig.attributes.aOff.needsUpdate = true;
    C.ig.attributes.aR.needsUpdate = true;
  };
  return F;
}
