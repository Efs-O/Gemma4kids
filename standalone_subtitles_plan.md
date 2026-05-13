# Standalone Subtitle Tool Plan

## Goal

Build a **standalone local subtitle generator** for the hackathon video that:

- takes a `.mov` or `.mp4` video file
- extracts audio with `ffmpeg`
- sends each scripted segment to **Gemma 4 E4B** through **Ollama at `http://localhost:11434`**
- produces:
  - `subtitles.de.srt`
  - `subtitles.en.srt`
  - optional transcript review files

This tool is **not part of the Gemma4kids app**. It is a separate production utility for the submission video.

Model scope is fixed:

- **`gemma4:e4b` only**

Language behavior is fixed:

- German spoken language -> English subtitle text
- Greek spoken language -> English subtitle text
- English spoken language -> English subtitle text

The subtitle tool should reuse the **existing STT prompt patterns and STT runtime settings already present in the repo** wherever practical.

---

## Why This Approach

The video is already structured as many short spoken segments in [HACKATHON_VIDEO_SCRIPT.md](C:/Users/efso%20office/Desktop/Gemma4kids/HACKATHON_VIDEO_SCRIPT.md:1). That removes the need for unreliable long-form auto-segmentation and avoids the `~30s` practical constraint of E4B audio transcription.

This plan optimizes for:

- speed of implementation
- low risk
- local-only execution
- clean multilingual transcription
- clean English subtitle output
- easy manual review before final video export

---

## Non-Goals

This tool will **not**:

- modify the Electron app
- be exposed inside the kids UI
- do cloud inference
- attempt frame-perfect word-level forced alignment
- build a full subtitle editor
- solve general-purpose long-form transcription for arbitrary media libraries
- support multiple model backends for this workflow

This is a **hackathon production tool**, not a product feature.

---

## Recommended Stack

Use **Node.js**, not Python.

Reasoning:

- the repo is already Node-based
- existing FFmpeg and Ollama patterns can be reused
- no dependency split across ecosystems
- faster to ship in this codebase
- easier to run with one command

No new npm packages unless they are absolutely required. The preferred implementation uses:

- built-in Node modules
- `ffmpeg` from PATH or `FFMPEG_PATH`
- native `fetch`
- JSON cue sheet

---

## Core Workflow

### Input

The tool takes:

1. a video file
2. a subtitle cue sheet describing each segment

### Processing

For each cue:

1. extract the exact audio span with `ffmpeg`
2. convert it to `16kHz`, mono, WAV
3. send that WAV to `gemma4:e4b`
4. choose the prompt template based on the cue language
5. return **English subtitle text**
6. normalize text
7. write subtitle entries using the cue start/end times

### Output

The tool writes:

- `subtitles.en.srt`
- optional source-language review transcripts
- optional `segments-review.json`

---

## Best Architecture

### Standalone Script

Create a standalone script, likely:

- `scripts/generate-subtitles.mjs`

This keeps the work isolated and easy to run.

### Optional Data File

Create a cue sheet file, likely:

- `scripts/hackathon-video-cues.json`

This is the single source of truth for subtitle timing.

### Why Cue Sheet First

For this specific video, timing should come from the edit script, not from automatic chunking.

Benefits:

- stable timestamps
- exact segment ownership
- easier retries
- easier manual polish
- better subtitle readability
- less model confusion across speakers and languages

---

## Cue Sheet Format

Use a simple JSON array.

Example:

```json
[
  {
    "id": "intro-mom-de-01",
    "start": "00:00:03.200",
    "end": "00:00:11.800",
    "speaker": "mom",
    "sourceLanguage": "de",
    "output": "en",
    "notes": "Mom opening line to camera"
  },
  {
    "id": "boy-greek-01",
    "start": "00:01:38.000",
    "end": "00:01:48.500",
    "speaker": "christos",
    "sourceLanguage": "el",
    "output": "en",
    "notes": "Voice request demo"
  }
]
```

### Required Fields

- `id`
- `start`
- `end`
- `speaker`
- `sourceLanguage`
- `output`

