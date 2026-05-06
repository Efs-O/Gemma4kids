import { app, shell, type IpcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

function getAnimationsDir(): string {
  return path.join(app.getPath('documents'), 'KidAnimations');
}

export function ensureAnimationsDir(): void {
  const dir = getAnimationsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeAnimationFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    throw new Error('Animation name cannot be empty');
  }

  const normalized = trimmed.endsWith('.html') ? trimmed : `${trimmed}.html`;
  if (path.basename(normalized) !== normalized) {
    throw new Error('Animation name cannot include folders');
  }

  return normalized;
}

function resolveAnimationPath(filename: string): { filename: string; fullPath: string } {
  const animationsDir = getAnimationsDir();
  const normalized = normalizeAnimationFilename(filename);
  const fullPath = path.resolve(animationsDir, normalized);
  const relative = path.relative(animationsDir, fullPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Animation name must stay inside the animations folder');
  }

  return { filename: normalized, fullPath };
}

function sanitizeHtmlForSave(input: string): string {
  let html = input.trim();
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');

  const doctypeMatch = /<!DOCTYPE html>/i.exec(html);
  const htmlMatch = /<html\b/i.exec(html);
  const start = doctypeMatch?.index ?? htmlMatch?.index ?? -1;
  const endRegex = /<\/html>/gi;
  let end = -1;
  let match: RegExpExecArray | null;
  while ((match = endRegex.exec(html)) !== null) {
    end = match.index + match[0].length;
  }

  if (start !== -1 && end !== -1 && end > start) return html.slice(start, end).trim();
  if (start !== -1) return html.slice(start).trim();
  return html;
}

export function registerAnimationIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('save-animation', async (_event, { filename, html_content, source }: { filename: string; html_content: string; source?: 'gemma' | 'kid' }) => {
    try {
      ensureAnimationsDir();
      const sanitizedHtml = sanitizeHtmlForSave(html_content);
      let { filename: target, fullPath } = resolveAnimationPath(filename);
      if (fs.existsSync(fullPath)) {
        const existing = fs.readFileSync(fullPath, 'utf-8');
        if (existing !== sanitizedHtml) {
          const base = target.replace(/\.html$/, '').replace(/[-]?\d+$/, '');
          let n = 2;
          if (source === 'kid') {
            do {
              ({ filename: target, fullPath } = resolveAnimationPath(`${base}${n}.html`));
              n++;
            } while (fs.existsSync(fullPath));
          } else {
            do {
              ({ filename: target, fullPath } = resolveAnimationPath(`${base}-${n}.html`));
              n++;
            } while (fs.existsSync(fullPath));
          }
        }
      }
      fs.writeFileSync(fullPath, sanitizedHtml, 'utf-8');
      return { success: true, filename: target, path: fullPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('read-animation', async (_event, { filename }: { filename: string }) => {
    try {
      const { fullPath } = resolveAnimationPath(filename);
      const content = fs.readFileSync(fullPath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('list-animations', async () => {
    try {
      ensureAnimationsDir();
      const files = fs.readdirSync(getAnimationsDir()).filter((f) => f.endsWith('.html'));
      return { success: true, files };
    } catch (err) {
      return { success: false, files: [], error: String(err) };
    }
  });

  ipcMain.handle('delete-animation', async (_event, { filename }: { filename: string }) => {
    try {
      const { fullPath } = resolveAnimationPath(filename);
      fs.unlinkSync(fullPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('open-in-browser', async (_event, { filename }: { filename: string }) => {
    try {
      const { fullPath } = resolveAnimationPath(filename);
      await shell.openExternal(pathToFileURL(fullPath).toString());
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
