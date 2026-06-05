import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import net from 'net';
import path from 'path';

const LLAMA_SMALL_MODEL_STARTUP_TIMEOUT_MS = 120000;
const LLAMA_LARGE_MODEL_STARTUP_TIMEOUT_MS = 240000;
export const LLAMA_RUNTIME_LOG = 'llama-cpp-runtime.log';
const PORT_PROBE_OFFSETS = [0, 1, 2, 3] as const;

function isMmprojPath(filePath: string): boolean {
  return path.basename(filePath).toLowerCase().includes('mmproj');
}

function extractGemmaFamilyToken(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  if (lower.includes('e2b')) return 'e2b';
  if (lower.includes('e4b')) return 'e4b';
  if (lower.includes('12b')) return '12b';
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
      // Also check one level up (parent dir) as a fallback — handles the case where
      // mmproj files live in the root folder and model files are in per-model subdirs.
      const parentDir = path.dirname(dir);
      if (parentDir !== dir && !seenDirs.has(parentDir)) {
        seenDirs.add(parentDir);
        dirs.push({ dir: parentDir, family: null });
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
    sttPort: config.sttPort,
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

function expectedModelIdsForPath(modelPath: string): string[] {
  const trimmed = modelPath.trim();
  if (!trimmed) return [];
  const basename = path.basename(trimmed, path.extname(trimmed)).toLowerCase();
  return basename ? [basename] : [];
}

async function isTcpPortBindable(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code !== 'EADDRINUSE');
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function fetchServerModelIds(port: number, timeoutMs: number): Promise<string[] | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: Array<{ id?: string }> };
    const ids = Array.isArray(json.data)
      ? json.data.map((row) => row.id?.trim().toLowerCase()).filter((id): id is string => Boolean(id))
      : [];
    return ids;
  } catch {
    return null;
  }
}

interface PortInspectionResult {
  state: 'free' | 'matching_server' | 'other_llama_server' | 'occupied';
  modelIds: string[];
}

export async function inspectPortOwner(
  port: number,
  expectedModelPath: string,
  timeoutMs: number,
): Promise<PortInspectionResult> {
  const modelIds = await fetchServerModelIds(port, timeoutMs);
  if (modelIds && modelIds.length > 0) {
    const expectedIds = expectedModelIdsForPath(expectedModelPath);
    const matchesExpected = expectedIds.some((expected) => modelIds.includes(expected));
    return {
      state: matchesExpected ? 'matching_server' : 'other_llama_server',
      modelIds,
    };
  }

  const bindable = await isTcpPortBindable(port);
  return {
    state: bindable ? 'free' : 'occupied',
    modelIds: [],
  };
}

export interface PortResolution {
  ok: boolean;
  preferredPort: number;
  resolvedPort?: number;
  reusedExisting: boolean;
  reason: string;
  details: string[];
}

interface ResolvePortOptions {
  preferredPort: number;
  expectedModelPath: string;
  roleLabel: string;
  excludedPorts?: number[];
  log?: (line: string) => void;
}

export async function resolveLocalServerPort(options: ResolvePortOptions): Promise<PortResolution> {
  const excluded = new Set(options.excludedPorts ?? []);

  for (const offset of PORT_PROBE_OFFSETS) {
    const port = options.preferredPort + offset;
    if (port > 65535) break;

    if (excluded.has(port)) {
      const message = `[port-skip] role=${options.roleLabel} port=${String(port)} reason=reserved-for-other-app-role`;
      options.log?.(message);
      continue;
    }

    const inspection = await inspectPortOwner(port, options.expectedModelPath, 1500);
    if (inspection.state === 'free') {
      if (port === options.preferredPort) {
        const reason = `${options.roleLabel} will use preferred port ${String(port)}.`;
        options.log?.(`[port-select] role=${options.roleLabel} preferred=${String(options.preferredPort)} resolved=${String(port)} reason=free`);
        return {
          ok: true,
          preferredPort: options.preferredPort,
          resolvedPort: port,
          reusedExisting: false,
          reason,
          details: [reason],
        };
      }
      const reason = `${options.roleLabel} preferred port ${String(options.preferredPort)} was busy, so it will use ${String(port)}.`;
      const details = [
        `${options.roleLabel} preferred port ${String(options.preferredPort)} was occupied by something else.`,
        `${options.roleLabel} is using fallback port ${String(port)}.`,
      ];
      options.log?.(`[port-select] role=${options.roleLabel} preferred=${String(options.preferredPort)} resolved=${String(port)} reason=fallback-free`);
      return {
        ok: true,
        preferredPort: options.preferredPort,
        resolvedPort: port,
        reusedExisting: false,
        reason,
        details,
      };
    }

    if (inspection.state === 'matching_server') {
      const reason = port === options.preferredPort
        ? `${options.roleLabel} found a matching server already running on preferred port ${String(port)} and will reuse it.`
        : `${options.roleLabel} preferred port ${String(options.preferredPort)} was unavailable, but a matching server is already running on ${String(port)} and will be reused.`;
      const details = [
        reason,
        ...(inspection.modelIds.length > 0 ? [`Models on reused server: ${inspection.modelIds.join(', ')}`] : []),
      ];
      options.log?.(`[port-select] role=${options.roleLabel} preferred=${String(options.preferredPort)} resolved=${String(port)} reason=reuse-matching-server`);
      return {
        ok: true,
        preferredPort: options.preferredPort,
        resolvedPort: port,
        reusedExisting: true,
        reason,
        details,
      };
    }

    if (inspection.state === 'other_llama_server') {
      options.log?.(
        `[port-busy] role=${options.roleLabel} port=${String(port)} reason=other-llama-server models=${inspection.modelIds.join(',')}`,
      );
      continue;
    }

    options.log?.(`[port-busy] role=${options.roleLabel} port=${String(port)} reason=occupied-by-other-process`);
  }

  const triedPorts = PORT_PROBE_OFFSETS
    .map((offset) => options.preferredPort + offset)
    .filter((port) => port <= 65535)
    .filter((port) => !excluded.has(port));
  return {
    ok: false,
    preferredPort: options.preferredPort,
    reusedExisting: false,
    reason: `${options.roleLabel} could not find a usable port near ${String(options.preferredPort)}.`,
    details: [
      `Tried ports: ${triedPorts.join(', ') || 'none'}.`,
      'Each one was either occupied by another process or already serving a different llama.cpp role.',
    ],
  };
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

export function resolveGgufPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) return trimmed;
  try {
    if (!fs.existsSync(trimmed)) return trimmed;
    if (!fs.statSync(trimmed).isDirectory()) return trimmed;
    const files = fs.readdirSync(trimmed).filter(
      (f) => f.toLowerCase().endsWith('.gguf') && !f.toLowerCase().includes('mmproj'),
    );
    if (files.length === 1) return path.join(trimmed, files[0]);
  } catch {
    // fall through and let validation surface the error
  }
  return trimmed;
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

