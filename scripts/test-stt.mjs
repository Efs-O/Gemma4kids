/**
 * STT smoke test — no microphone needed.
 * 1. Synthesises speech with Piper (English voice).
 * 2. Resamples to 16 kHz mono WAV in-process.
 * 3. Sends to Ollama Gemma4:e4b via the images-field workaround.
 * 4. Prints the transcription.
 *
 * Usage:  node scripts/test-stt.mjs
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIPER = path.join(ROOT, 'piper', 'piper.exe');
const VOICE = path.join(ROOT, 'voices', 'en_US-amy-medium.onnx');
const OLLAMA = 'http://localhost:11434';
const MODEL  = 'gemma4:e4b';
const TEST_TEXT = 'Make a bouncing ball animation with rainbow colors.';

// ── 1. Check prerequisites ────────────────────────────────────────────────────
if (!existsSync(PIPER)) { console.error('piper.exe not found at', PIPER); process.exit(1); }
if (!existsSync(VOICE)) { console.error('Voice not found at', VOICE); process.exit(1); }

// ── 2. Synthesise speech with Piper → raw PCM at native sample rate ───────────
console.log('Synthesising:', TEST_TEXT);
const voiceJson = JSON.parse(readFileSync(VOICE + '.json', 'utf-8'));
const nativeSR  = voiceJson?.audio?.sample_rate ?? 22050;

const piperResult = spawnSync(
  PIPER,
  ['--model', VOICE, '--output-raw'],
  { input: TEST_TEXT, maxBuffer: 10 * 1024 * 1024 }
);
if (piperResult.status !== 0) {
  console.error('Piper failed:', piperResult.stderr?.toString());
  process.exit(1);
}
const nativePcm = piperResult.stdout; // Int16 LE mono at nativeSR

// ── 3. Resample to 16 kHz mono (linear interpolation) ────────────────────────
const TARGET_SR = 16000;
const ratio      = nativeSR / TARGET_SR;
const srcSamples = nativePcm.length / 2;           // Int16 = 2 bytes per sample
const dstLen     = Math.ceil(srcSamples / ratio);
const dst        = new Int16Array(dstLen);
const src        = new Int16Array(nativePcm.buffer, nativePcm.byteOffset, srcSamples);

for (let i = 0; i < dstLen; i++) {
  const pos  = i * ratio;
  const lo   = Math.floor(pos);
  const hi   = Math.min(lo + 1, srcSamples - 1);
  const frac = pos - lo;
  dst[i]     = Math.round(src[lo] * (1 - frac) + src[hi] * frac);
}

// ── 4. Build RIFF/WAV header ──────────────────────────────────────────────────
const pcmLen = dst.byteLength;
const wav    = Buffer.alloc(44 + pcmLen);
wav.write('RIFF', 0);           wav.writeUInt32LE(36 + pcmLen, 4);
wav.write('WAVE', 8);           wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);      wav.writeUInt16LE(1, 20);   // PCM
wav.writeUInt16LE(1, 22);       // mono
wav.writeUInt32LE(TARGET_SR, 24);
wav.writeUInt32LE(TARGET_SR * 2, 28);
wav.writeUInt16LE(2, 32);       wav.writeUInt16LE(16, 34);
wav.write('data', 36);          wav.writeUInt32LE(pcmLen, 40);
Buffer.from(dst.buffer).copy(wav, 44);

const base64 = wav.toString('base64');
console.log(`WAV size: ${wav.length} bytes  (${(wav.length/1024).toFixed(1)} KB)`);

// ── 5. Send to Ollama ─────────────────────────────────────────────────────────
console.log(`Sending to Ollama (${MODEL}) …`);
const body = JSON.stringify({
  model: MODEL,
  messages: [{
    role: 'user',
    images: [base64],
    content: 'Transcribe the speech in the audio. Output only the transcription text, no newlines. Write numbers as digits.',
  }],
  think: false,
  keep_alive: 0,
  stream: false,
  options: { num_ctx: 8192 },
});

const res = await fetch(`${OLLAMA}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Ollama HTTP ${res.status}:`, text);
  process.exit(1);
}

const data = await res.json();
const transcription = data?.message?.content?.trim() ?? '(empty)';
console.log('\n── Transcription ──────────────────────────────');
console.log(transcription);
console.log('── Expected (approx) ──────────────────────────');
console.log(TEST_TEXT);
