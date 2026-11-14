// The frozen beat sheet. Picture, effects and score all read these numbers, so a sound lands on the
// frame its picture does. Film time t is seconds; frame n is shown at t = n / FPS.
import { pulse, win, sstep, clamp, tnoise } from './util.js';

export const FPS = 30;
export const DUR = 90;
export const FRAMES = FPS * DUR;

export const T = {
  OPEN: 0.0, //       sea, sunset, the cliff
  AGENT: 4.5, //      the agent walks to the plaza edge (title 5.0-8.5)
  OMEN: 9.0, //       wind, cloud bank darkens, lightning
  SHADOW: 13.5, //    a shape moves inside the cloud
  DESCENT: 16.0, //   the white dragon breaks out of the cloud
  LAND: 22.0, //      it lands on the cliff edge
  ROAR: 23.6, ROAR_END: 26.4,
  STANDOFF: 26.5,
  EYE: 28.5,
  DRAW: 31.0, //      the seal-hammer is drawn and ignites
  CHARGE: 33.5,
  TAIL: 36.6, //      tail sweep: basalt columns shatter
  SLIDE: 37.0,
  CLAW: 40.4, //      claw strike, parried: sparks
  KNOCK: 42.2, //     second exchange: agent knocked back
  INHALE: 44.0,
  BREATH: 45.0, BREATH_END: 50.5,
  LAMP_HIT: 48.6, PILLAR_HIT: 49.6,
  TAKEOFF: 52.4,
  FLYBY: 53.5,
  RUN: 58.0,
  DIVE: 61.0,
  COLUMNS: 64.0,
  LEAP: 66.5,
  SLAM: 69.0, //      the seal lands on the dragon's brow
  BLAST: 69.08,
  RECOIL: 70.5,
  SETTLE: 73.0,
  RELAND: 76.5,
  BOW: 77.0,
  DEPART: 81.0,
  END: 85.0,
  TITLE2: 86.0,
  OUT: 88.6,
};

export const STRIKES = [10.25, 11.05, 12.6, 13.15, 15.7];

// lightning envelope (0..~2)
export function flashAt(t) {
  let f = 0;
  for (const s of STRIKES) {
    const d = t - s;
    if (d >= 0 && d < 0.8) f += Math.exp(-d / 0.06) + (d > 0.1 ? 0.6 * Math.exp(-(d - 0.1) / 0.05) : 0);
  }
  return f;
}

// storm darkness over the sunset 0..1
export const stormAt = (t) => 0.85 * win(t, T.OMEN - 0.5, T.ROAR_END + 2, 3, 6) + 0.25 * win(t, T.BREATH - 1, T.BREATH_END + 1, 1, 2);

// camera shake amplitude (metres-ish, scaled per shot)
export function shakeAt(t) {
  return (
    0.15 * flashAt(t) +
    1.0 * pulse(t, T.LAND, 0.04, 0.6) +
    0.8 * win(t, T.ROAR + 0.2, T.ROAR_END, 0.2, 0.5) +
    0.9 * pulse(t, T.TAIL + 0.25, 0.03, 0.5) +
    0.7 * pulse(t, T.CLAW, 0.02, 0.35) +
    0.5 * pulse(t, T.KNOCK, 0.02, 0.4) +
    0.35 * win(t, T.BREATH, T.BREATH_END, 0.2, 0.3) +
    0.6 * pulse(t, T.LAMP_HIT, 0.03, 0.4) +
    0.6 * pulse(t, T.PILLAR_HIT, 0.03, 0.4) +
    0.6 * pulse(t, T.TAKEOFF + 0.2, 0.05, 0.6) +
    1.6 * pulse(t, T.BLAST, 0.02, 0.9) +
    0.6 * pulse(t, T.RECOIL + 0.2, 0.05, 0.6)
  );
}
export const shakeVec = (t) => {
  const a = shakeAt(t);
  return [a * tnoise(t, 23, 1), a * tnoise(t, 21, 2), a * tnoise(t, 19, 3)];
};

// white-out and fades for the grade
export const whiteAt = (t) => 0.9 * pulse(t, T.BLAST, 0.03, 0.22) + 0.5 * pulse(t, T.CLAW, 0.01, 0.08) + 0.35 * pulse(t, T.KNOCK, 0.01, 0.07);
export const fadeAt = (t) => sstep(0, 1.6, t) * (1 - sstep(T.OUT, DUR - 0.05, t));
// chromatic fringe on hits
export const fringeAt = (t) => clamp(pulse(t, T.LAND, 0.02, 0.25) + pulse(t, T.CLAW, 0.01, 0.2) + 1.5 * pulse(t, T.BLAST, 0.02, 0.5) + 0.5 * pulse(t, T.TAIL + 0.25, 0.02, 0.2), 0, 2);

// wind strength 0..1+ (grass, cape of dust, cap brim, audio)
export const windAt = (t) =>
  0.25 + 0.45 * win(t, T.OMEN, T.DESCENT + 3, 2, 3) + 0.9 * win(t, T.ROAR, T.ROAR_END + 0.6, 0.15, 0.8) + 0.6 * pulse(t, T.TAKEOFF, 0.2, 1.5) +
  1.2 * pulse(t, T.BLAST, 0.05, 1.8) + 0.5 * win(t, T.BREATH, T.BREATH_END, 0.3, 0.5) + 0.4 * pulse(t, T.LAND, 0.1, 1.2) + 0.4 * pulse(t, T.DEPART + 0.6, 0.3, 2);

// The edit: every cut, named. Camera functions live in camera.js; audio uses the cut list for whooshes.
export const SHOTS = [
  [0.0, 'sea'],
  [4.5, 'agentIntro'],
  [9.0, 'storm'],
  [12.0, 'faceUp'],
  [13.5, 'cloud'],
  [16.0, 'emerge'],
  [19.0, 'descend'],
  [22.25, 'feet'],
  [23.5, 'roar'],
  [26.5, 'agentHold'],
  [28.5, 'eye'],
  [31.0, 'draw'],
  [33.5, 'charge'],
  [36.4, 'tail'],
  [38.6, 'look'],
  [40.0, 'parry'],
  [42.0, 'knock'],
  [44.0, 'inhale'],
  [45.0, 'breathOTS'],
  [47.4, 'breathWide'],
  [50.5, 'takeoff'],
  [53.5, 'flyby'],
  [58.0, 'run'],
  [61.0, 'dive'],
  [64.0, 'columns'],
  [66.5, 'leap'],
  [69.0, 'slam'],
  [70.4, 'shockWide'],
  [73.0, 'settle'],
  [77.0, 'bow'],
  [81.0, 'depart'],
  [85.0, 'end'],
];
export function shotAt(t) {
  let i = 0;
  while (i < SHOTS.length - 1 && t >= SHOTS[i + 1][0]) i++;
  const t0 = SHOTS[i][0], t1 = i < SHOTS.length - 1 ? SHOTS[i + 1][0] : DUR;
  return { i, name: SHOTS[i][1], t0, t1, k: (t - t0) / (t1 - t0), local: t - t0 };
}
