/**
 * Piper TTS pipeline test — run before integration.
 *
 * Usage:
 *   node scripts/test-piper.mjs --binary ./piper --model ./en_US-amy-medium.onnx
 *
 * Output:
 *   scripts/tts-test-output/01-greeting.wav
 *   scripts/tts-test-output/02-short.wav
 *   scripts/tts-test-output/03-code-explanation.wav
 *   scripts/tts-test-output/04-encouragement.wav
 *   scripts/tts-test-output/05-excited.wav
 *
 * Play each .wav to judge quality. If all pass, Piper is ready for integration.
 */

import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, 'tts-test-output');

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };
  return {
    binary: resolve(get('--binary') ?? './piper'),
    model:  resolve(get('--model')  ?? './en_US-amy-medium.onnx'),
  };
}

// ---------------------------------------------------------------------------
// Test phrases — kid-friendly, covers short/medium/long and punctuation
// ---------------------------------------------------------------------------

const PHRASES = [
  { name: '01-greeting',         text: 'Hi! I am Gemma, your coding teacher. Let\'s build something amazing together!' },
  { name: '02-short',            text: 'Great job! You did it.' },
  { name: '03-code-explanation', text: 'This line of code tells the computer to move the ball 10 pixels to the right every time the screen refreshes. That\'s how animation works!' },
  { name: '04-encouragement',    text: 'Don\'t worry if it looks tricky. Every coder makes mistakes. That\'s how we learn. Try changing the number and see what happens!' },
  { name: '05-excited',          text: 'Whoa! Look at that! Your balloon is floating all the way to the top of the screen. You just wrote your first animation!' },
];

// ---------------------------------------------------------------------------
// Run Piper for a single phrase
// ---------------------------------------------------------------------------

function runPiper(binary, model, text) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    const proc = spawn(binary, [
      '--model', model,
      '--output-raw',   // raw PCM on stdout
    ]);

    proc.stdin.write(text);
    proc.stdin.end();

    proc.stdout.on('data', (chunk) => chunks.push(chunk));

    proc.stderr.on('data', (data) => {
      // Piper writes progress to stderr — ignore unless process fails
      void data;
    });

    proc.on('error', (err) => reject(new Error(`Failed to spawn Piper: ${err.message}`)));

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Piper exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

// ---------------------------------------------------------------------------
// Read sample rate from .onnx.json — never hardcode
// ---------------------------------------------------------------------------

function readSampleRate(modelPath) {
  const jsonPath = modelPath + '.json';
  if (!existsSync(jsonPath)) return 22050;
  try {
    const cfg = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    return cfg?.audio?.sample_rate ?? 22050;
  } catch {
    return 22050;
  }
}

// ---------------------------------------------------------------------------
// Wrap raw PCM in a minimal WAV header (mono, 16-bit signed LE)
// ---------------------------------------------------------------------------

function buildWav(pcmBuffer, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { binary, model } = parseArgs();

  console.log('\n=== Piper TTS Pipeline Test ===\n');
  console.log(`Binary : ${binary}`);
  console.log(`Model  : ${model}`);
  console.log(`Output : ${OUTPUT_DIR}\n`);

  // Preflight checks
  let preflight = true;

  if (!existsSync(binary)) {
    console.error(`ERROR: Piper binary not found at: ${binary}`);
    console.error('       Download from https://github.com/rhasspy/piper/releases');
    preflight = false;
  }

  if (!existsSync(model)) {
    console.error(`ERROR: Voice model not found at: ${model}`);
    console.error('       Download from https://huggingface.co/rhasspy/piper-voices');
    preflight = false;
  }

  const jsonConfig = model + '.json';
  if (!existsSync(jsonConfig)) {
    console.error(`ERROR: Model config not found at: ${jsonConfig}`);
    console.error('       Each .onnx model needs a matching .onnx.json config file.');
    preflight = false;
  }

  if (!preflight) {
    console.error('\nPreflight failed. Fix the errors above and re-run.\n');
    process.exit(1);
  }

  const sampleRate = readSampleRate(model);
  console.log(`Sample rate: ${sampleRate} Hz (from .onnx.json)\n`);

  mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];

  for (const phrase of PHRASES) {
    process.stdout.write(`  ${phrase.name} ... `);
    const start = Date.now();

    try {
      const pcm = await runPiper(binary, model, phrase.text);
      const wav = buildWav(pcm, sampleRate);
      const outPath = resolve(OUTPUT_DIR, `${phrase.name}.wav`);
      writeFileSync(outPath, wav);

      const ms = Date.now() - start;
      const kb = Math.round(statSync(outPath).size / 1024);
      console.log(`PASS  ${ms} ms  ${kb} KB`);
      results.push({ name: phrase.name, ok: true, ms });
    } catch (err) {
      const ms = Date.now() - start;
      console.log(`FAIL  ${ms} ms  ${err.message}`);
      results.push({ name: phrase.name, ok: false, ms, error: err.message });
    }
  }

  // Summary
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  const avgMs  = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length);

  console.log('\n--- Summary ---');
  console.log(`Passed : ${passed} / ${results.length}`);
  console.log(`Failed : ${failed}`);
  console.log(`Avg    : ${avgMs} ms per phrase`);

  if (failed === 0) {
    console.log('\nAll phrases OK.');
    console.log(`Play the .wav files in ${OUTPUT_DIR} to judge voice quality.`);
    console.log('If quality is acceptable → proceed with PiperTTS integration.\n');
  } else {
    console.log('\nSome phrases failed. Check errors above before integrating.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
