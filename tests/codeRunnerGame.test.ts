import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp,
  overlaps,
  mkGS,
  tickRunningState,
  GY,
  RH,
  SY,
  SW,
  SH,
  START_RX,
  type GS,
} from '../src/renderer/components/codeRunnerGame';

test('clamp keeps values inside bounds', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('overlaps is symmetric and rejects clearly separate boxes', () => {
  assert.equal(overlaps(0, 0, 20, 20, 100, 100, 20, 20), false);
  assert.equal(overlaps(0, 0, 20, 20, 5, 5, 20, 20), true);
});

test('mkGS starts with a zero bonus total', () => {
  assert.equal(mkGS().bonusTotal, 0);
});

// Regression: collecting a semicolon used to add +10 for a single frame, then the
// next tick recomputed score from elapsed time and the bonus vanished (audit §2.3).
test('semicolon bonus persists across ticks', () => {
  const now = 10_000;
  const base: GS = {
    ...mkGS(),
    phase: 'running',
    t0: now, // elapsed-time score component is 0
    ry: 20, // mid-jump so the runner reaches the elevated semicolon collectible
    rx: START_RX,
    lastObs: now,
    nextObs: 1e9, // suppress new bug spawns
    lastSemi: now,
    nextSemi: 1e9, // suppress new semi spawns
    lastFoot: now,
    obs: [{ id: 1, x: START_RX, y: SY, w: SW, h: SH, type: 'semi' }],
  };

  // Tick 1: runner overlaps the semicolon → +10, semi removed from play.
  const tick1 = tickRunningState(base, now, 800, 0);
  assert.equal(tick1.gs.phase, 'running');
  assert.equal(tick1.gs.bonusTotal, 10);
  assert.equal(tick1.gs.score, 10);
  assert.equal(tick1.gs.obs.some((o) => o.type === 'semi'), false);

  // Tick 2: no obstacles left; the +10 must still be reflected in the score.
  const tick2 = tickRunningState(tick1.gs, now, 800, 10);
  assert.equal(tick2.gs.bonusTotal, 10);
  assert.equal(tick2.gs.score, 10);
});

test('hitting a bug ends the run and reports a high score', () => {
  const now = 5_000;
  const rTop = GY - RH; // runner top at ry=0
  const state: GS = {
    ...mkGS(),
    phase: 'running',
    t0: now,
    rx: START_RX,
    lastObs: now,
    nextObs: 1e9,
    lastSemi: now,
    nextSemi: 1e9,
    lastFoot: now,
    bonusTotal: 30,
    obs: [{ id: 1, x: START_RX, y: rTop, w: 24, h: 24, type: 'bug', variant: 'beetle' }],
  };

  const result = tickRunningState(state, now, 800, 0);
  assert.equal(result.gs.phase, 'dead');
  // 30 banked bonus survives into the death frame.
  assert.equal(result.newHighScore, 30);
});
