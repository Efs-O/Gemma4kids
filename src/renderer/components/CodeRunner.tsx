import React, { useEffect, useRef, useState, useCallback } from 'react';
import { isGemma426b } from '../utils/pickCodingModel';

// ── layout constants (px) ────────────────────────────────────────
const GY   = 96;          // ground Y inside play area
const RX   = 80;          // robot fixed X
const RW   = 24;          // robot collision width
const RH   = 38;          // robot collision height
const PEAK = 55;          // jump arc height
const JMS  = 350;         // jump duration ms
const BW   = 38;          // bug collision width
const BH   = 16;          // bug collision height
const SW   = 14;          // semicolon width
const SH   = 24;          // semicolon height
const SY   = GY - BH - 30; // semicolon Y (floats above bugs)
const HI_KEY = 'g4k-runner-hi';

interface Obs { id: number; x: number; type: 'bug' | 'semi'; }

interface GS {
  phase: 'idle' | 'running' | 'dead';
  score: number; ry: number;
  jumping: boolean; jumpT: number;
  obs: Obs[]; speed: number; t0: number;
  lastObs: number; nextObs: number;
  lastSemi: number; nextSemi: number;
  foot: 0 | 1; lastFoot: number; oid: number;
}

const mkGS = (): GS => ({
  phase: 'idle', score: 0, ry: 0,
  jumping: false, jumpT: 0, obs: [],
  speed: 4, t0: 0, lastObs: 0, nextObs: 1800,
  lastSemi: 0, nextSemi: 4000,
  foot: 0, lastFoot: 0, oid: 0,
});

function overlaps(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  const k = 0.15; // forgiveness inset
  return ax + aw*(1-k) > bx + bw*k && ax + aw*k < bx + bw*(1-k) &&
         ay + ah*(1-k) > by + bh*k && ay + ah*k < by + bh*(1-k);
}

interface Props { model: string; streaming: boolean; }

