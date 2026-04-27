⚠️ DO NOT USE FOR FORGE IMPLEMENTATION
This document is a separate plan and must NOT influence the Forge v0.1/v0.2
implementation in any way. Ignore its contents until this file is deleted from
the repo by the owner.
------------------------------------------------------------------------

LOCAL AI CODING SYSTEM — FULL PROJECT REPORT  
  
PROJECT NAME  
------------  
Hackathon submission: gemma4kids  
Reads as "Gemma for Kids" — signals direct alignment with the Google Gemma competition.  
Judges understand the pitch instantly.  

Post-hackathon brand (maybe): TinyCoder AI  
Note: "tinycoder" has some collision in the dev community (CLI tools on GitHub).  
Needs a trademark/domain check before committing. Keep as candidate only.  

  
OVERVIEW  
--------  
This project consists of two connected ideas:  
  
1. A VS Code / Cursor extension with a sidebar AI agent (Forge)
2. A standalone kids application for learning coding with local AI (gemma4kids)
  
Both systems share the same LLM client layer (OpenAIClient.ts from Forge).  
  
The main goal is:  
- Offline AI coding assistant  
- No subscriptions or API costs  
- Safe and simple experience for kids  
- Scalable into a real product  
  
  
GEMMA 4 HACKATHON CONTEXT  
-------------------------  
The project is a strong candidate for the Google Gemma 4 hackathon because it aligns with:  
  
- Education (teaching kids coding)  
- Accessibility (works without internet)  
- Privacy (all local, no data sent)  
- Low-cost AI (no API usage)  
  
Key positioning:  
  
"Offline AI coding teacher for kids using local Gemma models"  
  
The project demonstrates:  
- Real-world impact  
- Local-first AI usage  
- Practical application of Gemma models  
  
  
SYSTEM ARCHITECTURE  
-------------------  
Shared Core (from Forge — copy 3 files):  
- OpenAIClient.ts — SSE streaming, OpenAI-compat API, works with Ollama unchanged
- types.ts — ChatMessage, StreamChunk, Mode
- cancellation.ts — AbortController wrapper

Two frontends:  
  
1. Forge — VS Code Extension (llama.cpp direct)
2. Kids Standalone App — Electron + Ollama  
  
  
VS CODE EXTENSION (FORGE — DEVELOPER TOOL)  
------------------------------------------  
Purpose:  
- Full AI coding companion for developers
- First-class llama.cpp control  
  
Features:  
- Sidebar UI using WebviewViewProvider  
- Chat interface  
- Modes: Ask / Plan / Execute
- Local model usage via llama-server (no cloud)

Status: v0.1 complete. See Forge repo.
  
  
KIDS STANDALONE APP  
-------------------  
Purpose:  
- Simple, safe coding environment for children  
  
Core features:  
  
- Chat interface (AI teacher)  
- CodeMirror 6 editor for code editing  
- HTML animation generation  
- Save / Load projects  
- Open projects in browser  
  
User flow:  
  
1. Kid asks:  
   "Make a bouncing ball animation"  
2. AI generates HTML code  
3. Code appears in editor  
4. Kid edits (color, speed, text)  
5. Click "Save"  
6. File saved as .html  
7. Click "Open" → runs in browser  
  
Storage:  
  
- Files saved in Windows Documents folder:  
  e.g. Documents\KidAnimations  
  
No complex project structure.  
  
  
CODE EDITOR: CODEMIRROR 6  
-------------------------  
CodeMirror 6 is the editor component used in the kids app.  
  