function llamaServerExeName(): string {
  return process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExistingDir(dirPath: string): boolean {
  try {
    return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/** Build number from a path like ".../llama.cpp-b9524/...", or -1 if none. */
function extractLlamaBuildNumber(filePath: string): number {
  const match = filePath.toLowerCase().match(/b(\d{3,})/);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function fileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Find the newest llama-server executable inside a directory: checks the directory
 * itself and one level of subdirectories (e.g. <root>/llama.cpp-bNNNN/llama-server.exe),
 * preferring the highest build number, then most recently modified. This lets a user
 * drop a new llama.cpp-bNNNN build into the same parent folder — or point the path at
 * that parent folder — and have the latest version picked up without reconfiguring.
 */
function findNewestLlamaServerExe(rootDir: string): string | null {
  const exeName = llamaServerExeName();
  const candidates: string[] = [];
  const direct = path.join(rootDir, exeName);
  if (isExistingFile(direct)) candidates.push(direct);
  try {
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(rootDir, entry.name, exeName);
      if (isExistingFile(nested)) candidates.push(nested);
    }
  } catch {
    // unreadable directory — ignore
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const byBuild = extractLlamaBuildNumber(b) - extractLlamaBuildNumber(a);
    if (byBuild !== 0) return byBuild;
    return fileMtimeMs(b) - fileMtimeMs(a);
  });
  return candidates[0];
}

/** Walk up from a path until an existing directory is found. */
function nearestExistingDir(startPath: string): string | null {
  let current = startPath;
  for (let i = 0; i < 16; i++) {
    if (isExistingDir(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

export function resolveLlamaServerCommand(serverPath: string): { command: string; args: string[] } {
  const trimmed = serverPath.trim();
  if (!trimmed) {
    throw new Error('llama-server binary path is empty.');
  }

  if (!path.isAbsolute(trimmed)) {
    return { command: trimmed, args: [] };
  }

  // 1) An exact existing file wins — an explicitly pinned build.
  if (isExistingFile(trimmed)) {
    return { command: trimmed, args: [] };
  }

  // 2) Windows: allow a path that omits the .exe suffix.
  if (process.platform === 'win32' && !path.extname(trimmed)) {
    const withExe = `${trimmed}.exe`;
    if (isExistingFile(withExe)) {
      return { command: withExe, args: [] };
    }
  }

  // 3) A directory (e.g. the install container): pick the newest build inside it.
  if (isExistingDir(trimmed)) {
    const best = findNewestLlamaServerExe(trimmed);
    if (best) return { command: best, args: [] };
  }

  // 4) The configured path no longer exists (e.g. a build folder was renamed or
  //    replaced by a newer one): search the nearest existing ancestor directory for
  //    the newest llama-server build.
  const anchor = nearestExistingDir(path.dirname(trimmed));
  if (anchor) {
    const best = findNewestLlamaServerExe(anchor);
    if (best) return { command: best, args: [] };
  }

  throw new Error(
    `llama-server binary not found at ${trimmed}. Use the path to the llama-server program ` +
      `(on Windows, often ...\\bin\\llama-server.exe) or the folder that contains a ` +
      `llama.cpp-bNNNN build.`,
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