### Optional Fields

- `notes`
- `manualTranscript`
- `manualTranslation`
- `skip`

### Output Modes

Supported `output` values:

- `en`
- `review`
- `en+review`

For the current hackathon need, the important case is `en`.

---

## Model Strategy

Use `gemma4:e4b` only.

There is no multi-model strategy in this tool.

### Prompt Strategy

Use the existing language-aware prompt patterns already proven in the app codebase, but adapt them for subtitle output.

Per cue:

- if `sourceLanguage` is `de`, use the German audio-to-English template
- if `sourceLanguage` is `el`, use the Greek audio-to-English template
- if `sourceLanguage` is `en`, use the English audio-to-English template

Prompt intent:

- detect and respect the expected spoken language
- listen to the audio only
- output subtitle-ready English text only
- no labels
- no commentary
- no bilingual formatting unless explicitly in review mode

### Language Routing

The cue sheet should provide the expected language. The tool should not rely on open-ended auto-detection for this workflow.

That reduces variance and keeps each segment aligned with the script.

---

## Timestamp Strategy

Subtitle timestamps come from the cue sheet, not from the model.

This is the correct tradeoff for the hackathon video because:

- the script already defines scene boundaries
- the spoken sections are short
- the edit is curated
- the final goal is readable subtitles, not linguistic research accuracy

The tool should still support small timing adjustments later by editing the cue file.

---

## Text Cleanup Rules

The script should normalize model output before writing subtitles.

### English Cleanup

- trim whitespace
- remove labels like `English:` if present
- remove accidental prompt echo
- keep subtitle-friendly sentence casing

### Optional Review Transcript Cleanup

If review-mode source transcripts are generated:

- trim whitespace
- collapse repeated spaces
- remove accidental prompt echo
- preserve the original script and language

### Subtitle Readability

Optional formatting pass:

- split very long lines into at most 2 lines
- target roughly readable subtitle lengths
- avoid huge single-line blocks

This should be conservative. Do not aggressively rewrite text.

---

## Error Handling

The tool should fail loudly and clearly.

### Validate Before Starting

- video file exists
- cue file exists
- `ffmpeg` is available
- Ollama responds at `localhost:11434`
- `gemma4:e4b` is installed

### Per-Cue Failure Policy

If one cue fails:

- log the cue id
- keep partial outputs
- continue only if `--continue-on-error` is passed

Default behavior should be:

- stop on first hard failure

That is better for fast debugging during the deadline.

---

## Retry Strategy

E4B audio calls can be brittle. Keep retries simple.

Per cue:

1. first attempt
2. wait a few seconds
3. retry once

If the second attempt fails:

- surface the error
- stop the run

No complex backoff logic is needed.

---

## Review Workflow

The tool should generate files that are easy to inspect manually before burning subtitles into the final video.

### Review Files

- `subtitles.en.srt`
- `segments-review.json`

`segments-review.json` should include, per cue:

- id
- start
- end
- speaker
- sourceLanguage
- source transcript if requested
- english subtitle text
- status
- error if any

This makes review and patching much faster than editing raw model logs.

---

## CLI Design

Keep the interface minimal.

### Base Command

```bash
node scripts/generate-subtitles.mjs --video "C:\path\video.mov" --cues "scripts\hackathon-video-cues.json"
```

### Useful Flags

- `--video <path>`
- `--cues <path>`
- `--out-dir <path>`
- `--model gemma4:e4b`
- `--continue-on-error`
- `--only <cue-id>`
- `--from <cue-id>`
- `--dry-run`
- `--with-review-transcript`

### Dry Run

`--dry-run` should:

- validate inputs
- print resolved cues
- print ffmpeg path
- print detected models
- not call Ollama

That will save time when debugging.

---

## FFmpeg Plan

For each cue:

```bash
ffmpeg -y -ss <start> -to <end> -i <video> -vn -ac 1 -ar 16000 -c:a pcm_s16le <temp.wav>
```

Notes:

