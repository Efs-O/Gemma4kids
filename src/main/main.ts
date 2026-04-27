import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';

const ANIMATIONS_DIR = path.join(app.getPath('documents'), 'KidAnimations');

function ensureAnimationsDir(): void {
  if (!fs.existsSync(ANIMATIONS_DIR)) {
    fs.mkdirSync(ANIMATIONS_DIR, { recursive: true });
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
}

app.whenReady().then(() => {
  ensureAnimationsDir();
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
    let fullPath = path.join(ANIMATIONS_DIR, target);
    // Collision: if content differs, append -2, -3, ...
    if (fs.existsSync(fullPath)) {
      const existing = fs.readFileSync(fullPath, 'utf-8');
      if (existing !== html_content) {
        const base = target.replace(/\.html$/, '');
        let n = 2;
        while (fs.existsSync(path.join(ANIMATIONS_DIR, `${base}-${n}.html`))) n++;
        target = `${base}-${n}.html`;
        fullPath = path.join(ANIMATIONS_DIR, target);
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
    const fullPath = path.join(ANIMATIONS_DIR, name);
    const content = fs.readFileSync(fullPath, 'utf-8');
    return { success: true, content };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('list-animations', async () => {
  try {
    ensureAnimationsDir();
    const files = fs.readdirSync(ANIMATIONS_DIR).filter(f => f.endsWith('.html'));
    return { success: true, files };
  } catch (err) {
    return { success: false, files: [], error: String(err) };
  }
});

ipcMain.handle('open-in-browser', async (_event, { filename }: { filename: string }) => {
  try {
    const name = filename.endsWith('.html') ? filename : `${filename}.html`;
    const fullPath = path.join(ANIMATIONS_DIR, name);
    await shell.openExternal(`file://${fullPath}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});
