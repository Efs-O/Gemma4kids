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

type MediaPermissionDetails = {
  mediaType?: 'audio' | 'video' | 'unknown';
  requestingUrl?: string;
};

function isTrustedMediaRequest(details: MediaPermissionDetails | undefined): boolean {
  const url = details?.requestingUrl ?? '';
  return url.startsWith('file://') || url.startsWith('devtools://');
}

function isAudioOnlyMediaPermission(permission: string, details: MediaPermissionDetails | undefined): boolean {
  return permission === 'media'
    && details?.mediaType === 'audio'
    && isTrustedMediaRequest(details);
}

function hasMacMicrophoneAccess(): boolean {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.getMediaAccessStatus('microphone') === 'granted';
}

async function requestMacMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  if (status === 'denied' || status === 'restricted' || status === 'unknown') return false;
  if (status === 'not-determined') {
    try {
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  }
  return false;
}

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
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
      if (!isAudioOnlyMediaPermission(permission, details)) {
        callback(false);
        return;
      }
      void requestMacMicrophoneAccess().then(callback).catch(() => callback(false));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission, _origin, details) => {
      return isAudioOnlyMediaPermission(permission, details) && hasMacMicrophoneAccess();
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

registerAnimationIpcHandlers(ipcMain);
registerLlamaRuntimeIpcHandlers(ipcMain);
registerLlamaSttIpcHandlers(ipcMain);
registerVideoPreprocessIpcHandlers(ipcMain);
registerTtsIpcHandlers(ipcMain);
