---
name: gemma4kids project context
description: Core facts about the gemma4kids hackathon project — goals, stack, constraints, deadlines
type: project
originSessionId: 62dcaf2f-5c89-46f4-a084-24b0edb2800b
---
Offline AI coding teacher for kids (ages 8–12) built for the Google Gemma 4 Good hackathon on Kaggle.

**Deadline:** ~May 18, 2026 (22 days from project start on 2026-04-26). Build target: working app by Day 15, last 7 days for video + writeup.

**Submission requirements:**
- Kaggle writeup (max 1,500 words) — technical verification
- YouTube video (3 min max) — MOST IMPORTANT, 70 of 100 points
- Public GitHub repo — well-documented, proves real engineering
- Live demo — Electron installer files attached to Kaggle writeup (not a hosted URL)
- Cover image for media gallery

**Judging:** Impact & Vision 40pts, Video Pitch 30pts, Technical Depth 30pts.

**Track:** Future of Education

**Tech stack:**
- Electron (cross-platform shell: Windows + macOS + Linux)
- React + TypeScript
- CodeMirror 6 (code editor, ~200KB)
- Ollama (local model runtime — user installs separately)
- OpenAIClient.ts + types.ts + cancellation.ts copied from Forge (ready, no changes needed)
- esbuild (bundler)
- No Python, no cloud, no subscriptions

**Models:** gemma4:4b (fallback, 8GB RAM) and gemma4:27b (primary, 16GB+ RAM). App detects via GET /api/tags.

**Forge source files location:** C:\Users\efso office\Desktop\Forge\src\llm\ (OpenAIClient.ts, types.ts, cancellation.ts — copy-ready)

**Core user flow:** Kid types natural language → AI responds with explanation + full HTML file → CodeMirror shows code → kid edits → Save → Open in browser.

**Storage:** Documents/KidAnimations/ — standalone .html files, no project structure.

**Decision: No web version for hackathon.** The offline/private pitch contradicts a hosted web demo. Post-hackathon product decision.

**Why:** Real gap — no product combines local AI + coding assistant + kids UX + offline-first.
