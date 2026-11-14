// The edit. One function per shot; each returns lens position, aim point, field of view and roll from
// film time and the actors' current state (positions are read after the actors update, so framing
// tracks the action exactly).
import * as THREE from 'three';
import { shotAt, shakeVec, T } from './timeline.js';
import { lerp, sstep, easeInOut, clamp, tnoise } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const L = (a, b, k) => a.clone().lerp(b, k);
// gentle hand-held drift
const drift = (t, a = 0.04) => V(tnoise(t, 0.6, 7) * a, tnoise(t, 0.5, 8) * a, tnoise(t, 0.55, 9) * a);

const SHOT = {
  sea: ({ k }) => ({ pos: L(V(120, 34, -150), V(78, 22, -105), easeInOut(k)), look: L(V(-10, -6, -30), V(-4, -2, -18), k), fov: 40 }),
  agentIntro: ({ k, A, t }) => ({ pos: A.root.clone().add(V(lerp(3.4, 2.4, k), 1.15, lerp(5.2, 3.6, k))).add(drift(t)), look: A.root.clone().add(V(-2.0, 2.2, -9)), fov: 42 }),
  storm: ({ k, t }) => ({ pos: V(2.6, 0.45, 4.6).add(drift(t, 0.03)), look: L(V(-12, 30, -100), V(-22, 44, -130), k), fov: 52 }),
  faceUp: ({ k, A }) => ({ pos: A.face.clone().add(V(0.38, -0.28, lerp(-0.95, -0.85, k))), look: A.face.clone().add(V(0, 0.04, 0)), fov: 34 }),
  cloud: ({ k }) => ({ pos: V(0.5, 2.0, 4), look: L(V(-48, 78, -215), V(-55, 76, -205), k), fov: 22 }),
  emerge: ({ k, D }) => ({ pos: L(V(-6, 62, -128), V(12, 46, -78), easeInOut(k)), look: D.chest.clone().lerp(D.head, 0.5), fov: 46 }),
  descend: ({ k, A, D, t }) => ({ pos: A.root.clone().add(V(-2.4, lerp(1.7, 1.4, k), 5.6)).add(drift(t)), look: L(D.chest.clone().lerp(V(0, 6, -25), 0.4), V(0, 5.5, -24), sstep(0.6, 1, k)), fov: 50 }),
  feet: ({ k, D }) => ({ pos: D.feet[0].clone().lerp(D.feet[1], 0.5).add(V(lerp(5.0, 4.4, k), 1.3, 6.5)), look: D.feet[0].clone().lerp(D.feet[1], 0.5).add(V(0, 1.2, 0)), fov: 40 }),
  roar: ({ k, D }) => ({ pos: L(V(7.5, 1.4, -7.5), V(6.5, 1.7, -9.8), k), look: D.head.clone().lerp(D.chest, 0.3), fov: 44 }),
  agentHold: ({ k, A, t }) => ({ pos: A.root.clone().add(V(-1.5, 1.45, lerp(-3.3, -2.9, k))).add(drift(t, 0.02)), look: A.chest.clone().add(V(0, 0.25, 0)), fov: 38 }),
  eye: ({ k, D }) => {
    const side = new THREE.Vector3().crossVectors(D.headUp, D.headFwd).normalize();
    return { pos: D.eyeR.clone().addScaledVector(side, -lerp(1.7, 1.25, k)).addScaledVector(D.headFwd, 0.9).addScaledVector(D.headUp, 0.15), look: D.eyeR.clone(), fov: 30 };
  },
  draw: ({ k, A }) => {
    const a = lerp(-0.75, -0.25, easeInOut(k)) * Math.PI;
    return { pos: A.root.clone().add(V(Math.cos(a) * 2.6, 0.55, Math.sin(a) * 2.6)), look: A.chest.clone().add(V(0, 0.2, 0)), fov: 40 };
  },
  charge: ({ A, t }) => ({ pos: A.root.clone().add(V(2.6, 1.0, 1.2)).add(drift(t, 0.06)), look: A.root.clone().add(V(-0.5, 1.6, -7)), fov: 46 }),
  tail: ({ k }) => ({ pos: L(V(7, 10, 9), V(6, 9, 7), k), look: V(-5, 1.0, -16), fov: 56 }),
  look: ({ A, D }) => ({ pos: A.root.clone().add(V(1.3, 0.8, 2.4)), look: D.head.clone(), fov: 46 }),
  parry: ({ k }) => ({ pos: L(V(2.6, 2.1, -10.0), V(2.2, 2.3, -10.6), k), look: V(-3, 2.8, -15.2), fov: 46 }),
  knock: ({ A }) => ({ pos: V(-0.4, 0.65, -3.4), look: A.chest.clone(), fov: 44 }),
  inhale: ({ k, D }) => ({ pos: L(V(7, 2.4, -13.5), V(6.2, 2.6, -14.5), k), look: D.chest.clone().lerp(D.head, 0.55), fov: 46 }),
  breathOTS: ({ A, D, t }) => ({ pos: A.head.clone().add(V(0.95, 0.35, 2.3)).add(drift(t, 0.05)), look: D.mouth.clone().lerp(A.head, 0.25), fov: 46 }),
  breathWide: ({ k }) => ({ pos: L(V(17, 4.2, -4.5), V(16, 4.6, -6.5), k), look: V(-2.5, 2.6, -13.5), fov: 50 }),
  takeoff: ({ k, D }) => ({ pos: V(-4.5, 1.0, 2.5), look: D.chest.clone().lerp(V(0, 6, -20), 0.3), fov: 52 }),
  flyby: ({ k, D }) => {
    const back = D.headFwd.clone().setY(0).normalize();
    const side = V(-back.z, 0, back.x);
    return { pos: D.chest.clone().addScaledVector(back, -26).addScaledVector(side, 17).add(V(0, 7, 0)), look: D.chest.clone().lerp(D.head, 0.6), fov: 50 };
  },
  run: ({ A, D }) => ({ pos: A.root.clone().add(V(1.6, 1.4, 4.2)), look: A.root.clone().add(V(-0.4, 3.2, -6)), fov: 46 }),
  dive: ({ D }) => ({ pos: V(-17, 31, -46), look: D.head.clone(), fov: 46 }),
  columns: ({ k, A }) => ({ pos: V(lerp(15, 13, k), lerp(3.0, 5.5, k), -1.5), look: A.root.clone().add(V(0, 1.2, 0)), fov: 42 }),
  leap: ({ k, A, D }) => {
    const a = lerp(0.15, -0.35, easeInOut(k)) * Math.PI;
    const c = A.root.clone().add(V(0, 1.0, 0));
    return { pos: c.clone().add(V(Math.cos(a) * 5.2, -0.8, Math.sin(a) * 5.2 + 1)), look: c.clone().lerp(D.head, 0.35), fov: 42 };
  },
  slam: ({ k, D }) => ({ pos: D.brow.clone().add(V(lerp(3.6, 4.4, k), lerp(0.4, 1.2, k), lerp(2.4, 3.2, k))), look: D.brow.clone().add(V(0, -0.2, 0)), fov: 40 }),
  shockWide: ({ k }) => ({ pos: L(V(24, 15, 20), V(26, 17, 23), k), look: V(0, 5, -22), fov: 56 }),
  settle: ({ k, A, D }) => ({ pos: A.root.clone().add(V(lerp(2.6, 1.8, k), 1.6, lerp(6, 4.2, k))), look: D.chest.clone().lerp(A.root, 0.25).add(V(0, 1.5, 0)), fov: 44 }),
  bow: ({ k }) => ({ pos: L(V(8.8, 2.3, -11.5), V(8.0, 2.1, -12.2), k), look: V(0.2, 1.8, -13.6), fov: 38 }),
  depart: ({ k, A, D }) => ({ pos: A.root.clone().add(V(1.9, 0.45, 3.3)), look: A.root.clone().add(V(-1.0, 3.5, -10)).lerp(D.chest, 0.15 * k), fov: 52 }),
  end: ({ k, A, t }) => {
    const f = A.fwd;
    const side = V(-f.z, 0, f.x);
    return { pos: A.root.clone().addScaledVector(f, lerp(3.1, 2.6, k)).addScaledVector(side, 0.7).add(V(0, 1.6, 0)).add(drift(t, 0.02)), look: A.face.clone().addScaledVector(side, 0.55).add(V(0, -0.05, 0)), fov: 34 };
  },
};

// how much of the global shake each shot takes
const SHAKE = { roar: 0.25, feet: 0.3, tail: 0.6, parry: 0.15, knock: 0.15, breathOTS: 0.12, breathWide: 0.4, slam: 0.12, shockWide: 0.8, takeoff: 0.5, agentHold: 0.08, storm: 0.1, descend: 0.25 };

export function cameraAt(t, A, D, out) {
  const s = shotAt(t);
  const r = SHOT[s.name]({ ...s, t, A, D });
  const sh = shakeVec(t);
  const amt = SHAKE[s.name] ?? 0.1;
  r.pos.add(V(sh[0], sh[1], sh[2]).multiplyScalar(amt));
  r.look.add(V(sh[1], sh[2], sh[0]).multiplyScalar(amt * 1.5));
  out.position.copy(r.pos);
  out.up.set(0, 1, 0);
  out.lookAt(r.look);
  out.fov = r.fov;
  out.updateProjectionMatrix();
  return s;
}