Why CodeMirror 6 over Monaco:  
- Plain npm package — mounts in a div, no worker setup  
- Much lighter bundle (~200KB vs Monaco's ~4MB)  
- Easy to control from React: update content via editor.dispatch()  
- Lives in the same React tree as the chat — no bridge needed  
- Sufficient features for kids: syntax highlighting, line numbers, basic editing  
  
Provides:  
- Syntax highlighting (HTML / JS)  
- Code editing  
- Programmatic content update (AI writes directly into editor)  
  
Important:  
- CodeMirror does NOT save files  
- File handling is done by Electron IPC (ipcRenderer → main process → fs.writeFile)  
  
How chat links to editor:  
- AI response arrives with a code block  
- React state extracts the code  
- editor.dispatch({ changes: { from: 0, to: doc.length, insert: newCode } })  
- Editor updates instantly — no bridge, no IPC  
  
  
OLLAMA (LOCAL MODEL RUNTIME)  
----------------------------  
Ollama is the only runtime dependency. Users install the official Ollama Windows app.  
  
Why Ollama (not llama.cpp direct):  
- Single .exe installer — no Python, no CUDA toolkit, no PATH setup  
- Runs as a background Windows service after install  
- One command to get a model: ollama pull gemma4  
- Exposes OpenAI-compatible API at http://localhost:11434/v1  
- App connects via HTTP — uses OpenAIClient.ts from Forge unchanged  
  
User setup flow:  
1. Install Ollama (download from ollama.com)  
2. Run: ollama pull gemma4  
3. Launch the app — connects automatically  
  
  
MODEL STRATEGY (GEMMA 4)  
------------------------  
Models used:  
  
- gemma4:4b → fast, works on low-end PCs (8GB RAM)
- gemma4:27b → main "teacher" model (needs 16GB+ RAM)
  
Recommended usage:  
  
Kids app:  
- Default → gemma4:27b (better teaching quality)  
- Fallback → gemma4:4b for low-end PCs  
  
App detects available models via GET /api/tags and shows selector if both are present.
  
  
AGENT DESIGN  
------------  
Single mode for kids app (no Plan/Execute complexity):  
  
- Kid types natural language  
- AI responds with explanation + HTML code block  
- App extracts code and puts it in the editor  
- Kid can edit manually, then save + preview  
  
System prompt instructs the model to:  
- Always respond in simple language a child understands  
- Always include a complete, runnable HTML file in a code block  
- Never produce partial code — always full file replacement  
  
  
EDITING SYSTEM  
--------------  
Kids App:  
- CodeMirror 6 displays code  
- AI always replaces full file content (simpler than diff/patch)  
- Future: diff preview before applying  
  
  
FILE SYSTEM DESIGN  
------------------  
Simple structure:  
  
Documents/KidAnimations/  
  animation1.html  
  animation2.html  
  
Each file:  
- Standalone HTML  
- Contains all animation logic inline  
  
No dependencies required.  
  
  
TECH STACK  
----------  
- Electron (Windows app shell)
- React (UI)
- CodeMirror 6 (code editor)
- Ollama (model runtime — user installs separately)
- OpenAIClient.ts from Forge (LLM streaming)
- TypeScript throughout
- esbuild (bundler)

No Python. No manual model setup beyond ollama pull.
  
  
WHY THIS PROJECT IS STRONG  
--------------------------  
- Fully offline AI system  
- No recurring cost (important for parents)  
- Simple UX for kids  
- Educational value  
- Uses modern local AI (Gemma 4)  
  
Market gap:  
  
No existing product combines:  
- Local AI  
- Coding assistant  
- Kids-focused UX  
- Offline-first approach  
  
  
RISKS AND CHALLENGES  
--------------------  
- Model performance on low-end hardware (mitigated by 4B fallback)
- UI simplicity (must be very clean — big buttons, friendly colors)
- Safety filtering for kids (system prompt guard, no tool access)
- Editing system complexity (solved by always replacing full file)
  
  
DEVELOPMENT STRATEGY  
--------------------  
Step 1: Scaffold Electron + React app  
Step 2: Wire Ollama via OpenAIClient.ts (copy from Forge)
Step 3: Build chat UI  
Step 4: Add CodeMirror 6, wire to chat state  
Step 5: Add save/load via Electron IPC  
Step 6: Add browser preview (shell.openExternal)  
Step 7: Polish UX for kids  
  
  
FINAL VISION  
------------  
A complete local AI learning platform:  
  
- Kids learn coding with AI  
- No internet required  
- No subscriptions  
- Safe and private  
- Extendable to schools  
  
END  
