import { app, BrowserWindow, ipcMain, shell, Menu, session } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

function getAnimationsDir(): string {
  return path.join(app.getPath('documents'), 'KidAnimations');
}

function ensureAnimationsDir(): void {
  const dir = getAnimationsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Gemma4kids',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Dev-only DevTools shortcuts: F12 and Ctrl/Cmd+Shift+I.
  // Disabled in packaged builds so kids can't open DevTools by accident.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const isF12 = input.key === 'F12';
      const isInspect =
        (input.control || input.meta) && input.shift && input.key.toLowerCase() === 'i';
      if (isF12 || isInspect) {
        win.webContents.toggleDevTools();
      }
    });
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensureAnimationsDir();
  // Allow microphone access from the local file:// renderer.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC handlers (stubs for Day 2 — wired fully on Day 7) ---

ipcMain.handle('save-animation', async (_event, { filename, html_content }: { filename: string; html_content: string }) => {
  try {
    ensureAnimationsDir();
    let target = filename.endsWith('.html') ? filename : `${filename}.html`;
    let fullPath = path.join(getAnimationsDir(), target);
    // Collision: if content differs, append -2, -3, ...
    if (fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath, 'utf-8');
      if (existing !== html_content) {
        const base = target.replace(/\.html$/, '');
        let n = 2;
        while (fs.existsSync(path.join(getAnimationsDir(), `${base}-${n}.html`))) n++;
        target = `${base}-${n}.html`;
        fullPath = path.join(getAnimationsDir(), target);
      }
    }
    fs.writeFileSync(fullPath, html_content, 'utf-8');
    return { success: true, filename: target, path: fullPath };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('read-animation', async (_event, { filename }: { filename: string }) => {
  try {
    const name = filename.endsWith('.html') ? filename : `${filename}.html`;
    const fullPath = path.join(getAnimationsDir(), name);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('list-animations', async () => {
  try {
    ensureAnimationsDir();
    const files = fs.readdirSync(getAnimationsDir()).filter(f => f.endsWith('.html'));
    return { success: true, files };
  } catch (err) {
    return { success: false, files: [], error: String(err) };
  }
});

ipcMain.handle('delete-animation', async (_event, { filename }: { filename: string }) => {
  try {
    const name = filename.endsWith('.html') ? filename : `${filename}.html`;
    const fullPath = path.join(getAnimationsDir(), name);
    fs.unlinkSync(fullPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('open-in-browser', async (_event, { filename }: { filename: string }) => {
  try {
    const name = filename.endsWith('.html') ? filename : `${filename}.html`;
    const fullPath = path.join(getAnimationsDir(), name);
    await shell.openExternal(`file://${fullPath}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

// --- TTS helpers ---

function findPiperBinary(): string | null {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');
  const ext = process.platform === 'win32' ? '.exe' : '';
  const candidates = [
    path.join(appRoot, 'piper', `piper${ext}`),
    path.join(userData, 'piper', `piper${ext}`),
  ];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

interface VoiceInfo { model: string; sampleRate: number; name: string; lang: string; }

function scanVoices(): VoiceInfo[] {
  const appRoot = app.getAppPath();
  const userData = app.getPath('userData');
  const dirs = [path.join(appRoot, 'voices'), path.join(userData, 'voices')];
  const found: VoiceInfo[] = [];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const onnxFiles = fs.readdirSync(dir).filter(f => f.endsWith('.onnx'));
    for (const f of onnxFiles) {
      const model = path.join(dir, f);
      const jsonPath = model + '.json';
      if (!fs.existsSync(jsonPath)) continue;
      const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, unknown>;
      const audio = cfg['audio'] as Record<string, unknown> | undefined;
      const espeak = cfg['espeak'] as Record<string, unknown> | undefined;
      const sampleRate = typeof audio?.['sample_rate'] === 'number' ? audio['sample_rate'] : 22050;
      const lang = typeof espeak?.['voice'] === 'string' ? espeak['voice'] : f.split('-')[0];
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
  header.writeUInt16LE(1, 22);  // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

// --- TTS IPC handlers ---

ipcMain.handle('tts-speak', async (_event, text: string, lang?: string): Promise<Buffer> => {
  const binary = findPiperBinary();
  if (!binary) throw new Error('Piper binary not found. Place piper.exe in <project>/piper/');

  const voices = scanVoices();
  if (voices.length === 0) throw new Error('No voice models found. Run: npm run download-voices');

  // Select voice by text language hint → fallback English → fallback first available
  const hint = (lang ?? 'en').slice(0, 2).toLowerCase();
  const voice =
    voices.find(v => v.lang.toLowerCase().startsWith(hint)) ??
    voices.find(v => v.lang.toLowerCase().startsWith('en')) ??
    voices[0];

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn(binary, ['--model', voice.model, '--output-raw']);
    proc.stdin.write(text);
    proc.stdin.end();
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code: number | null) => {
      if (code !== 0) { reject(new Error(`Piper exited with code ${String(code)}`)); return; }
      const pcm = Buffer.concat(chunks);
      resolve(Buffer.concat([buildWavHeader(pcm.length, voice.sampleRate), pcm]));
    });
  });
});

ipcMain.handle('tts-list-voices', async () => {
  return scanVoices().map(({ model: _m, sampleRate, name, lang }) => ({ name, lang, sampleRate }));
});
