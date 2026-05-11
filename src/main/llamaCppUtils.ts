import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

const LLAMA_SMALL_MODEL_STARTUP_TIMEOUT_MS = 120000;
const LLAMA_LARGE_MODEL_STARTUP_TIMEOUT_MS = 240000;
export const LLAMA_RUNTIME_LOG = 'llama-cpp-runtime.log';

function isMmprojPath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase().includes('mmproj');
}

function extractGemmaFamilyToken(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.includes('e2b')) return 'e2b';
  if (lower.includes('e4b')) return 'e4b';
  if (lower.includes('26b')) return '26b';
  if (lower.includes('31b')) return '31b';
  return null;
}

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

export function runtimeConfigKey(config: LlamaCppConfig): string {
  return JSON.stringify({
    serverPath: config.serverPath.trim(),
    modelPath: config.modelPath.trim(),
    mmprojSearchPaths: config.mmprojSearchPaths.map((value) => value.trim()),
    port: config.port,
    gpuLayers: config.gpuLayers,
    numCtx: config.numCtx,
    numPredict: config.numPredict,
    cacheTypeK: config.cacheTypeK.trim(),
    cacheTypeV: config.cacheTypeV.trim(),
  });
}

export function broadcastToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
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

export function getLlamaRuntimeLogPath(): string {
  return path.join(app.getPath('userData'), LLAMA_RUNTIME_LOG);
}

export function resetLlamaRuntimeLog(): string {
  const logPath = getLlamaRuntimeLogPath();
  fs.writeFileSync(logPath, '', 'utf8');
  return logPath;
}

export function appendLlamaRuntimeLog(logPath: string, line: string): void {
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // Logging should never break runtime startup.
  }
}

export function summarizeChatRequest(request: Record<string, unknown>): string {
  const model = typeof request.model === 'string' ? request.model : '(missing)';
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const tools = Array.isArray(request.tools) ? request.tools : [];
  const lastRoles = messages
    .slice(-4)
    .map((message) => {
      if (!message || typeof message !== 'object') return 'unknown';
      const role = 'role' in message && typeof message.role === 'string' ? message.role : 'unknown';
      const toolCalls = 'tool_calls' in message && Array.isArray(message.tool_calls) ? message.tool_calls.length : 0;
      return toolCalls > 0 ? `${role}(tool_calls:${String(toolCalls)})` : role;
    })
    .join(' -> ');

  return JSON.stringify({
    model,
    messageCount: messages.length,
    toolCount: tools.length,
    maxTokens: typeof request.max_tokens === 'number' ? request.max_tokens : null,
    temperature: typeof request.temperature === 'number' ? request.temperature : null,
    topP: typeof request.top_p === 'number' ? request.top_p : null,
    topK: typeof request.top_k === 'number' ? request.top_k : null,
    stream: request.stream === true,
    lastRoles,
  });
}

export function validateLlamaConfig(config: LlamaCppConfig): LlamaCppHealthResult | null {
  const serverPath = config.serverPath.trim();
  const modelPath = config.modelPath.trim();

  if (!serverPath) {
    return buildHealthResult(false, 'binary_missing', 'Add the llama-server binary path in Setup first.', 'llama-server binary path is empty.');
  }
  if (!modelPath) {
    return buildHealthResult(false, 'model_missing', 'Add your GGUF model path in Setup first.', 'llama.cpp model path is empty.');
  }
  if (isMmprojPath(modelPath)) {
    return buildHealthResult(false, 'model_missing', 'That path points to an mmproj file. Put the actual Gemma model .gguf in this tab, not the projector file.', `Model path points to mmproj instead of a text model: ${modelPath}`);
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    return buildHealthResult(false, 'invalid_port', 'Pick a port between 1024 and 65535.', `Invalid llama.cpp port: ${String(config.port)}`);
  }
  if (!Number.isInteger(config.numCtx) || config.numCtx < 4096 || config.numCtx > 262144) {
    return buildHealthResult(false, 'invalid_ctx', 'Pick a context length between 4096 and 262144.', `Invalid llama.cpp context length: ${String(config.numCtx)}`);
  }
  if (!Number.isInteger(config.numPredict) || config.numPredict < 256 || config.numPredict > 131072) {
    return buildHealthResult(false, 'invalid_predict', 'Pick generation tokens between 256 and 131072.', `Invalid llama.cpp generation token limit: ${String(config.numPredict)}`);
  }
  if (!config.cacheTypeK.trim()) {
    return buildHealthResult(false, 'invalid_cache_type', 'Pick a cache type for K.', 'llama.cpp cacheTypeK is empty.');
  }
  if (!config.cacheTypeV.trim()) {
    return buildHealthResult(false, 'invalid_cache_type', 'Pick a cache type for V.', 'llama.cpp cacheTypeV is empty.');
  }
  if (!fs.existsSync(modelPath)) {
    return buildHealthResult(false, 'model_missing', 'I could not find that GGUF model file.', `Model path does not exist: ${modelPath}`);
  }
  const modelStat = fs.statSync(modelPath);
  if (modelStat.isDirectory()) {
    return buildHealthResult(false, 'model_missing', 'That path is a folder, not a GGUF file. Paste the full path including the filename (e.g. …\\model.gguf).', `Model path is a directory: ${modelPath}`);
  }
  if (!modelStat.isFile()) {
    return buildHealthResult(false, 'model_missing', 'That path does not point to a file.', `Model path is not a regular file: ${modelPath}`);
  }
  if (path.extname(modelPath).toLowerCase() !== '.gguf') {
    return buildHealthResult(false, 'model_missing', 'That file does not look like a GGUF model — the path should end in .gguf.', `Model path does not have .gguf extension: ${modelPath}`);
  }
  return null;
}

export function getLlamaStartupTimeoutMs(modelPath: string): number {
  const lower = modelPath.toLowerCase();
  if (lower.includes('31b') || lower.includes('26b')) {
    return LLAMA_LARGE_MODEL_STARTUP_TIMEOUT_MS;
  }
  return LLAMA_SMALL_MODEL_STARTUP_TIMEOUT_MS;
}

export function resolveLlamaServerCommand(serverPath: string): { command: string; args: string[] } {
  const trimmed = serverPath.trim();
  if (!trimmed) {
    throw new Error('llama-server binary path is empty.');
  }

  if (!path.isAbsolute(trimmed)) {
    return { command: trimmed, args: [] };
  }

  const candidates: string[] = [];
  if (fs.existsSync(trimmed)) {
    const st = fs.statSync(trimmed);
    if (st.isFile()) {
      candidates.push(trimmed);
    } else if (st.isDirectory()) {
      const exeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
      candidates.push(path.join(trimmed, exeName));
    }
  } else {
    candidates.push(trimmed);
    if (process.platform === 'win32' && !path.extname(trimmed)) {
      candidates.push(`${trimmed}.exe`);
    }
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { command: candidate, args: [] };
      }
    } catch {
      // ignore stat errors for candidate
    }
  }

  throw new Error(
    `llama-server binary not found at ${trimmed}. Use the path to the llama-server program ` +
      `(on Windows, often ...\\bin\\llama-server.exe), not only the source or build folder.)`,
  );
}

export async function canReachLlamaServer(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}
