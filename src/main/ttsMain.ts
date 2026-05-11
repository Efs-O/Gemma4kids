import { app, type IpcMain } from 'electron';
import { spawn } from 'child_process';
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

function devPiperDirs(appRoot: string): string[] {
  const arch = preferredPiperArch();
  if (process.platform === 'win32') {
    return [path.join(appRoot, 'piper', 'win'), path.join(appRoot, 'piper')];
  }
  if (process.platform === 'darwin') {
    return [
      path.join(appRoot, 'piper', 'mac', arch, 'piper'),
      path.join(appRoot, 'piper', 'mac', 'x64', 'piper'),
      path.join(appRoot, 'piper', 'mac', 'aarch64', 'piper'),
    ];
  }
  return [
    path.join(appRoot, 'piper', 'linux', arch, 'piper'),
    path.join(appRoot, 'piper', 'linux', 'x64', 'piper'),
    path.join(appRoot, 'piper', 'linux', 'aarch64', 'piper'),
  ];
}

function piperSearchDirs(): string[] {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');
  const resourceRoot = process.resourcesPath;
  return [...new Set([
    path.join(resourceRoot, 'piper'),
    ...devPiperDirs(appRoot),
    path.join(userData, 'piper'),
  ])];
}

function findPiperBinary(): string | null {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates = piperSearchDirs().map((dir) => path.join(dir, `piper${ext}`));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
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

export function registerTtsIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('tts-speak', async (_event, text: string, lang?: string): Promise<Buffer> => {
    const binary = findPiperBinary();
    if (!binary) throw new Error('Piper binary not found. Put bundled Piper files in resources/piper or dev files under piper/win, piper/mac, or piper/linux.');

    const voices = scanVoices();
    if (voices.length === 0) throw new Error('No voice models found. Put bundled voice files in resources/voices or run: npm run download-voices');

    const hint = (lang ?? 'en').slice(0, 2).toLowerCase();
    const voice =
      voices.find((v) => v.lang.toLowerCase().startsWith(hint)) ??
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
      voices[0];

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
