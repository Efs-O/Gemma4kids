import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OLLAMA_BASE = 'http://localhost:11434';
const TRANSCRIBE_MODEL = 'gemma4:e4b';
const OLLAMA_TRANSCRIBE_PROFILE = {
  think: false,
  numCtx: 8192,
  keepAlive: 0,
};

function parseArgs(argv) {
  const result = {
    video: '',
    cues: '',
    outDir: '',
    only: '',
    dryRun: false,
    windowSeconds: 30,
    glossary: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--video') result.video = argv[++i] ?? '';
    else if (arg === '--cues') result.cues = argv[++i] ?? '';
    else if (arg === '--out-dir') result.outDir = argv[++i] ?? '';
    else if (arg === '--only') result.only = argv[++i] ?? '';
    else if (arg === '--window-seconds') result.windowSeconds = Number(argv[++i] ?? '');
    else if (arg === '--glossary') result.glossary = argv[++i] ?? '';
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!result.video) {
    printUsage();
    throw new Error('--video is required.');
  }
  if (!Number.isFinite(result.windowSeconds) || result.windowSeconds <= 0 || result.windowSeconds > 30) {
    throw new Error('--window-seconds must be a number between 1 and 30.');
  }

  return result;
}

function printUsage() {
  console.log(
    'Usage: node scripts/generate-subtitles.mjs --video <video.mov> [--cues <cues.json>] [--out-dir <dir>] [--only <cue-id>] [--window-seconds <1-30>] [--glossary <glossary.json>] [--dry-run]',
  );
}

function fileExists(fullPath) {
  try {
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

function findBinaryOnPath(binaryName) {
  const pathEnv = process.env.PATH ?? '';
  const parts = pathEnv.split(path.delimiter).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const candidate = path.join(part, binaryName);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function searchWinGetPackageTreeForFfmpeg(rootDir) {
  if (!fs.existsSync(rootDir)) return null;
  const pending = [rootDir];
  let visited = 0;
  while (pending.length > 0 && visited < 2500) {
    const currentDir = pending.pop();
    if (!currentDir) break;
    visited += 1;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') return entryPath;
      if (entry.isDirectory()) pending.push(entryPath);
    }
  }
  return null;
}

function findFfmpegBinary() {
  const explicit = process.env.FFMPEG_PATH?.trim();
  if (explicit && fileExists(explicit)) return explicit;
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const fromPath = findBinaryOnPath(binaryName);
  if (fromPath) return fromPath;
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      const fromWinGet = searchWinGetPackageTreeForFfmpeg(wingetDir);
      if (fromWinGet) return fromWinGet;
    }
  }
  return null;
}

