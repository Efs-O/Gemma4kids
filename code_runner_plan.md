# Code Runner — Mini Game Plan

A lightweight endless runner shown while Gemma is generating code.
Pure CSS shapes + vanilla JS game loop inside a React component. No canvas library, no game engine, no external assets.

---

## Concept

A pixel **robot** 🤖 runs right across a scrolling **circuit board** ground.
Obstacles are **bugs** 🐛 (literal insects — CSS ellipses with legs).
Collectibles are **semicolons** `;` that float above the ground for bonus points.
Jumping on a bug squashes it (+10 pts). Hitting a bug without jumping ends the run.
Score counts up by distance. High score persists in `localStorage`.

**Tone:** funny, fast, on-theme. "Squash the bugs while Gemma codes!"

---

## Visual Design (CSS shapes only)

| Element | Shape |
|---|---|
| Robot | 2 stacked rectangles (head + body) + 2 small square feet that alternate up/down |
| Bug | Wide flat ellipse (body) + 4 short div lines as legs, antennae on top |
| Semicolon | Plain text `;` in a bright color, floating |
| Ground | Single `1px` horizontal line (circuit board style, dashed or dotted) |
| Background | Transparent — app background shows through |

No images. No SVG files. Everything is `div` + `border-radius` + `background`.

---

## Layout

- Fixed-height strip **below `app-body`**, full window width — always in DOM
- Height: `110px` total (80px play area + 30px score bar)
- Only **visible** when `useChat` status === `'streaming'`
- Hidden (CSS `display: none`) when idle — zero layout impact
- Does **not** steal keyboard focus from chat input automatically
- Click the strip to focus the game → Space / ArrowUp to jump
- `Esc` returns focus to chat input

---

## Game Loop

- `requestAnimationFrame` loop, runs only while component is mounted and visible
- Ground speed starts at `4px/frame`, increases `+0.3` every 10 seconds
- Obstacles spawn at random interval `1200–2400ms`
- Semicolons spawn at random interval `3000–5000ms`, 50% chance
- Robot has 2 jump states: grounded → jump (fixed arc, `300ms`) → grounded
- Collision: AABB (axis-aligned bounding box) check each frame, 10% inset for forgiveness

---

## State

```
gameState: 'idle' | 'running' | 'dead'
score: number
highScore: number  ← localStorage 'g4k-runner-hi'
robotY: number
obstacles: { x, type: 'bug' | 'semi' }[]
speed: number
```

---

## Files

| File | Purpose |
|---|---|
| `src/renderer/components/CodeRunner.tsx` | Full game component — loop, render, input |
| `src/renderer/styles.css` | `.code-runner-*` classes appended to existing file |

No new npm packages. No new IPC. No new files in `src/main/`.

---

## Integration in App.tsx

```tsx
// below </div> closing app-body
{status === 'streaming' && <CodeRunner />}
```

Pass nothing — `CodeRunner` is self-contained. It reads no props, calls no IPC.

---

## Acceptance Criteria

- [ ] Robot animates (feet alternate) while running
- [ ] Bug obstacles scroll in from right, speed increases over time
- [ ] Semicolons appear as collectibles, add bonus points
- [ ] Space / ArrowUp jumps — double jump NOT allowed
- [ ] AABB collision ends run, shows "💀 Squashed! Score: X" overlay
- [ ] Click to restart while `status === 'streaming'`
- [ ] High score persists across sessions via `localStorage`
- [ ] Strip is invisible when `status !== 'streaming'`
- [ ] `Esc` returns keyboard focus to chat input
- [ ] No layout shift when strip appears/disappears (fixed height reserved)
- [ ] `npm run build` and `npm run typecheck` clean

---

## Out of Scope

- Sound effects (no audio API usage — Piper owns audio)
- Multiple lives
- Power-ups beyond semicolons
- Mobile / touch input
- Leaderboard / multiplayer
