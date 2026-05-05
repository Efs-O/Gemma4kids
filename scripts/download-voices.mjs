/**
 * Download Piper voice models for Gemma4kids.
 * Fetches all 3 voice pairs (.onnx + .onnx.json) from HuggingFace.
 *
 * Usage: npm run download-voices
 * Output: ./voices/
 */

import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOICES_DIR = resolve(__dirname, '..', 'voices');
const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0';

const VOICES = [
  { name: 'en_US-amy-medium',         path: 'en/en_US/amy/medium/en_US-amy-medium' },
  { name: 'de_DE-eva_k-x_low',        path: 'de/de_DE/eva_k/x_low/de_DE-eva_k-x_low' },
  { name: 'el_GR-rapunzelina-medium', path: 'el/el_GR/rapunzelina/medium/el_GR-rapunzelina-medium' },
];

async function download(url, dest) {
  if (existsSync(dest)) {
    console.log('  SKIP  (already exists)');
    return;
  }

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const total = parseInt(res.headers.get('content-length') ?? '0', 10);
  let downloaded = 0;

  const fileStream = createWriteStream(dest);

  try {
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (source) {
        for await (const chunk of source) {
          downloaded += chunk.length;
          if (total) {
            const pct = Math.round((downloaded / total) * 100);
            const mb = Math.round(total / 1024 / 1024);
            process.stdout.write(`\r  ${pct}% of ${mb} MB   `);
          }
          yield chunk;
        }
        process.stdout.write('\n');
      },
      fileStream,
    );
  } catch (err) {
    // Clean up partial file on failure
    try { unlinkSync(dest); } catch { /* ignore */ }
    throw err;
  }
}

async function main() {
  console.log('\n=== Gemma4kids — Download Piper Voices ===\n');
  mkdirSync(VOICES_DIR, { recursive: true });
  console.log(`Output: ${VOICES_DIR}\n`);

  for (const voice of VOICES) {
    console.log(`Voice: ${voice.name}`);
    const onnxDest = resolve(VOICES_DIR, `${voice.name}.onnx`);
    const jsonDest = resolve(VOICES_DIR, `${voice.name}.onnx.json`);

    process.stdout.write(`  .onnx      ... `);
    await download(`${HF_BASE}/${voice.path}.onnx`, onnxDest);

    process.stdout.write(`  .onnx.json ... `);
    await download(`${HF_BASE}/${voice.path}.onnx.json`, jsonDest);

    console.log('');
  }

  console.log('All voices downloaded to ./voices/');
  console.log('Next: node scripts/test-piper.mjs --binary ./piper/piper.exe --model ./voices/en_US-lessac-high.onnx\n');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
