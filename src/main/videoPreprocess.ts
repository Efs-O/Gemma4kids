import { app, type IpcMain } from 'electron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const VIDEO_PREPROCESS_LOG = 'video-preprocess.log';
const VIDEO_PREPROCESS_MIN_FRAMES = 3;
const VIDEO_PREPROCESS_MAX_FRAMES = 6;
const VIDEO_PREPROCESS_AUDIO_MAX_SECONDS = 30;
const VIDEO_PREPROCESS_FRAME_MAX_DIMENSION = 640;

interface VideoPreprocessResult {
  success: boolean;
  frames: Array<{ base64: string; timeSeconds: number }>;
  audioWavBase64: string | null;
  ffmpegPath?: string;
  warning?: string;
  error?: string;
}

interface VideoInspectResult {
  success: boolean;
  durationSeconds?: number;
  posterDataUrl?: string | null;
  ffmpegPath?: string;
  error?: string;
}

function getVideoPreprocessLogPath(): string {
  return path.join(app.getPath('userData'), VIDEO_PREPROCESS_LOG);
}

export function appendVideoPreprocessLog(line: string): void {
  const logPath = getVideoPreprocessLogPath();
  const stamped = `${new Date().toISOString()} ${line}`;
  try {
    fs.appendFileSync(logPath, `${stamped}\n`, 'utf8');
  } catch {
    // Logging should never break video preprocessing.
  }
  console.info(stamped);
}

export function appendRendererDebugLog(scope: string, payload: unknown): void {
  let serialized: string;
  try {
    serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
  } catch {
    serialized = String(payload);
  }
  appendVideoPreprocessLog(`[renderer:${scope}] ${serialized}`);
}

function fileExists(fullPath: string): boolean {
  try {
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
}

function findBinaryOnPath(binaryName: string): string | null {
  const pathEnv = process.env.PATH ?? '';
  const parts = pathEnv.split(path.delimiter).map((part) => part.trim()).filter(Boolean);
  for (const part of parts) {
    const candidate = path.join(part, binaryName);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

function searchWinGetPackageTreeForFfmpeg(rootDir: string): string | null {
  if (!fs.existsSync(rootDir)) return null;

  const pending = [rootDir];
  let visited = 0;
  while (pending.length > 0 && visited < 2500) {
    const currentDir = pending.pop();
    if (!currentDir) break;
    visited += 1;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'ffmpeg.exe') return entryPath;
      if (entry.isDirectory()) pending.push(entryPath);
    }
  }

  return null;
}

function findFfmpegBinary(): string | null {
  const explicit = process.env.FFMPEG_PATH?.trim();
  if (explicit && fileExists(explicit)) return explicit;

  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const fromPath = findBinaryOnPath(binaryName);
  if (fromPath) return fromPath;

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) {
      const wingetDir = path.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
      const fromWinGet = searchWinGetPackageTreeForFfmpeg(wingetDir);
      if (fromWinGet) return fromWinGet;
    }
  }

  return null;
}

function runFfmpeg(ffmpegPath: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 0, stderr: stderr.trim() }));
  });
}

function buildRepresentativeFrameTimes(durationSeconds: number): number[] {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 6;
  const frameCount = Math.min(
    VIDEO_PREPROCESS_MAX_FRAMES,
    Math.max(VIDEO_PREPROCESS_MIN_FRAMES, Math.round(safeDuration / 5)),
  );
  const safeEnd = Math.max(safeDuration - 0.12, 0);

  return Array.from({ length: frameCount }, (_, index) => {
    const centerTime = safeDuration * ((index + 0.5) / frameCount);
    return Math.max(0, Math.min(centerTime, safeEnd));
  });
}

function parseDurationFromFfmpegStderr(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i.exec(stderr);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every(Number.isFinite)) return null;
  return (hours * 3600) + (minutes * 60) + seconds;
}

