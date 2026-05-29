import { app, type IpcMain } from 'electron';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface VoiceInfo {
  model: string;
  sampleRate: number;
  name: string;
  lang: string;
}

function ttsSearchRoots(): string[] {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');
  const resourceRoot = process.resourcesPath;
  return [...new Set([resourceRoot, appRoot, userData].map((v) => v.trim()).filter(Boolean))];
}

function preferredPiperArch(): 'x64' | 'aarch64' {
  return process.arch === 'arm64' ? 'aarch64' : 'x64';
}

function piperPlatformDirName(): 'win' | 'mac' | 'linux' {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

function platformPiperDirs(root: string): string[] {
  const arch = preferredPiperArch();
  const platformDir = piperPlatformDirName();
  if (process.platform === 'win32') {
    return [path.join(root, 'piper', 'win'), path.join(root, 'piper')];
  }
  return [
    path.join(root, 'piper', platformDir, arch),
    path.join(root, 'piper', platformDir, 'x64'),
    path.join(root, 'piper', platformDir, 'aarch64'),
    path.join(root, 'piper', platformDir),
    path.join(root, 'piper'),
  ];
}

function piperSearchDirs(): string[] {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');
  const resourceRoot = process.resourcesPath;
  return [...new Set([
    ...platformPiperDirs(resourceRoot),
    ...platformPiperDirs(appRoot),
    path.join(userData, 'piper'),
  ])];
}

function recursiveFindBinary(startDir: string, binaryName: string, depth = 4): string | null {
  if (depth < 0 || !fs.existsSync(startDir) || !fs.statSync(startDir).isDirectory()) return null;
  const direct = path.join(startDir, binaryName);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;

  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = recursiveFindBinary(path.join(startDir, entry.name), binaryName, depth - 1);
    if (found) return found;
  }
  return null;
}

function findPiperArchive(): string | null {
  const patterns = process.platform === 'darwin'
    ? [/^piper_macos_.*\.tar\.gz$/i]
    : [/^piper_linux_.*\.tar\.gz$/i];
  for (const dir of piperSearchDirs()) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (patterns.some((pattern) => pattern.test(file))) {
        return path.join(dir, file);
      }
    }
  }
  return null;
}

function extractPiperArchive(archivePath: string): string | null {
  const cacheRoot = path.join(app.getPath('userData'), 'piper', 'extracted');
  const archiveName = path.basename(archivePath, '.tar.gz');
  const targetDir = path.join(cacheRoot, archiveName);
  const binaryName = process.platform === 'win32' ? 'piper.exe' : 'piper';
  const cachedBinary = recursiveFindBinary(targetDir, binaryName, 5);
  if (cachedBinary) return cachedBinary;

  fs.mkdirSync(targetDir, { recursive: true });
  const result = spawnSync('tar', ['-xzf', archivePath, '-C', targetDir], {
    stdio: 'pipe',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }

  const extractedBinary = recursiveFindBinary(targetDir, binaryName, 5);
  if (extractedBinary && process.platform !== 'win32') {
    try {
      fs.chmodSync(extractedBinary, 0o755);
    } catch {
      // best effort
    }
  }
  return extractedBinary;
}

function findPiperBinary(): string | null {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `piper${ext}`;

  for (const dir of piperSearchDirs()) {
    const found = recursiveFindBinary(dir, binaryName, 5);
    if (found) return found;
  }

  if (process.platform !== 'win32') {
    const archive = findPiperArchive();
    if (archive) {
      return extractPiperArchive(archive);
    }
  }

  return null;
}

function scanVoices(): VoiceInfo[] {
  const dirs = ttsSearchRoots().map((root) => path.join(root, 'voices'));
  const found: VoiceInfo[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const onnxFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.onnx'));
    for (const f of onnxFiles) {
      const model = path.join(dir, f);
      const jsonPath = model + '.json';
      if (!fs.existsSync(jsonPath)) continue;
      const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>;
      const audio = cfg.audio as Record<string, unknown> | undefined;
      const espeak = cfg.espeak as Record<string, unknown> | undefined;
      const sampleRate = typeof audio?.sample_rate === 'number' ? audio.sample_rate : 22050;
      const lang = typeof espeak?.voice === 'string' ? espeak.voice : f.split('-')[0];
      found.push({ model, sampleRate, name: f.replace('.onnx', ''), lang });
    }
  }
  return found;
}

function buildWavHeader(pcmLength: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

function macSayVoice(lang: string | undefined): string {
  const hint = (lang ?? 'en').slice(0, 2).toLowerCase();
  if (hint === 'el') return 'Melina';
  if (hint === 'de') return 'Anna';
  return 'Samantha';
}

function runMacAudioTool(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      reject(new Error(`${command} exited with code ${String(code)}${detail ? `: ${detail}` : ''}`));
    });
  });
}