export function CodeRunner({ model, streaming }: Props) {
  const is26b = isGemma426b(model);
  const visible = streaming && is26b;

  const [hi, setHi]   = useState(() => parseInt(localStorage.getItem(HI_KEY) ?? '0', 10));
  const [gs, setGs]   = useState<GS>(mkGS);
  const gsRef  = useRef<GS>(gs);
  const hiRef  = useRef(hi);
  const rafRef = useRef(0);
  const strip  = useRef<HTMLDivElement>(null);

  useEffect(() => { hiRef.current = hi; }, [hi]);

  // reset when game hides
  useEffect(() => {
    if (!visible) { gsRef.current = mkGS(); setGs(mkGS()); }
  }, [visible]);

  const doJump = useCallback(() => {
    const g = gsRef.current;
    const now = performance.now();
    if (g.phase === 'idle') {
      gsRef.current = { ...mkGS(), phase: 'running', t0: now, lastObs: now, lastSemi: now, lastFoot: now, jumping: true, jumpT: now };
      return;
    }
    if (g.phase === 'dead') { gsRef.current = mkGS(); return; }
    if (!g.jumping) gsRef.current = { ...g, jumping: true, jumpT: now };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!visible) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); doJump(); }
      if (e.code === 'Escape') strip.current?.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, doJump]);

  useEffect(() => {
    const loop = (now: number) => {
      const g = gsRef.current;

      if (g.phase !== 'running') {
        setGs({ ...g });
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const W = strip.current?.offsetWidth ?? 1200;
      let { score, ry, jumping, jumpT, obs, speed, t0,
            lastObs, nextObs, lastSemi, nextSemi, foot, lastFoot, oid } = g;

      // jump arc
      if (jumping) {
        const p = Math.min(1, (now - jumpT) / JMS);
        ry = Math.round(Math.sin(p * Math.PI) * PEAK);
        if (p >= 1) { jumping = false; ry = 0; }
      }

      // foot toggle
      if (now - lastFoot > 170) { foot = foot === 0 ? 1 : 0; lastFoot = now; }

      // score + speed ramp
      score = Math.floor((now - t0) / 80);
      speed = 4 + Math.floor((now - t0) / 8000) * 0.4;

      // spawn bug
      if (now - lastObs > nextObs) {
        obs = [...obs, { id: oid, x: W, type: 'bug' }];
        oid += 1; lastObs = now;
        nextObs = 1100 + Math.random() * 1300;
      }

      // spawn semicolon
      if (now - lastSemi > nextSemi) {
        if (Math.random() > 0.4) { obs = [...obs, { id: oid, x: W, type: 'semi' }]; oid += 1; }
        lastSemi = now; nextSemi = 3000 + Math.random() * 2000;
      }

      // move all obstacles
      obs = obs.map(o => ({ ...o, x: o.x - speed })).filter(o => o.x > -60);

      // collision
      const rTop = GY - RH - ry;
      let dead = false;
      let bonus = 0;
      const kept: Obs[] = [];
      for (const o of obs) {
        if (o.type === 'bug') {
          if (overlaps(RX, rTop, RW, RH, o.x, GY - BH, BW, BH)) { dead = true; break; }
          kept.push(o);
        } else {
          if (overlaps(RX, rTop, RW, RH, o.x, SY, SW, SH)) bonus += 10;
          else kept.push(o);
        }
      }
      score += bonus;

      if (dead) {
        if (score > hiRef.current) { localStorage.setItem(HI_KEY, String(score)); setHi(score); }
        gsRef.current = { ...g, phase: 'dead', score, obs: kept };
        setGs({ ...gsRef.current });
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      gsRef.current = { phase: 'running', score, ry, jumping, jumpT, obs: kept, speed, t0, lastObs, nextObs, lastSemi, nextSemi, foot, lastFoot, oid };
      setGs({ ...gsRef.current });
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // intentionally once — all mutable state via gsRef/hiRef

  if (!visible) return null;

  const { phase, score, ry, foot: f, obs } = gs;
  const rTop = GY - RH - ry;

  return (
    <div ref={strip} className="cr-strip" tabIndex={0} onClick={doJump}
      aria-label="Code Runner mini-game — press Space to jump">

      <div className="cr-play">
        {/* ground line */}
        <div className="cr-ground" />

        {/* robot */}
        <div style={{ position: 'absolute', left: RX, top: rTop, width: RW }}>
          <div className="cr-head">
            <div className="cr-eye cr-el" />
            <div className="cr-eye cr-er" />
          </div>
          <div className="cr-body" />
          <div className="cr-feet">
            <div className={`cr-foot${f === 0 ? ' cr-fu' : ''}`} />
            <div className={`cr-foot${f === 1 ? ' cr-fu' : ''}`} />
          </div>
        </div>

        {/* obstacles */}
        {obs.map(o => o.type === 'bug' ? (
          <div key={o.id} style={{ position: 'absolute', left: o.x, top: GY - BH }}>
            <div className="cr-bug">
              <div className="cr-bstripe" />
              <div className="cr-ant cr-al" />
              <div className="cr-ant cr-ar" />
            </div>
            <div className="cr-leg cr-ll1" /><div className="cr-leg cr-rl1" />
            <div className="cr-leg cr-ll2" /><div className="cr-leg cr-rl2" />
            <div className="cr-leg cr-ll3" /><div className="cr-leg cr-rl3" />
          </div>
        ) : (
          <div key={o.id} className="cr-semi" style={{ left: o.x, top: SY }}>;</div>
        ))}

        {phase === 'idle' && (
          <div className="cr-msg">
            🤖 Gemma is coding… press <kbd>Space</kbd> to squash some bugs!
          </div>
        )}
        {phase === 'dead' && (
          <div className="cr-msg">
            💀 A bug got you! Score: <strong>{score}</strong> · Space or click to retry
          </div>
        )}
      </div>

      <div className="cr-score">
        Score: {score} &nbsp;·&nbsp; Best: {hi}
        <span className="cr-hint">Space / ↑ to jump · Esc to chat</span>
      </div>
    </div>
  );
}
