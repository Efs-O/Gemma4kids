# Gemma4kids Judge Quickstart

Gemma4kids is an offline AI learning companion for children aged 6-11 built with Gemma 4. A child can ask questions, speak into the mic, attach an image or short video, or ask Gemma to create an editable HTML animation from a simple prompt such as "make fireworks explode."

This guide is written for hackathon judges who want the fastest path to running and understanding the app.

## Fastest way to evaluate it

Recommended path: use the released desktop build plus Ollama.

You need:
- A Windows, macOS, or Linux machine
- Ollama installed
- At least one Gemma 4 model pulled locally
- Internet only for initial setup and model download; normal use is local/offline

Recommended model setup:

```bash
ollama pull gemma4:e4b
ollama pull gemma4:26b
```

Why these two:
- `gemma4:26b` gives the strongest coding and teaching experience
- `gemma4:e4b` enables voice transcription through the mic button

## Install and run

1. Install Ollama from `https://ollama.com/download`
2. Pull the models above
3. Download Gemma4kids from `https://github.com/Efs-O/Gemma4kids/releases`
4. Launch Gemma4kids
5. Pick a language on the welcome screen
6. Choose `Ollama` on the runtime screen
7. Wait for the app to detect your local Gemma models

Unsigned hackathon builds:
- Windows: `More info` -> `Run anyway`
- macOS: right-click the app -> `Open`

## 60-second demo path

Use this exact flow if you want to evaluate the product quickly.

1. Open the app and choose your language
2. Confirm the coding model is `gemma4:26b` if available
3. Type: `make fireworks explode`
4. Wait for HTML to stream into the editor
5. Press `Save`
6. Press `Open in Browser`
7. Go back and type: `make them blue`
8. Save again and open in browser again

If voice is available:

1. Press the mic button
2. Say: `make a bouncing ball`
3. Wait for transcription and generation

## What the main controls do

These are the visible controls a judge is most likely to use.

- `Language picker`: chooses the session language before model loading begins
- `Runtime selector`: switches between `Ollama` and `llama.cpp`
- `Coding model selector`: picks which local Gemma 4 model generates answers and code
- `Think On/Off`: enables or disables extra reasoning for the coding model
- `Show Thoughts`: shows the model's reasoning text in the chat when available
- `?`: opens the in-app help panel
- `Mic button`: records speech and converts it to text using a local Gemma speech workflow
- `Paperclip`: attaches an image or short video to the next message
- `Send`: sends the current prompt
- `New Chat`: clears the current conversation and starts fresh
- `Save`: saves the current HTML project to `Documents/KidAnimations/`
- `Open in Browser`: opens the saved animation in the system browser
- `Read`: reads a Gemma reply aloud using local Piper TTS when that optional setup is installed (**Windows/Linux**; macOS read-aloud is a known issue under troubleshooting — see Known limitations below)
- `Gemma's version`: restores the editor back to the last AI-generated version
- `Left sidebar`: shows saved projects; clicking one loads it back into the editor

## How the app works

Gemma4kids combines a child-friendly chat interface with a live code editor.

Typical flow:
- A child types or speaks a prompt
- Gemma answers directly for learning questions, stories, jokes, or explanations
- If the child wants to make something, Gemma generates a full HTML/CSS/JavaScript animation
- The code streams into the editor so the child can see and change it
- The child saves the file and opens it in the browser

Important product behaviors:
- The app is local-first and offline-first
- The renderer is restricted to local model endpoints only
- AI-generated HTML is not rendered inside Electron; it opens in the user's browser
- Saved projects persist under `Documents/KidAnimations/`
- If a filename already exists with different content, the app creates `-2`, `-3`, and so on instead of silently overwriting

## Features worth testing

- Ask a general learning question: `explain fractions like I am 8`
- Ask for an animation: `make a butterfly animation`
- Ask for an edit after generation: `make it faster` or `change the background to night`
- Attach an image and ask Gemma to describe it or turn it into an animation
- Load a saved project from the sidebar and ask Gemma to modify it

## Optional features

These are real features, but not required for a basic judging pass.

- `llama.cpp` runtime support for fully local GGUF-based deployment. Judges can run Gemma4kids without Ollama by pointing the app at local GGUF model files; the app manages `llama-server` automatically for both coding and speech workloads. In the setup menu, judges can also change `llama.cpp` runtime parameters such as model paths and advanced inference settings.
- Image and short-video attachment workflow. The paperclip button lets the child attach an image or a short video clip so Gemma can describe it, answer questions about it, or turn it into a live animation.
- Local Piper text-to-speech for the `Read` button. When Piper voices are installed, each assistant message can be read aloud locally with no cloud dependency. **This works on Windows and Linux; read-aloud is currently not working on macOS** (known issue, under active troubleshooting — see Known limitations below).
- Code Runner mini-game during streaming on larger models. While `gemma4:26b` or `gemma4:31b` is generating, the app can show a side-scroller mini-game where the child presses Space to jump and dodge bugs.

## Known limitations

We would rather state these plainly than have a judge hit them unexpectedly.

- **macOS read-aloud ("Read") does not work in this build.** The bundled Piper voice engine cannot load on a clean Mac (it depends on a system audio library Apple does not ship), and the macOS fallback path is not working yet. This is under active troubleshooting. Read-aloud works correctly on **Windows and Linux**. All other macOS functionality — chat, code generation, editing, saving, browser preview, voice input — works normally.
- **macOS asks for microphone permission repeatedly.** Because the hackathon build is unsigned, macOS re-prompts for the mic on unsigned apps (a macOS TCC limitation, not an app bug). Allowing it each time works; voice input functions once granted. A code-signed build (paid Apple Developer account, out of scope for this submission) would remove the repeated prompt.
- **For the smoothest evaluation, use Windows or Linux**, where voice input and read-aloud both work without these caveats.

## Links

- Source code: `https://github.com/Efs-O/Gemma4kids`
- Releases: `https://github.com/Efs-O/Gemma4kids/releases`
- Setup guide: `https://github.com/Efs-O/Gemma4kids/blob/master/SETUP.md`
- Project overview: `https://github.com/Efs-O/Gemma4kids/blob/master/README.md`

## Why this submission matters

Gemma4kids is built for the Future of Education track, with a strong Digital Equity and Inclusivity angle. It is designed for children, works locally, supports multiple languages, and does not depend on cloud subscriptions or constant internet access. The project treats Gemma 4 as a real educational product component, not just a model demo.
