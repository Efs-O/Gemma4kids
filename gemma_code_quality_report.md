# Gemma Code Quality — What We Tried

## Models Tested
- `gemma4:e4b` (4.5B effective, has audio encoder)
- `gemma4:26b` (30.7B dense, no audio encoder)

---

## Bug Patterns Found in Raw Generation

| Bug | Model | Example |
|---|---|---|
| Mistyped closing tag | 26b thinking-on | `</candas>` instead of `</style>` → blank page |
| Duplicate JS token | 26b thinking-on | `window        window.addEventListener` → crash |
| `forwards` instead of `infinite` | e4b thinking-on | Animation plays once and freezes |
| CSS var used but never defined | e4b thinking-off | `var(--start-y)`, `var(--offset)` → broken movement |
| `nth-child` selector mismatch | e4b thinking-off | `.butterfly:nth-child(1)` targeting wrong element → no animation |

**Key observation:** `think: true` on 26b introduced *more* syntax errors (the `</candas>` typo came from thinking mode noise). `think: false` on 26b produced the cleanest raw output.

---

## Production Flags (must match app)

```js
options: {
  num_ctx:     98304,   // ← was wrong (32768) in first test run
  num_predict: 32768,
  temperature: 1.0,
  top_p:       0.95,
  top_k:       64,
}
```

First test used `num_ctx: 32768` and `num_predict: 8192` — this suppressed E4B thinking entirely (0 think chunks) and artificially capped output size.

---

## Approaches Tried to Improve Quality

### Approach 1 — Smarter generation prompt
Added explicit constraints to the prompt:
```
Before outputting, verify:
- Every var(--x) is defined on a rule that matches an element
- Every :nth-child() matches the real element position in HTML
- All looping animations use `infinite`, not `forwards`
- All HTML tags are correctly spelled and closed
- No duplicate JS tokens or undefined variables
```
**Result:** Reduces bugs at generation time. Does not eliminate them. Still requires a post-step.

### Approach 2 — Two-pass review (generate → review)
Second Ollama call sends the generated HTML back with a bug checklist prompt. Always runs with `think: true`.
**Result:** Improved 26b output noticeably. Too slow for real-time child interaction (~3–5 min extra per generation).

### Approach 3 — Local JS audit (instant, no Ollama)
Pure JS post-processor runs after generation, zero extra wait:
- Tag typo lookup table (`</candas>` → `</style>` etc.)
- Duplicate token collapse (`window        window` → `window`)
- `forwards` → `infinite` inside `<style>` blocks only
- CSS variable audit: find all `var(--x)` in stylesheet, check if `--x` is defined anywhere; if not, inject into `:root` with guessed defaults based on name pattern (`--start-y` → `0vh`, `--color` → `#ff69b4`, etc.)

**Result:** Catches recurring mechanical bugs instantly. Blind to novel bug patterns not yet in the lookup table.

---

## Recommended Production Strategy

**Combine Approach 1 + Approach 3:**
- Bake the constraint checklist into the system prompt (reduces bugs upstream)
- Run the local JS audit on every generated HTML before saving/displaying (catches remaining mechanical bugs)
- Reserve the two-pass review as an optional "improve" button the child can press — not automatic

**Do NOT use two-pass automatically** — the 26b model unloads from VRAM after each call (`keep_alive: 0`), so pass 2 forces a full model reload, doubling the wait time invisibly.

---

## Files in `scripts/`

| File | Purpose |
|---|---|
| `test-butterfly-gen.mjs` | Current benchmark: 4 model×thinking combos, single pass + local audit |
| `test-stt.mjs` | STT smoke test: Piper synthesises speech → Ollama E4B transcribes |

## Files in `KidAnimations/`
- `butterflies-{label}.html` — raw Gemma output
- `butterflies-{label}-audited.html` — after local JS audit
- `butterflies-claude.html` — Claude reference implementation
