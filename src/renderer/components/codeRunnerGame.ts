/** Mini-game state and pure helpers for CodeRunner (layout + collision). */

export const PLAY_H = 150;
export const GY = 126;
export const START_RX = 118;
export const MIN_RX = 68;
export const STEP_X = 42;
export const RW = 24;
export const RH = 38;
export const PEAK = 82;
export const JMS = 430;
export const SW = 24;
export const SH = 38;
export const SY = GY - 66;
export const HI_KEY = 'g4k-runner-hi';

export type BugVariant = 'beetle' | 'spider' | 'crawler';

export interface Obs {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'bug' | 'semi';
  variant?: BugVariant;
}

export interface GS {
  phase: 'idle' | 'running' | 'dead';
  score: number;
  ry: number;
  rx: number;
  jumping: boolean;
  jumpT: number;
  obs: Obs[];
  speed: number;
  t0: number;
  lastObs: number;
  nextObs: number;
  lastSemi: number;
  nextSemi: number;
  foot: 0 | 1;
  lastFoot: number;
  oid: number;
}

export function mkGS(): GS {
  return {
    phase: 'idle',
    score: 0,
    ry: 0,
    rx: START_RX,
    jumping: false,
    jumpT: 0,
    obs: [],
    speed: 4,
    t0: 0,
    lastObs: 0,
    nextObs: 1800,
    lastSemi: 0,
    nextSemi: 4000,
    foot: 0,
    lastFoot: 0,
    oid: 0,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function pickBugVariant(): { variant: BugVariant; w: number; h: number } {
  const roll = Math.random();
  if (roll < 0.34) {
    return { variant: 'beetle', w: 42, h: 18 };
  }
  if (roll < 0.67) {
    return { variant: 'spider', w: 36, h: 20 };
  }
  return { variant: 'crawler', w: 48, h: 14 };
}

export function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  const k = 0.15;
  return ax + aw * (1 - k) > bx + bw * k &&
    ax + aw * k < bx + bw * (1 - k) &&
    ay + ah * (1 - k) > by + bh * k &&
    ay + ah * k < by + bh * (1 - k);
}

/** One animation frame while `phase === 'running'`. */
export interface TickRunningResult {
  gs: GS;
  /** If set, persist and show as new best */
  newHighScore?: number;
}

export function tickRunningState(
  current: GS,
  now: number,
  width: number,
  bestSoFar: number,
): TickRunningResult {
  let {
    score,
    ry,
    rx,
    jumping,
    jumpT,
    obs,
    speed,
    t0,
    lastObs,
    nextObs,
    lastSemi,
    nextSemi,
    foot,
    lastFoot,
    oid,
  } = current;

  if (jumping) {
    const p = Math.min(1, (now - jumpT) / JMS);
    ry = Math.round(Math.sin(p * Math.PI) * PEAK);
    if (p >= 1) {
      jumping = false;
      ry = 0;
    }
  }

  if (now - lastFoot > 170) {
    foot = foot === 0 ? 1 : 0;
    lastFoot = now;
  }

  score = Math.floor((now - t0) / 80);
  speed = 4 + Math.floor((now - t0) / 8000) * 0.4;

  if (now - lastObs > nextObs) {
    const bug = pickBugVariant();
    obs = [
      ...obs,
      {
        id: oid,
        x: width,
        y: GY - bug.h,
        w: bug.w,
        h: bug.h,
        type: 'bug',
        variant: bug.variant,
      },
    ];
    oid += 1;
    lastObs = now;
    nextObs = 900 + Math.random() * 1100;
  }

  if (now - lastSemi > nextSemi) {
    const semiX = width + 40 + Math.random() * 120;
    const overlapsBugLane = obs.some((o) => o.type === 'bug' && Math.abs(o.x - semiX) < 100);
    if (!overlapsBugLane) {
      obs = [
        ...obs,
        {
          id: oid,
          x: semiX,
          y: SY,
          w: SW,
          h: SH,
          type: 'semi',
        },
      ];
      oid += 1;
    }
    lastSemi = now;
    nextSemi = 2200 + Math.random() * 1600;
  }

  obs = obs.map((o) => ({ ...o, x: o.x - speed })).filter((o) => o.x > -80);

  const rTop = GY - RH - ry;
  let dead = false;
  let bonus = 0;
  const kept: Obs[] = [];

  for (const o of obs) {
    if (o.type === 'bug') {
      if (overlaps(rx, rTop, RW, RH, o.x, o.y, o.w, o.h)) {
        dead = true;
        break;
      }
      kept.push(o);
      continue;
    }

    if (overlaps(rx, rTop, RW, RH, o.x, o.y, o.w, o.h)) {
      bonus += 10;
    } else {
      kept.push(o);
    }
  }

  score += bonus;

  if (dead) {
    const gs: GS = { ...current, phase: 'dead', score, obs: kept };
    const newHighScore = score > bestSoFar ? score : undefined;
    return { gs, newHighScore };
  }

  const gs: GS = {
    phase: 'running',
    score,
    ry,
    rx,
    jumping,
    jumpT,
    obs: kept,
    speed,
    t0,
    lastObs,
    nextObs,
    lastSemi,
    nextSemi,
    foot,
    lastFoot,
    oid,
  };
  return { gs };
}