function speakWithSay(text: string, lang: string | undefined): Promise<Buffer> {
  const voice = macSayVoice(lang);
  const tempDir = app.getPath('temp');
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const aiffPath = path.join(tempDir, `g4k_tts_${stamp}.aiff`);
  const wavPath = path.join(tempDir, `g4k_tts_${stamp}.wav`);
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn('say', ['-v', voice, '-o', aiffPath, '--', text], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    proc.on('error', reject);
    proc.on('close', async (code: number | null) => {
      try {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString('utf8').trim();
          throw new Error(`say exited with code ${String(code)}${detail ? `: ${detail}` : ''}`);
        }
        await runMacAudioTool('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, wavPath]);
        resolve(fs.readFileSync(wavPath));
      } catch (err) {
        reject(err);
      } finally {
        try { fs.unlinkSync(aiffPath); } catch { /* best effort */ }
        try { fs.unlinkSync(wavPath); } catch { /* best effort */ }
      }
    });
  });
}

function selectVoice(voices: VoiceInfo[], lang: string | undefined): VoiceInfo {
  const hint = (lang ?? 'en').slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith(hint)) ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    voices[0]
  );
}

// macOS arm-build piper uses --output_file instead of --output-raw (self-contained PyInstaller bundle)
function speakWithPiperFile(binary: string, text: string, lang: string | undefined): Promise<Buffer> {
  const voices = scanVoices();
  if (voices.length === 0) throw new Error('No voice models found. Run: npm run download-voices');
  const voice = selectVoice(voices, lang);
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const wavPath = path.join(app.getPath('temp'), `g4k_tts_${stamp}.wav`);

  try { fs.chmodSync(binary, 0o755); } catch { /* best effort */ }

  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(binary, ['--model', voice.model, '--output_file', wavPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stderr: Buffer[] = [];
    proc.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      try {
        if (code !== 0) {
          const detail = Buffer.concat(stderr).toString('utf8').trim();
          reject(new Error(`Piper exited with code ${String(code)}${detail ? `: ${detail}` : ''}`));
          return;
        }
        resolve(fs.readFileSync(wavPath));
      } catch (err) {
        reject(err);
      } finally {
        try { fs.unlinkSync(wavPath); } catch { /* best effort */ }
      }
    });
  });
}

export function registerTtsIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('tts-speak', async (_event, text: string, lang?: string): Promise<Buffer> => {
    if (process.platform === 'darwin') {
      const binary = findPiperBinary();
      if (binary) return speakWithPiperFile(binary, text, lang);
      // fallback: no piper binary bundled, use system say
      return speakWithSay(text, lang);
    }

    const binary = findPiperBinary();
    if (!binary) throw new Error('Piper binary not found. Put bundled Piper files in resources/piper or dev files under piper/win, piper/mac, or piper/linux.');

    const voices = scanVoices();
    if (voices.length === 0) throw new Error('No voice models found. Put bundled voice files in resources/voices or run: npm run download-voices');

    const voice = selectVoice(voices, lang);

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const proc = spawn(binary, ['--model', voice.model, '--output-raw']);
      proc.stdin.write(text);
      proc.stdin.end();
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.on('error', reject);
      proc.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${String(code)}`));
          return;
        }
        const pcm = Buffer.concat(chunks);
        resolve(Buffer.concat([buildWavHeader(pcm.length, voice.sampleRate), pcm]));
      });
    });
  });

  ipcMain.handle('tts-list-voices', async () => {
    return scanVoices().map(({ model: _m, sampleRate, name, lang }) => ({ name, lang, sampleRate }));
  });
}
