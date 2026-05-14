import { app, shell, type IpcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const INTERNAL_ANIMATION_PREFIX = '__';

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

function normalizeVideoFrameStem(raw: string): string {
  const trimmed = raw.trim().replace(/\.jpg$/i, '');
  if (!trimmed) {
    throw new Error('Frame name cannot be empty');
  }

  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) {
    throw new Error('Frame name is invalid');
  }
  return slug;
}

function resolveVideoFramePathFromStem(stemInput: string): { filename: string; fullPath: string } {
  const framesDir = path.join(getAnimationsDir(), 'video-frames');
  const normalizedStem = normalizeVideoFrameStem(stemInput.replace(/\.jpg$/i, ''));
  const filename = `${normalizedStem}.jpg`;
  const fullPath = path.resolve(framesDir, filename);
  const relative = path.relative(framesDir, fullPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Frame name must stay inside the video-frames folder');
  }

  return { filename, fullPath };
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

function isInternalAnimationFilename(filename: string): boolean {
  return filename.startsWith(INTERNAL_ANIMATION_PREFIX);
}

export function registerAnimationIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('save-animation', async (_event, { filename, html_content, source }: { filename: string; html_content: string; source?: 'gemma' | 'kid' | 'draft' }) => {
    try {
      ensureAnimationsDir();
      const sanitizedHtml = sanitizeHtmlForSave(html_content);
      let { filename: target, fullPath } = resolveAnimationPath(filename);
      if (source === 'draft') {
        fs.writeFileSync(fullPath, sanitizedHtml, 'utf-8');
        return { success: true, filename: target, path: fullPath };
      }
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

  ipcMain.handle('save-video-frame', async (_event, { filename, jpeg_base64, source }: { filename: string; jpeg_base64: string; source?: 'gemma' | 'kid' }) => {
    try {
      ensureAnimationsDir();
      const framesDir = path.join(getAnimationsDir(), 'video-frames');
      if (!fs.existsSync(framesDir)) {
        fs.mkdirSync(framesDir, { recursive: true });
      }

      const buf = Buffer.from(jpeg_base64, 'base64');
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
        return { success: false, error: 'Image data is not a valid JPEG' };
      }

      let { filename: target, fullPath } = resolveVideoFramePathFromStem(filename);
      if (fs.existsSync(fullPath)) {
        const existing = fs.readFileSync(fullPath);
        if (!existing.equals(buf)) {
          const base = target.replace(/\.jpg$/i, '').replace(/[-]?\d+$/, '');
          let n = 2;
          if (source === 'kid') {
            do {
              ({ filename: target, fullPath } = resolveVideoFramePathFromStem(`${base}${n}.jpg`));
              n++;
            } while (fs.existsSync(fullPath));
          } else {
            do {
              ({ filename: target, fullPath } = resolveVideoFramePathFromStem(`${base}-${n}.jpg`));
              n++;
            } while (fs.existsSync(fullPath));
          }
        }
      }

      fs.writeFileSync(fullPath, buf);
      return { success: true, filename: target, path: fullPath };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('list-animations', async () => {
    try {
      ensureAnimationsDir();
      const files = fs.readdirSync(getAnimationsDir()).filter((f) => f.endsWith('.html') && !isInternalAnimationFilename(f));
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
