import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GY,
  HI_KEY,
  MIN_RX,
  mkGS,
  PLAY_H,
  RH,
  RW,
  GS,
  STEP_X,
  tickRunningState,
  clamp,
} from './codeRunnerGame';

interface Props {
  streaming: boolean;
  enabled?: boolean;
}

export function CodeRunner({ streaming, enabled = true }: Props) {
  const visible = enabled && streaming;

  const [hi, setHi] = useState(() => parseInt(localStorage.getItem(HI_KEY) ?? '0', 10));
  const [gs, setGs] = useState<GS>(mkGS);
  const gsRef = useRef<GS>(gs);
  const hiRef = useRef(hi);
  const rafRef = useRef(0);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hiRef.current = hi;
  }, [hi]);

  useEffect(() => {
    if (!visible) {
      const reset = mkGS();
      gsRef.current = reset;
      setGs(reset);
    }
  }, [visible]);

  const doJump = useCallback(() => {
    const current = gsRef.current;
    const now = performance.now();

    if (current.phase === 'idle') {
      gsRef.current = {
        ...mkGS(),
        phase: 'running',
        t0: now,
        lastObs: now,
        lastSemi: now,
        lastFoot: now,
        jumping: true,
        jumpT: now,
      };
      return;
    }

    if (current.phase === 'dead') {
      gsRef.current = {
        ...mkGS(),
        phase: 'running',
        t0: now,
        lastObs: now,
        lastSemi: now,
        lastFoot: now,
      };
      return;
    }

    if (!current.jumping) {
      gsRef.current = { ...current, jumping: true, jumpT: now };
    }
  }, []);

  const moveRunner = useCallback((direction: -1 | 1) => {
    const current = gsRef.current;
    const stripWidth = stripRef.current?.offsetWidth ?? 1200;
    const maxRx = Math.max(MIN_RX, stripWidth - RW - 28);
    gsRef.current = {
      ...current,
      rx: clamp(current.rx + direction * STEP_X, MIN_RX, maxRx),
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!visible) {
        return;
      }

      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        doJump();
      }

      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        moveRunner(-1);
      }

      if (e.code === 'ArrowRight') {
        e.preventDefault();
        moveRunner(1);
      }

      if (e.code === 'Escape') {
        stripRef.current?.blur();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, doJump, moveRunner]);

  useEffect(() => {
    const loop = (now: number) => {
      const current = gsRef.current;

      if (current.phase !== 'running') {
        setGs({ ...current });
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      const width = stripRef.current?.offsetWidth ?? 1200;
      const { gs, newHighScore } = tickRunningState(current, now, width, hiRef.current);
      if (newHighScore !== undefined) {
        localStorage.setItem(HI_KEY, String(newHighScore));
        setHi(newHighScore);
      }
      gsRef.current = gs;
      setGs({ ...gs });
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  if (!visible) {
    return null;
  }

  const { phase, score, ry, rx, foot, obs } = gs;
  const rTop = GY - RH - ry;

  return (
    <div
      ref={stripRef}
      className="cr-strip"
      tabIndex={0}
      onClick={doJump}
      aria-label="Code Runner mini-game"
    >
      <div className="cr-play" style={{ height: PLAY_H }}>
        <div className="cr-sky-glow" />
        <div className="cr-grid" />
        <div className="cr-parallax cr-parallax-far">
          <span className="cr-tree cr-tree-a" />
          <span className="cr-tree cr-tree-b" />
          <span className="cr-tree cr-tree-c" />
          <span className="cr-tower cr-tower-a" />
          <span className="cr-tower cr-tower-b" />
        </div>
        <div className="cr-parallax cr-parallax-near">
          <span className="cr-tree cr-tree-d" />
          <span className="cr-tree cr-tree-e" />
          <span className="cr-tree cr-tree-f" />
          <span className="cr-tower cr-tower-c" />
        </div>
        <div className="cr-ground" />
        <div className="cr-lane-hint">Move with ← → and jump with Space</div>

        <div style={{ position: 'absolute', left: rx, top: rTop, width: RW }}>
          <div className="cr-head">
            <div className="cr-eye cr-el" />
            <div className="cr-eye cr-er" />
          </div>
          <div className="cr-body" />
          <div className="cr-feet">
            <div className={`cr-foot${foot === 0 ? ' cr-fu' : ''}`} />
            <div className={`cr-foot${foot === 1 ? ' cr-fu' : ''}`} />
          </div>
        </div>

        {obs.map((o) => (
          o.type === 'bug' ? (
            <div key={o.id} style={{ position: 'absolute', left: o.x, top: o.y }}>
              <div className={`cr-bug cr-bug-${o.variant ?? 'beetle'}`}>
                <div className="cr-bstripe" />
                <div className="cr-ant cr-al" />
                <div className="cr-ant cr-ar" />
              </div>
              <div className="cr-leg cr-ll1" /><div className="cr-leg cr-rl1" />
              <div className="cr-leg cr-ll2" /><div className="cr-leg cr-rl2" />
              <div className="cr-leg cr-ll3" /><div className="cr-leg cr-rl3" />
            </div>
          ) : (
            <div key={o.id} className="cr-semi" style={{ left: o.x, top: o.y }}>;</div>
          )
        ))}

        {phase === 'idle' && (
          <div className="cr-msg">
            Gemma is coding. Press <kbd>Space</kbd> to start, then dodge bugs and grab semicolons.
          </div>
        )}
        {phase === 'dead' && (
          <div className="cr-msg">
            A bug got you. Score: <strong>{score}</strong> · Press <kbd>Space</kbd> or click to retry
          </div>
        )}
      </div>

      <div className="cr-score">
        <span>Score: {score}</span>
        <span>Best: {hi}</span>
        <span className="cr-hint">← → move · Space / ↑ jump · Esc to chat</span>
      </div>
    </div>
  );
}
