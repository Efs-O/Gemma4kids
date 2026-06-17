// Stateless helpers for the dedicated STT llama.cpp server: config validation,
// binary/mmproj resolution, logging, reply sanitisation, the llama-mtmd-cli audio
// fallback, and a health probe. Extracted verbatim from llamaSttRuntime.ts — no
// logic change. The managed-server state and lifecycle stay in llamaSttRuntime.ts.
import { app } from 'electron';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveLlamaServerCommand } from './llamaCppUtils';
import { looksLikeTranscriptionRefusal, stripPromptEcho } from '../shared/transcription';

export const LLAMA_STT_CTX_SIZE = 8192;
export const LLAMA_STT_BATCH_SIZE = 512;
const LLAMA_STT_RUNTIME_LOG = 'llama-stt-runtime.log';

export function isMmprojPath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase().includes('mmproj');
}

export function extractGemmaFamilyToken(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.includes('e2b')) return 'e2b';
  if (lower.includes('e4b')) return 'e4b';
  if (lower.includes('12b')) return '12b';
  if (lower.includes('26b')) return '26b';
  if (lower.includes('31b')) return '31b';
  return null;
}

export function getSttRuntimeLogPath(): string {
  return path.join(app.getPath('userData'), LLAMA_STT_RUNTIME_LOG);
}

export function resetSttRuntimeLog(): string {
  const logPath = getSttRuntimeLogPath();
  fs.writeFileSync(logPath, '', 'utf8');
  return logPath;
}

export function appendSttRuntimeLog(logPath: string, line: string): void {
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // Logging must never break STT startup.
  }
}

export function buildHealthResult(
  ok: boolean,
  state: string,
  message: string,
  error?: string,
  details?: string[],
): LlamaCppHealthResult {
  return { ok, state, message, error, details };
}

// Duplicated from llamaRuntime.ts intentionally - keeps the two files decoupled.
function resolveMmprojSearchDirs(primaryModelPath: string, extraModelPaths: string[]): Array<{ dir: string; family: string | null }> {
  const orderedPaths = [primaryModelPath, ...extraModelPaths];
  const seenDirs = new Set<string>();
  const dirs: Array<{ dir: string; family: string | null }> = [];

  for (const rawPath of orderedPaths) {
    const trimmed = rawPath.trim();
    if (!trimmed || !fs.existsSync(trimmed)) continue;

    try {
      const stat = fs.statSync(trimmed);
      if (stat.isFile() && isMmprojPath(trimmed)) continue;
      const dir = stat.isDirectory() ? trimmed : path.dirname(trimmed);
      if (!seenDirs.has(dir)) {
        seenDirs.add(dir);
        dirs.push({ dir, family: extractGemmaFamilyToken(trimmed) ?? extractGemmaFamilyToken(dir) });
      }
    } catch {
      // Ignore invalid search candidates and continue with the rest.
    }
  }

  return dirs;
}

export function findMmprojForConfig(modelPath: string, extraModelPaths: string[]): string | null {
  const targetFamily = extractGemmaFamilyToken(modelPath);
  for (const { dir, family } of resolveMmprojSearchDirs(modelPath, extraModelPaths)) {
    if (targetFamily && family && family !== targetFamily) continue;
    try {
      const files = fs.readdirSync(dir);
      const found = files.find(
        (file) => file.toLowerCase().includes('mmproj') && file.toLowerCase().endsWith('.gguf'),
      );
      if (found) return path.join(dir, found);
    } catch {
      // Ignore unreadable directories and continue searching other configured paths.
    }
  }

  return null;
}

export function validateSttConfig(config: LlamaCppSttConfig): LlamaCppHealthResult | null {
  if (!config.serverPath.trim()) {
    return buildHealthResult(false, 'binary_missing', 'Add the llama-server binary path in Setup first.', 'llama-server binary path is empty.');
  }
  if (!config.sttModelPath.trim()) {
    return buildHealthResult(false, 'model_missing', 'Add your E4B GGUF path in Setup so voice input works.', 'STT model path is empty.');
  }
  if (isMmprojPath(config.sttModelPath)) {
    return buildHealthResult(false, 'model_missing', 'That STT path points to an mmproj file. Put the actual Gemma speech model .gguf in this tab, not the projector file.', `STT model path points to mmproj instead of a text model: ${config.sttModelPath}`);
  }
  if (!Number.isInteger(config.sttPort) || config.sttPort < 1024 || config.sttPort > 65535) {
    return buildHealthResult(false, 'invalid_port', 'Pick an STT port between 1024 and 65535.', `Invalid STT port: ${String(config.sttPort)}`);
  }
  if (!fs.existsSync(config.sttModelPath)) {
    return buildHealthResult(false, 'model_missing', 'I could not find the STT GGUF file.', `STT model path does not exist: ${config.sttModelPath}`);
  }
  const st = fs.statSync(config.sttModelPath);
  if (!st.isFile()) {
    return buildHealthResult(false, 'model_missing', 'That STT path does not point to a file.', `STT model path is not a regular file: ${config.sttModelPath}`);
  }
  if (path.extname(config.sttModelPath).toLowerCase() !== '.gguf') {
    return buildHealthResult(false, 'model_missing', 'That STT file does not look like a GGUF model.', `STT model path does not have .gguf extension: ${config.sttModelPath}`);
  }
  return null;
}

