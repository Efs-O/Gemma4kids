import { app, BrowserWindow, ipcMain, Menu, session, systemPreferences } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import path from 'path';
import fs from 'fs';
import { ensureAnimationsDir, registerAnimationIpcHandlers } from './animationStore';
import { cleanupLlamaRuntimeOnQuit, registerLlamaRuntimeIpcHandlers } from './llamaRuntime';
import { registerLlamaSttIpcHandlers } from './llamaSttRuntime';
import { registerVideoPreprocessIpcHandlers } from './videoPreprocess';
import { registerTtsIpcHandlers } from './ttsMain';

let isQuittingAfterCleanup = false;

/** Window/taskbar icon: dev = repo assets/; packaged = assets bundled next to package.json (electron-builder.yml). */
function resolveAppIconPath(): string | undefined {
  const base = app.isPackaged
    ? path.join(app.getAppPath(), 'assets')
    : path.join(__dirname, '..', '..', 'assets');
  const names =
    process.platform === 'win32'
      ? (['icon.ico', 'icon.png'] as const)
      : process.platform === 'darwin'
        ? (['icon.icns', 'icon.png'] as const)
        : (['icon.png', 'icon.ico'] as const);
  for (const name of names) {
    const full = path.join(base, name);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

function createWindow(): void {
  const iconPath = resolveAppIconPath();
  const options: BrowserWindowConstructorOptions = {
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
  };
  if (iconPath !== undefined) {
    options.icon = iconPath;
  }
  const win = new BrowserWindow(options);

  win.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
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

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existingWindow = BrowserWindow.getAllWindows()[0];
    if (existingWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.focus();
      return;
    }
    createWindow();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.gemma4kids.app');
    }
    Menu.setApplicationMenu(null);
    ensureAnimationsDir();
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (isQuittingAfterCleanup) {
    return;
  }

  event.preventDefault();
  void cleanupLlamaRuntimeOnQuit().finally(() => {
    isQuittingAfterCleanup = true;
    app.quit();
  });
});

ipcMain.handle('check-path-exists', (_event, filePath: string) => fs.existsSync(filePath));
ipcMain.handle('request-microphone-access', async () => {
  if (process.platform !== 'darwin') {
    return { granted: true, status: 'granted' };
  }

  const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (currentStatus === 'granted') {
    return { granted: true, status: currentStatus };
  }

  const granted = await systemPreferences.askForMediaAccess('microphone');
  const status = systemPreferences.getMediaAccessStatus('microphone');
  return { granted, status };
});

registerAnimationIpcHandlers(ipcMain);
registerLlamaRuntimeIpcHandlers(ipcMain);
registerLlamaSttIpcHandlers(ipcMain);
registerVideoPreprocessIpcHandlers(ipcMain);
registerTtsIpcHandlers(ipcMain);