function runProcess(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function parseCueTime(value) {
  const match = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid cue time: ${value}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number((match[4] ?? '0').padEnd(3, '0'));
  return (((hours * 60) + minutes) * 60 * 1000) + (seconds * 1000) + millis;
}

function formatSrtTime(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const ms = String(millis).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
}

function formatCueTime(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const ms = String(millis).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function loadCueSheet(cuePath, onlyId) {
  const raw = fs.readFileSync(cuePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Cue sheet must be a JSON array.');
  const filtered = parsed.filter((cue) => cue && cue.skip !== true);
  const selected = onlyId ? filtered.filter((cue) => cue.id === onlyId) : filtered;
  if (onlyId && selected.length === 0) {
    throw new Error(`Cue id not found: ${onlyId}`);
  }
  return selected.map((cue) => {
    const startMs = parseCueTime(cue.start);
    const endMs = parseCueTime(cue.end);
    if (endMs <= startMs) {
      throw new Error(`Cue ${cue.id} has end <= start.`);
    }
    return {
      id: String(cue.id),
      start: String(cue.start),
      end: String(cue.end),
      startMs,
      endMs,
      speaker: String(cue.speaker ?? ''),
      sourceLanguage: String(cue.sourceLanguage ?? '').trim().toLowerCase(),
      notes: String(cue.notes ?? ''),
    };
  });
}

function loadGlossary(glossaryPath) {
  if (!glossaryPath) return [];
  const resolved = path.resolve(glossaryPath);
  if (!fileExists(resolved)) {
    throw new Error(`Glossary file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Glossary file must be a JSON array.');
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Glossary entry ${index} must be an object.`);
    }
    const from = String(entry.from ?? '').trim();
    const to = String(entry.to ?? '').trim();
    const mode = String(entry.mode ?? 'word').trim().toLowerCase();
    if (!from || !to) {
      throw new Error(`Glossary entry ${index} must include non-empty "from" and "to".`);
    }
    if (mode !== 'word' && mode !== 'phrase') {
      throw new Error(`Glossary entry ${index} has invalid mode "${mode}". Use "word" or "phrase".`);
    }
    return { from, to, mode };
  });
}

function parseDurationFromFfmpegStderr(stderr) {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(stderr);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return Math.round(((hours * 3600) + (minutes * 60) + seconds) * 1000);
}

async function getVideoDurationMs(ffmpegPath, videoPath) {
  const result = await runProcess(ffmpegPath, ['-hide_banner', '-i', videoPath]);
  const durationMs = parseDurationFromFfmpegStderr(result.stderr);
  if (!durationMs || durationMs <= 0) {
    throw new Error('Could not determine video duration with ffmpeg.');
  }
  return durationMs;
}

function buildAutoWindowCues(durationMs, windowSeconds) {
  const cues = [];
  const windowMs = Math.round(windowSeconds * 1000);
  let startMs = 0;
  let index = 1;
  while (startMs < durationMs) {
    const endMs = Math.min(durationMs, startMs + windowMs);
    cues.push({
      id: `auto-${String(index).padStart(2, '0')}`,
      start: formatCueTime(startMs),
      end: formatCueTime(endMs),
      startMs,
      endMs,
      speaker: '',
      sourceLanguage: 'de',
      notes: `Auto-generated ${windowSeconds}s window`,
    });
    startMs = endMs;
    index += 1;
  }
  return cues;
}

function buildSubtitlePrompt(languageHint) {
  if (languageHint.startsWith('de')) {
    return 'The spoken language is German (de-DE). Listen carefully to the audio and translate what is spoken into natural English subtitle text. Output English only. Never output German words, German spelling, bilingual text, labels, notes, or explanations. If a name is spoken, keep the name. Output only one clean English subtitle sentence.';
  }
  if (languageHint.startsWith('el')) {
    return 'The spoken language is Greek (el-GR). Listen carefully to the audio and translate what is spoken into natural English subtitle text. Output English only. Never output Greek words, Greek script, bilingual text, labels, notes, or explanations. If a name is spoken, keep the name. Output only one clean English subtitle sentence.';
  }
  if (languageHint.startsWith('en')) {
    return 'The spoken language is English (en). Listen carefully to the audio and output only the exact English subtitle text for what is spoken. Do not add labels, quotes, notes, or explanations. Output only the English subtitle text.';
  }
  throw new Error(`Unsupported sourceLanguage: ${languageHint}`);
}

function buildTranscribePrompt(languageHint) {
  if (languageHint.startsWith('el')) {
    return 'The spoken language is most likely Greek (el-GR). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is Greek, return only Greek script. If a short foreign word is clearly spoken, keep that word exactly as spoken. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (languageHint.startsWith('de')) {
    return 'The spoken language is most likely German (de-DE). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is German, return only German text with normal German spelling. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (languageHint.startsWith('en')) {
    return 'The spoken language is most likely English (en). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is English, return only English text. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  throw new Error(`Unsupported sourceLanguage: ${languageHint}`);
}

function buildTextTranslatePrompt(sourceText, languageHint) {
  if (languageHint.startsWith('de')) {
    return `Translate this German text into natural English subtitle text. Preserve names exactly when possible. Output English only. Do not include the original German. Do not add labels, notes, or explanations.\n\n${sourceText}`;
  }
  if (languageHint.startsWith('el')) {
    return `Translate this Greek text into natural English subtitle text. Preserve names exactly when possible. Output English only. Do not include the original Greek. Do not add labels, notes, or explanations.\n\n${sourceText}`;
  }
  if (languageHint.startsWith('en')) {
    return `Clean up this English subtitle text. Output English only. Do not add labels, notes, or explanations.\n\n${sourceText}`;
  }
  throw new Error(`Unsupported sourceLanguage: ${languageHint}`);
}

function cleanSubtitleText(text) {
  let cleaned = String(text ?? '').replace(/\r/g, '').trim();
  cleaned = cleaned.replace(/^English:\s*/i, '');
  cleaned = cleaned.replace(/^Subtitle:\s*/i, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^["']+|["']+$/g, '').trim();
  return cleaned;
}

function cleanTranscriptText(text) {
  let cleaned = String(text ?? '').replace(/\r/g, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^["']+|["']+$/g, '').trim();
  return cleaned;
}

function countAsciiWords(text) {
  const matches = text.match(/\b[A-Za-z][A-Za-z'-]*\b/g);
  return matches ? matches.length : 0;
}

function countGreekChars(text) {
  const matches = text.match(/[\u0370-\u03FF\u1F00-\u1FFF]/g);
  return matches ? matches.length : 0;
}

function countGermanMarkers(text) {
  const matches = text.match(/\b(und|nicht|der|die|das|nach|mein|meinem|aber|ist|ein|eine|für|mit|von|zu)\b/gi);
  return matches ? matches.length : 0;
}

function needsEnglishFallback(text, languageHint) {
  const asciiWords = countAsciiWords(text);
  if (languageHint.startsWith('en')) {
    return asciiWords < 2;
  }
  if (asciiWords === 0) return true;
  if (countGreekChars(text) > 0) return true;
  if (languageHint.startsWith('de') && countGermanMarkers(text) >= 2) return true;
  return false;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applyGlossary(text, glossary) {
  let result = String(text ?? '');
  for (const entry of glossary) {
    if (entry.mode === 'word') {
      const pattern = new RegExp(`\\b${escapeRegex(entry.from)}\\b`, 'gi');
      result = result.replace(pattern, entry.to);
    } else {
      const pattern = new RegExp(escapeRegex(entry.from), 'gi');
      result = result.replace(pattern, entry.to);
    }
  }
  return result;
}

async function fetchOllamaTags() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`Ollama replied with HTTP ${res.status} while checking installed models.`);
  }
  return res.json();
}

async function validateOllamaModel() {
  const tags = await fetchOllamaTags();
  const names = Array.isArray(tags.models) ? tags.models.map((item) => item.name) : [];
  if (!names.includes(TRANSCRIBE_MODEL)) {
    throw new Error(`Required model not installed: ${TRANSCRIBE_MODEL}`);
  }
}

async function extractCueAudio(ffmpegPath, videoPath, cue, outputWavPath) {
  const args = [
    '-y',
    '-ss', cue.start,
    '-to', cue.end,
    '-i', videoPath,
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'pcm_s16le',
    outputWavPath,
  ];
  const result = await runProcess(ffmpegPath, args);
  if (result.code !== 0 || !fileExists(outputWavPath)) {
    throw new Error(`ffmpeg failed for cue ${cue.id}: ${result.stderr.trim() || 'unknown error'}`);
  }
}

async function transcribeCueToEnglish(audioBase64, languageHint) {
  const body = {
    model: TRANSCRIBE_MODEL,
    messages: [{
      role: 'user',
      images: [audioBase64],
      content: buildSubtitlePrompt(languageHint),
    }],
    think: OLLAMA_TRANSCRIBE_PROFILE.think,
    keep_alive: OLLAMA_TRANSCRIBE_PROFILE.keepAlive,
    stream: false,
    options: { num_ctx: OLLAMA_TRANSCRIBE_PROFILE.numCtx },
  };
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${text}`);
  }
  const payload = JSON.parse(text);
  const subtitle = cleanSubtitleText(payload?.message?.content ?? '');
  if (!subtitle) {
    throw new Error('Empty subtitle text returned.');
  }
  return subtitle;
}

async function transcribeCueToSource(audioBase64, languageHint) {
  const body = {
    model: TRANSCRIBE_MODEL,
    messages: [{
      role: 'user',
      images: [audioBase64],
      content: buildTranscribePrompt(languageHint),
    }],
    think: OLLAMA_TRANSCRIBE_PROFILE.think,
    keep_alive: OLLAMA_TRANSCRIBE_PROFILE.keepAlive,
    stream: false,
    options: { num_ctx: OLLAMA_TRANSCRIBE_PROFILE.numCtx },
  };
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${text}`);
  }
  const payload = JSON.parse(text);
  const transcript = cleanTranscriptText(payload?.message?.content ?? '');
  if (!transcript) {
    throw new Error('Empty transcript returned.');
  }
  return transcript;
}

async function translateTextToEnglish(sourceText, languageHint) {
  const body = {
    model: TRANSCRIBE_MODEL,
    messages: [{
      role: 'user',
      content: buildTextTranslatePrompt(sourceText, languageHint),
    }],
    think: OLLAMA_TRANSCRIBE_PROFILE.think,
    keep_alive: OLLAMA_TRANSCRIBE_PROFILE.keepAlive,
    stream: false,
    options: { num_ctx: OLLAMA_TRANSCRIBE_PROFILE.numCtx },
  };
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama HTTP ${res.status}: ${text}`);
  }
  const payload = JSON.parse(text);
  const subtitle = cleanSubtitleText(payload?.message?.content ?? '');
  if (!subtitle) {
    throw new Error('Empty translated subtitle text returned.');
  }
  return subtitle;
}

function buildSrt(entries) {
  return entries.map((entry, index) => {
    return [
      String(index + 1),
      `${formatSrtTime(entry.startMs)} --> ${formatSrtTime(entry.endMs)}`,
      entry.subtitle,
      '',
    ].join('\n');
  }).join('\n');
}

function ensureDir(fullPath) {
  fs.mkdirSync(fullPath, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const videoPath = path.resolve(args.video);
  const cuePath = args.cues ? path.resolve(args.cues) : '';
  const outDir = path.resolve(args.outDir || path.join(path.dirname(videoPath), 'subtitle-output'));

  if (!fileExists(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
  if (cuePath && !fileExists(cuePath)) throw new Error(`Cue file not found: ${cuePath}`);

  const ffmpegPath = findFfmpegBinary();
  if (!ffmpegPath) {
    throw new Error('ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH.');
  }

  const cues = cuePath
    ? loadCueSheet(cuePath, args.only)
    : buildAutoWindowCues(await getVideoDurationMs(ffmpegPath, videoPath), args.windowSeconds);
  const glossary = loadGlossary(args.glossary);
  await validateOllamaModel();

  console.log(`Video: ${videoPath}`);
  console.log(`Cue sheet: ${cuePath || '(auto-window mode)'}`);
  console.log(`FFmpeg: ${ffmpegPath}`);
  console.log(`Model: ${TRANSCRIBE_MODEL}`);
  console.log(`Cues selected: ${cues.length}`);
  console.log(`Glossary entries: ${glossary.length}`);

  if (args.dryRun) return;

  ensureDir(outDir);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gemma4kids-subtitles-'));
  const entries = [];
  const review = [];

  try {
    for (const cue of cues) {
      console.log(`Processing cue ${cue.id} (${cue.start} -> ${cue.end}, ${cue.sourceLanguage})`);
      const wavPath = path.join(tempRoot, `${cue.id}.wav`);
      await extractCueAudio(ffmpegPath, videoPath, cue, wavPath);
      const audioBase64 = fs.readFileSync(wavPath).toString('base64');
      const transcript = await transcribeCueToSource(audioBase64, cue.sourceLanguage);
      const firstPass = await translateTextToEnglish(transcript, cue.sourceLanguage);
      const subtitle = cleanSubtitleText(applyGlossary(
        needsEnglishFallback(firstPass, cue.sourceLanguage)
          ? await translateTextToEnglish(firstPass, cue.sourceLanguage)
          : firstPass,
        glossary,
      ));
      entries.push({
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        subtitle,
      });
      review.push({
        id: cue.id,
        start: cue.start,
        end: cue.end,
        speaker: cue.speaker,
        sourceLanguage: cue.sourceLanguage,
        notes: cue.notes,
        transcript,
        firstPass,
        subtitle,
        status: 'ok',
      });
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const srtPath = path.join(outDir, 'subtitles.en.srt');
  const reviewPath = path.join(outDir, 'segments-review.json');
  fs.writeFileSync(srtPath, buildSrt(entries), 'utf8');
  fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2), 'utf8');

  console.log(`Wrote ${srtPath}`);
  console.log(`Wrote ${reviewPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