export function resolveSttServerCommand(serverPath: string): { command: string; args: string[] } {
  // Delegate to the main resolver so a directory / newest-build layout
  // (e.g. <root>\llama.cpp-bNNNN\llama-server.exe) resolves identically to the
  // coding server. The previous STT-only copy only checked <dir>\llama-server.exe
  // directly and failed when the exe lived in a build subfolder.
  return resolveLlamaServerCommand(serverPath);
}

function resolveMtmdCliCommand(serverPath: string): { command: string; args: string[] } {
  const cliName = process.platform === 'win32' ? 'llama-mtmd-cli.exe' : 'llama-mtmd-cli';

  // Resolve the real llama-server exe first (handles dir / newest-build subdirs),
  // then look for llama-mtmd-cli beside it.
  let resolvedServer: string;
  try {
    resolvedServer = resolveLlamaServerCommand(serverPath).command;
  } catch {
    resolvedServer = serverPath.trim();
  }

  const candidates: string[] = [];
  if (path.isAbsolute(resolvedServer)) {
    candidates.push(path.join(path.dirname(resolvedServer), cliName));
  } else {
    candidates.push(resolvedServer.replace(/llama-server(?:\.exe)?$/i, cliName));
    candidates.push(cliName);
  }

  for (const candidate of candidates) {
    try {
      if (!path.isAbsolute(candidate)) {
        return { command: candidate, args: [] };
      }
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { command: candidate, args: [] };
      }
    } catch {
      // ignore
    }
  }

  throw new Error(`llama-mtmd-cli not found next to llama-server. Expected ${cliName}.`);
}

export function shouldFallbackToMtmdCli(body: string, status: number): boolean {
  const normalized = body.toLowerCase();
  return status >= 500 && (
    normalized.includes('audio input is not supported') ||
    normalized.includes('unsupported content part type') ||
    normalized.includes('input_audio')
  );
}

export function sanitizeLlamaSttReply(text: string, languageHint?: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const withoutThinkBlocks = trimmed
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\|startofthinking\|>[\s\S]*?<\|endofthinking\|>/gi, ' ')
    .trim();

  const cleaned = stripPromptEcho(withoutThinkBlocks, languageHint);
  if (looksLikeTranscriptionRefusal(cleaned)) {
    return '';
  }

  return cleaned;
}

export async function transcribeWithMtmdCli(
  sttConfig: LlamaCppSttConfig,
  audioBase64: string,
  prompt: string,
  logPath: string,
): Promise<{ success: boolean; text?: string; error?: string }> {
  let commandInfo: { command: string; args: string[] };
  try {
    commandInfo = resolveMtmdCliCommand(sttConfig.serverPath);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }

  const detectedMmproj = findMmprojForConfig(sttConfig.sttModelPath, sttConfig.mmprojSearchPaths);
  if (!detectedMmproj) {
    return { success: false, error: 'No mmproj file was found for the STT model.' };
  }

  const tempAudioPath = path.join(app.getPath('temp'), `gemma4kids-stt-${randomUUID()}.wav`);
  try {
    fs.writeFileSync(tempAudioPath, Buffer.from(audioBase64, 'base64'));

    const gpuLayers = sttConfig.gpuLayers === -1 ? 'all' : String(sttConfig.gpuLayers);
    const spawnArgs = [
      ...commandInfo.args,
      '-m', sttConfig.sttModelPath,
      '--mmproj', detectedMmproj,
      '--audio', tempAudioPath,
      '-p', prompt,
      '--jinja',
      '--no-warmup',
      '--ctx-size', String(LLAMA_STT_CTX_SIZE),
      '--batch-size', String(LLAMA_STT_BATCH_SIZE),
      '--n-gpu-layers', gpuLayers,
      '--flash-attn', 'on',
    ];

    appendSttRuntimeLog(logPath, `[mtmd:spawn] ${commandInfo.command} ${spawnArgs.join(' ')}`);

    const proc = spawn(commandInfo.command, spawnArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      appendSttRuntimeLog(logPath, `[mtmd:stdout] ${text.trimEnd()}`);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      appendSttRuntimeLog(logPath, `[mtmd:stderr] ${text.trimEnd()}`);
    });

    const exitCode = await new Promise<number | null>((resolve) => {
      proc.once('exit', (code) => resolve(code));
      proc.once('error', () => resolve(-1));
    });

    const text = stdout.trim();
    if (exitCode !== 0) {
      return { success: false, error: stderr.trim() || text || `llama-mtmd-cli exited with code ${String(exitCode)}.` };
    }
    if (!text) {
      return { success: false, error: stderr.trim() || 'Empty transcription returned' };
    }
    return { success: true, text };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      if (fs.existsSync(tempAudioPath)) {
        fs.unlinkSync(tempAudioPath);
      }
    } catch {
      // temp cleanup should not fail the request
    }
  }
}

export async function canReachSttServer(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
