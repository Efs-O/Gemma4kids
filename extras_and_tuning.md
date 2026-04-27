# Extras and tuning (gemma4kids)

Living backlog for UX improvements and polish after the core flow works. Add new items as numbered or bulleted sections; keep each item’s **goal**, **current behavior** (if any), and **notes** short.

---

## 1. Draggable splitter — chat vs code editor

**Goal:** Let the user resize the boundary between the **code window** (`EditorPanel`) and the **chat** (`ChatPanel`) by dragging with the mouse, instead of a fixed flex split.

**Current behavior:** `App.tsx` lays out `.app-body` as a row: sidebar → `EditorPanel` → `ChatPanel`. The editor uses `flex: 1` and a fixed `border-right` on `.editor-panel` (`styles.css`). There is no drag handle; proportions follow flex only.

**Acceptance hints:**

- A visible **drag handle** (narrow strip or grippy cursor) sits **between** the editor and the chat.
- Dragging horizontally changes the relative width; both panes keep **reasonable min-widths** so neither collapses unusably.
- Optional: **persist** the split ratio in `localStorage` and restore on launch.
- Use `cursor: col-resize` on the handle; consider `user-select: none` on the body while dragging to avoid text selection glitches.

**Likely touchpoints:** `src/renderer/App.tsx` (layout + state for split), `src/renderer/styles.css` (handle + flex widths), possibly a small `SplitPane.tsx` wrapper if the markup grows.

---

## 2. Mini “dino runner” game while Gemma thinks

**Reference:** Chrome’s offline **T-Rex Runner** — side-scrolling ground line, a character that **jumps with Space** (and maybe starts the run with Space), obstacles scrolling in from the right, simple score over time. Familiar to many kids even if they don’t know the name.

**Goal:** If code generation still feels slow (even on **gemma4:e4b**), give a **small play strip under the main app** so kids can play a lightweight endless runner instead of staring at a static loading state.

**Current behavior:** Main layout is header + `app-body` (sidebar, editor, chat). No idle mini-game.

**Design notes:**

- **Placement:** A fixed-height row **below** `app-body` (or below the whole `app` column), full window width — not a second OS window unless you prefer pop-out later.
- **When to show:** e.g. only while `useChat` status is `streaming` / waiting for first token, or a always-visible “tap to play” strip that doesn’t steal focus from the chat input (keyboard: only when the mini-game container is focused, or explicit click-to-focus the game).
- **Scope:** Keep assets minimal (CSS shapes or a tiny sprite sheet), no external game engine — goal is distraction, not a full product.
- **Accessibility:** Visible focus ring if the game captures keyboard; Esc to return focus to chat.

**Likely touchpoints:** new `MiniRunner.tsx` (or `WaitGame.tsx`), `App.tsx` layout, `styles.css`, optional hook from `useChat` `status` to toggle visibility or difficulty.

**Tuning (active):** Coding model auto-pick prefers **`gemma4:e4b`**, then `gemma4:26b` — see `pickCodingModel.ts`. Change order in that file to prefer 26B for best tool/code quality.

---

_Add new sections below as "## 3. …" etc._