- `pcm_s16le` is fine for the existing Node/Ollama path
- if testing shows E4B prefers float WAV in this environment, switch to `pcm_f32le`
- the script should own this choice in one place

The temp audio should be written into a temporary working folder under the OS temp directory.

---

## Ollama Request Plan

### Transcription Request

POST to:

- `http://localhost:11434/api/chat`

Body shape:

- `model: "gemma4:e4b"`
- `stream: false`
- `keep_alive: 0`
- audio base64 via `images`
- content prompt focused on exact transcription

There is no second translation model call in the default design.

Each cue should be handled in a **single E4B audio request** that returns English subtitle text directly.

---

## Implementation Phases

## Phase 1: Minimal Working Tool

Goal:

- prove end-to-end generation for one spoken segment

Tasks:

1. create cue sheet format
2. implement ffmpeg extraction for one cue
3. base64 encode WAV
4. call E4B
5. print English subtitle output
6. write one-entry `.srt`

Success criteria:

- one real segment resolves to correct English subtitle text
- one valid `.srt` file is written

---

## Phase 2: Full English Subtitle Pass

Goal:

- generate `subtitles.en.srt` for all spoken segments

Tasks:

1. loop all cues
2. collect results
3. write ordered SRT entries
4. add review JSON
5. add retry-once behavior

Success criteria:

- full English subtitle file generated
- any failures are easy to locate by cue id

---

## Phase 3: Review Transcript Pass

Goal:

- generate optional source-language review transcripts

Tasks:

1. generate or preserve source-language transcript text per cue
2. normalize review transcript text
3. write review artifacts
4. compare outputs against the intended narrative in the video script

Success criteria:

- English subtitles are natural enough for judges
- source-language review artifacts help fast correction where needed

---

## Phase 4: Final Review Pass

Goal:

- make the files editor-ready for the final video export

Tasks:

1. inspect long lines
2. patch any weak segments manually in cue sheet or review file
3. rerun only changed cues
4. produce final subtitle files

Success criteria:

- subtitles are readable
- timing matches edited shots
- German and English files are ready for use in video editing software

---

## Manual Override Strategy

Some lines may need hand correction. Build that into the plan instead of fighting it.

The cue sheet should support:

- `manualTranscript`
- `manualTranslation`

If either exists, the script should use the manual text and skip the model for that field.

This is important because it gives a fast escape hatch under deadline pressure.

---

## Risks

### Risk 1: E4B Hallucinates or Echoes Prompt

Mitigation:

- strict transcription prompt
- post-cleaning
- retry once
- manual override fields

### Risk 2: Subtitle Timing Feels Late or Early

Mitigation:

- edit cue times directly
- rerun selected cues only

### Risk 3: Direct English Subtitle Output Sounds Mechanical

Mitigation:

- tighten the E4B subtitle prompt
- manual override for final lines

### Risk 4: FFmpeg Path Problems on Windows

Mitigation:

- resolve from `FFMPEG_PATH`
- fallback to PATH lookup
- print exact path during startup

### Risk 5: Deadline Pressure

Mitigation:

- ship English SRT first
- keep CLI simple
- no UI unless absolutely necessary

---

## Recommendation on UI

Do **not** build a GUI first.

Fastest path:

- CLI script
- cue-sheet JSON
- output files

If needed later, a tiny wrapper menu can be added. But the first deliverable should be command-line only.

Reason:

- less implementation time
- fewer failure points
- easier debugging
- better fit for a one-off production tool

---

## Recommended File Additions

- `scripts/generate-subtitles.mjs`
- `scripts/hackathon-video-cues.json`
- optional `scripts/README-subtitles.md`

No app files should be changed.

---

## Definition of Done

The tool is done when:

1. it runs locally on Windows
2. it accepts the hackathon video file
3. it processes all planned spoken segments
4. it writes `subtitles.en.srt`
5. it optionally writes review artifacts
6. rerunning a single cue is easy
7. no Electron app code was modified

---

## Immediate Next Step

Implement **Phase 1** only:

- create the script
- create the cue sheet template
- prove one German segment end to end

Once that works, expand to the full video.