async function inspectVideoWithFfmpeg(videoPath: string): Promise<VideoInspectResult> {
  appendVideoPreprocessLog(`[inspect:start] video="${videoPath}"`);
  if (!path.isAbsolute(videoPath) || !fileExists(videoPath)) {
    appendVideoPreprocessLog(`[inspect:error] video file missing or not absolute: "${videoPath}"`);
    return { success: false, error: 'The selected video file could not be found on disk.' };
  }

  const ffmpegPath = findFfmpegBinary();
  if (!ffmpegPath) {
    appendVideoPreprocessLog('[inspect:error] ffmpeg not found');
    return { success: false, error: 'ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH so Gemma can prepare video attachments.' };
  }

  const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'gemma4kids-video-inspect-'));
  appendVideoPreprocessLog(`[inspect:ffmpeg] path="${ffmpegPath}" temp="${tempRoot}"`);
  try {
    const probe = await runFfmpeg(ffmpegPath, ['-hide_banner', '-i', videoPath]);
    const durationSeconds = parseDurationFromFfmpegStderr(probe.stderr);
    appendVideoPreprocessLog(`[inspect:duration] parsed=${String(durationSeconds)}`);
    if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return { success: false, ffmpegPath, error: 'That video could not be read here.' };
    }
    if (durationSeconds > VIDEO_PREPROCESS_AUDIO_MAX_SECONDS) {
      return { success: false, ffmpegPath, error: `Please pick a short video under ${VIDEO_PREPROCESS_AUDIO_MAX_SECONDS} seconds.` };
    }

    const posterPath = path.join(tempRoot, 'poster.jpg');
    const poster = await runFfmpeg(ffmpegPath, [
      '-y', '-ss', '0.1', '-i', videoPath,
      '-frames:v', '1', '-q:v', '3', '-update', '1',
      '-vf', `scale=${String(VIDEO_PREPROCESS_FRAME_MAX_DIMENSION)}:-2:force_original_aspect_ratio=decrease`,
      posterPath,
    ]);
    appendVideoPreprocessLog(`[inspect:poster] code=${String(poster.code)} exists=${String(fileExists(posterPath))}`);

    let posterDataUrl: string | null = null;
    if (fileExists(posterPath)) {
      posterDataUrl = `data:image/jpeg;base64,${fs.readFileSync(posterPath).toString('base64')}`;
    }

    appendVideoPreprocessLog(`[inspect:success] duration=${String(durationSeconds)} poster=${posterDataUrl ? 'yes' : 'no'}`);
    return { success: true, durationSeconds, posterDataUrl, ffmpegPath };
  } catch (error) {
    appendVideoPreprocessLog(`[inspect:exception] ${error instanceof Error ? error.message : String(error)}`);
    return { success: false, ffmpegPath, error: error instanceof Error ? error.message : String(error) };
  } finally {
    appendVideoPreprocessLog(`[inspect:cleanup] temp="${tempRoot}"`);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function preprocessVideoWithFfmpeg(videoPath: string, durationSeconds: number): Promise<VideoPreprocessResult> {
  appendVideoPreprocessLog(`[start] video="${videoPath}" duration=${String(durationSeconds)}`);
  if (!path.isAbsolute(videoPath) || !fileExists(videoPath)) {
    appendVideoPreprocessLog(`[error] video file missing or not absolute: "${videoPath}"`);
    return { success: false, frames: [], audioWavBase64: null, error: 'The selected video file could not be found on disk.' };
  }

  const ffmpegPath = findFfmpegBinary();
  if (!ffmpegPath) {
    appendVideoPreprocessLog('[error] ffmpeg not found');
    return { success: false, frames: [], audioWavBase64: null, error: 'ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH so Gemma can prepare video attachments.' };
  }

  const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'gemma4kids-video-'));
  appendVideoPreprocessLog(`[ffmpeg] path="${ffmpegPath}" temp="${tempRoot}"`);
  try {
    const framesDir = path.join(tempRoot, 'frames');
    fs.mkdirSync(framesDir, { recursive: true });

    const frameTimes = buildRepresentativeFrameTimes(durationSeconds);
    appendVideoPreprocessLog(`[frames] count=${String(frameTimes.length)} times=${frameTimes.map((t) => t.toFixed(3)).join(',')}`);
    const frames: Array<{ base64: string; timeSeconds: number }> = [];

    for (let i = 0; i < frameTimes.length; i++) {
      const timeSeconds = frameTimes[i];
      const outputPath = path.join(framesDir, `frame-${String(i + 1)}.jpg`);
      appendVideoPreprocessLog(`[frame:start] index=${String(i + 1)} time=${timeSeconds.toFixed(3)} output="${outputPath}"`);
      const result = await runFfmpeg(ffmpegPath, [
        '-y', '-ss', timeSeconds.toFixed(3), '-i', videoPath,
        '-frames:v', '1', '-q:v', '3', '-update', '1',
        '-vf', `scale=${String(VIDEO_PREPROCESS_FRAME_MAX_DIMENSION)}:-2:force_original_aspect_ratio=decrease`,
        outputPath,
      ]);
      appendVideoPreprocessLog(`[frame:done] index=${String(i + 1)} code=${String(result.code)} exists=${String(fileExists(outputPath))}`);
      if (result.code !== 0 || !fileExists(outputPath)) {
        appendVideoPreprocessLog(`[frame:error] index=${String(i + 1)} stderr=${JSON.stringify(result.stderr.slice(-1000))}`);
        return { success: false, frames: [], audioWavBase64: null, ffmpegPath, error: result.stderr || 'ffmpeg could not extract video frames.' };
      }
      frames.push({ base64: fs.readFileSync(outputPath).toString('base64'), timeSeconds });
    }

    const audioPath = path.join(tempRoot, 'audio.wav');
    appendVideoPreprocessLog(`[audio:start] output="${audioPath}"`);
    const audioResult = await runFfmpeg(ffmpegPath, [
      '-y', '-i', videoPath, '-map', '0:a:0?', '-vn',
      '-ac', '1', '-ar', '16000', '-t', String(VIDEO_PREPROCESS_AUDIO_MAX_SECONDS), audioPath,
    ]);
    appendVideoPreprocessLog(`[audio:done] code=${String(audioResult.code)} exists=${String(fileExists(audioPath))}`);

    let audioWavBase64: string | null = null;
    let warning: string | undefined;
    if (fileExists(audioPath)) {
      const audioBuffer = fs.readFileSync(audioPath);
      if (audioBuffer.length > 44) {
        audioWavBase64 = audioBuffer.toString('base64');
        appendVideoPreprocessLog(`[audio:bytes] size=${String(audioBuffer.length)}`);
      }
    } else if (audioResult.code !== 0) {
      warning = audioResult.stderr || 'Audio could not be extracted from the video.';
      appendVideoPreprocessLog(`[audio:warning] ${JSON.stringify(warning.slice(-1000))}`);
    }

    appendVideoPreprocessLog(`[success] frames=${String(frames.length)} audio=${audioWavBase64 ? 'yes' : 'no'} warning=${warning ? 'yes' : 'no'}`);
    return { success: true, frames, audioWavBase64, ffmpegPath, warning };
  } catch (error) {
    return { success: false, frames: [], audioWavBase64: null, ffmpegPath, error: error instanceof Error ? error.message : String(error) };
  } finally {
    appendVideoPreprocessLog(`[cleanup] temp="${tempRoot}"`);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function registerVideoPreprocessIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('preprocess-video-attachment', async (_event, { videoPath, durationSeconds }: { videoPath: string; durationSeconds: number }) => {
    return preprocessVideoWithFfmpeg(videoPath, durationSeconds);
  });

  ipcMain.handle('inspect-video-attachment', async (_event, { videoPath }: { videoPath: string }) => {
    return inspectVideoWithFfmpeg(videoPath);
  });

  ipcMain.handle('append-renderer-debug-log', async (_event, { scope, payload }: { scope: string; payload: unknown }) => {
    appendRendererDebugLog(scope, payload);
    return { success: true };
  });
}
