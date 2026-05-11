import { app, BrowserWindow, type IpcMain } from 'electron';
import { stopManagedSttServer } from './llamaSttRuntime';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const LLAMA_SMALL_MODEL_STARTUP_TIMEOUT_MS = 120000;
const LLAMA_LARGE_MODEL_STARTUP_TIMEOUT_MS = 240000;
const LLAMA_DEFAULT_BATCH_SIZE = 512;
const LLAMA_RUNTIME_LOG = 'llama-cpp-runtime.log';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface LlamaStreamEvent {
  requestId: string;
  type: 'token' | 'thinking' | 'tool_calls' | 'done' | 'error';
  token?: string;
  thinking?: string;
  toolCalls?: OpenAiToolCall[];
  finishReason?: string | null;
  error?: string;
}

interface ManagedLlamaServer {
  configKey: string;
  config: LlamaCppConfig;
  process: ChildProcess;
  logPath: string;
}

interface OllamaCleanupState {
  runtime: 'ollama' | 'llama_cpp';
  models: string[];
}

const managedAbortControllers = new Map<string, AbortController>();
let managedLlamaServer: ManagedLlamaServer | null = null;
let managedLlamaStartup: { configKey: string; promise: Promise<LlamaCppHealthResult> } | null = null;
let ollamaCleanupState: OllamaCleanupState = { runtime: 'ollama', models: [] };

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

function findMmprojForConfig(modelPath: string, extraModelPaths: string[]): string | null {
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

function runtimeConfigKey(config: LlamaCppConfig): string {
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
    reasoningEnabled: config.reasoningEnabled,
  });
}

function broadcastToWindows(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function buildHealthResult(
  ok: boolean,
  state: string,
  message: string,
  error?: string,
  details?: string[],
): LlamaCppHealthResult {
  return { ok, state, message, error, details };
}

function getLlamaRuntimeLogPath(): string {
  return path.join(app.getPath('userData'), LLAMA_RUNTIME_LOG);
}

function resetLlamaRuntimeLog(): string {
  const logPath = getLlamaRuntimeLogPath();
  fs.writeFileSync(logPath, '', 'utf8');
  return logPath;
}

function appendLlamaRuntimeLog(logPath: string, line: string): void {
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // Logging should never break runtime startup.
  }
}

function summarizeChatRequest(request: Record<string, unknown>): string {
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

function validateLlamaConfig(config: LlamaCppConfig): LlamaCppHealthResult | null {
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

function getLlamaStartupTimeoutMs(modelPath: string): number {
  const lower = modelPath.toLowerCase();
  if (lower.includes('31b') || lower.includes('26b')) {
    return LLAMA_LARGE_MODEL_STARTUP_TIMEOUT_MS;
  }
  return LLAMA_SMALL_MODEL_STARTUP_TIMEOUT_MS;
}

function resolveLlamaServerCommand(serverPath: string): { command: string; args: string[] } {
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

async function canReachLlamaServer(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function stopManagedLlamaServer(): Promise<void> {
  const current = managedLlamaServer;
  if (!current) return;

  managedLlamaServer = null;
  if (current.process.exitCode !== null || current.process.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (current.process.exitCode === null && !current.process.killed) {
        current.process.kill();
      }
      resolve();
    }, 3000);

    current.process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    current.process.kill();
  });
}

async function unloadOllamaModels(models: string[]): Promise<void> {
  const uniqueModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  if (uniqueModels.length === 0) return;

  const logPath = getLlamaRuntimeLogPath();
  for (const model of uniqueModels) {
    appendLlamaRuntimeLog(logPath, `[ollama:unload:start] model=${model}`);
    try {
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          keep_alive: 0,
        }),
        signal: AbortSignal.timeout(15000),
      });
      appendLlamaRuntimeLog(
        logPath,
        `[ollama:unload:done] model=${model} status=${String(response.status)} ok=${String(response.ok)}`,
      );
    } catch (error) {
      appendLlamaRuntimeLog(
        logPath,
        `[ollama:unload:error] model=${model} message=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function ensureManagedLlamaServer(config: LlamaCppConfig): Promise<LlamaCppHealthResult> {
  const invalid = validateLlamaConfig(config);
  if (invalid) return invalid;

  const configKey = runtimeConfigKey(config);
  if (managedLlamaStartup?.configKey === configKey) {
    return managedLlamaStartup.promise;
  }
  if (managedLlamaStartup && managedLlamaStartup.configKey !== configKey) {
    try {
      await managedLlamaStartup.promise;
    } catch {
      // Ignore the previous startup result and continue with the new config.
    }
  }

  const startupPromise = (async (): Promise<LlamaCppHealthResult> => {
    const startupTimeoutMs = getLlamaStartupTimeoutMs(config.modelPath);
    if (managedLlamaServer && managedLlamaServer.configKey === configKey) {
      if (managedLlamaServer.process.exitCode === null && await canReachLlamaServer(config.port, 1500)) {
        return { ...buildHealthResult(true, 'ready', 'llama.cpp is ready.'), mmprojPath: findMmprojForConfig(config.modelPath, config.mmprojSearchPaths) ?? undefined };
      }
      await stopManagedLlamaServer();
    } else if (managedLlamaServer) {
      await stopManagedLlamaServer();
    }

    if (await canReachLlamaServer(config.port, 1500)) {
      return buildHealthResult(false, 'port_conflict', 'That llama.cpp port is already in use.', `Another process is already responding on port ${String(config.port)}.`);
    }

    let commandInfo: { command: string; args: string[] };
    try {
      commandInfo = resolveLlamaServerCommand(config.serverPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildHealthResult(false, 'binary_missing', 'I could not find the llama-server binary.', message);
    }

    const gpuLayers = config.gpuLayers === -1 ? 'all' : String(config.gpuLayers);
    const ctxSize = config.numCtx;
    const cacheTypeK = config.cacheTypeK.trim();
    const cacheTypeV = config.cacheTypeV.trim();
    const detectedMmproj = findMmprojForConfig(config.modelPath, config.mmprojSearchPaths);
    const spawnArgs = [
      ...commandInfo.args,
      '-m',
      config.modelPath,
      ...(detectedMmproj ? ['--mmproj', detectedMmproj] : []),
      '--host',
      '127.0.0.1',
      '--port',
      String(config.port),
      '--jinja',
      ...(config.reasoningEnabled ? [] : ['--reasoning', 'off']),
      '--ctx-size',
      String(ctxSize),
      '--batch-size',
      String(LLAMA_DEFAULT_BATCH_SIZE),
      '--parallel',
      '1',
      '--cache-type-k',
      cacheTypeK,
      '--cache-type-v',
      cacheTypeV,
      '--flash-attn',
      'on',
      '--n-gpu-layers',
      gpuLayers,
    ];
    const logPath = resetLlamaRuntimeLog();
    appendLlamaRuntimeLog(logPath, `[spawn:config] ctx_size=${String(ctxSize)} startup_timeout_s=${String(Math.round(startupTimeoutMs / 1000))}`);
    appendLlamaRuntimeLog(logPath, `[spawn] ${commandInfo.command} ${spawnArgs.join(' ')}`);
    const proc = spawn(
      commandInfo.command,
      spawnArgs,
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );

    let spawnProcessError: string | null = null;
    proc.once('error', (err) => {
      spawnProcessError = err.message;
      appendLlamaRuntimeLog(logPath, `[spawn:error] ${err.message}`);
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (stdout.length > 4000) stdout = stdout.slice(-4000);
      appendLlamaRuntimeLog(logPath, `[stdout] ${text.trimEnd()}`);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
      appendLlamaRuntimeLog(logPath, `[stderr] ${text.trimEnd()}`);
    });
    proc.once('exit', (code, signal) => {
      appendLlamaRuntimeLog(logPath, `[exit] code=${String(code)} signal=${String(signal)}`);
    });

    managedLlamaServer = {
      configKey,
      config,
      process: proc,
      logPath,
    };

    const startedAt = Date.now();
    while (Date.now() - startedAt < startupTimeoutMs) {
      if (spawnProcessError !== null) {
        managedLlamaServer = null;
        return buildHealthResult(
          false,
          'binary_missing',
          'Could not start llama-server. Check that the path is the real program (llama-server.exe on Windows).',
          spawnProcessError,
          [`Command: ${commandInfo.command}`, `Log file: ${logPath}`],
        );
      }
      if (proc.exitCode !== null) {
        managedLlamaServer = null;
        return buildHealthResult(
          false,
          'server_exited_early',
          'llama.cpp stopped before it was ready.',
          stderr || `llama-server exited with code ${String(proc.exitCode)}.`,
          [
            `Command: ${commandInfo.command}`,
            `Log file: ${logPath}`,
            ...(stdout ? [`stdout tail: ${stdout.slice(-500)}`] : []),
            ...(stderr ? [`stderr tail: ${stderr.slice(-500)}`] : []),
          ],
        );
      }

      if (await canReachLlamaServer(config.port, 1500)) {
        appendLlamaRuntimeLog(logPath, `[ready] /v1/models responded successfully mmproj=${detectedMmproj ?? 'none'}`);
        return { ...buildHealthResult(true, 'ready', 'llama.cpp is ready.'), mmprojPath: detectedMmproj ?? undefined };
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await stopManagedLlamaServer();
    return buildHealthResult(
      false,
      'startup_timeout',
      'llama.cpp took too long to start.',
      stderr || `Timed out after ${String(Math.round(startupTimeoutMs / 1000))} seconds while waiting for /v1/models.`,
      [
        `Command: ${commandInfo.command}`,
        `Startup timeout: ${String(Math.round(startupTimeoutMs / 1000))}s`,
        `Log file: ${logPath}`,
        ...(stdout ? [`stdout tail: ${stdout.slice(-500)}`] : []),
        ...(stderr ? [`stderr tail: ${stderr.slice(-500)}`] : []),
      ],
    );
  })();

  managedLlamaStartup = { configKey, promise: startupPromise };
  try {
    return await startupPromise;
  } finally {
    if (managedLlamaStartup?.promise === startupPromise) {
      managedLlamaStartup = null;
    }
  }
}

async function fetchLlamaModels(config: LlamaCppConfig): Promise<{ success: boolean; models: Array<{ id: string; label: string }>; error?: string }> {
  const health = await ensureManagedLlamaServer(config);
  if (!health.ok) {
    return { success: false, models: [], error: health.error ?? health.message ?? 'llama.cpp is not ready.' };
  }

  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { success: false, models: [], error: `HTTP ${res.status} while listing llama.cpp models.` };
    }

    const json = await res.json() as { data?: Array<{ id?: string }> };
    const data = Array.isArray(json.data) ? json.data : [];
    const models = data
      .map((row) => row.id?.trim())
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ id, label: id }));

    if (models.length === 0) {
      const fallback = path.basename(config.modelPath, path.extname(config.modelPath));
      return { success: true, models: [{ id: fallback, label: fallback }] };
    }
    return { success: true, models };
  } catch (error) {
    return { success: false, models: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function streamLlamaChat(
  requestId: string,
  config: LlamaCppConfig,
  request: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const health = await ensureManagedLlamaServer(config);
  if (!health.ok) {
    return { success: false, error: health.error ?? health.message ?? 'llama.cpp is not ready.' };
  }

  const controller = new AbortController();
  managedAbortControllers.set(requestId, controller);
  const logPath = managedLlamaServer?.logPath ?? getLlamaRuntimeLogPath();
  appendLlamaRuntimeLog(logPath, `[stream:start] requestId=${requestId} ${summarizeChatRequest(request)}`);

  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    appendLlamaRuntimeLog(logPath, `[stream:response] requestId=${requestId} status=${String(response.status)} ok=${String(response.ok)}`);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      appendLlamaRuntimeLog(logPath, `[stream:http-error] requestId=${requestId} body=${body.slice(0, 1000)}`);
      managedAbortControllers.delete(requestId);
      broadcastToWindows('llama-cpp-stream-event', {
        requestId,
        type: 'error',
        error: `HTTP ${response.status}: ${body}`,
      } satisfies LlamaStreamEvent);
      return { success: true };
    }

    if (!response.body) {
      managedAbortControllers.delete(requestId);
      broadcastToWindows('llama-cpp-stream-event', {
        requestId,
        type: 'error',
        error: 'llama.cpp returned an empty response body.',
      } satisfies LlamaStreamEvent);
      return { success: true };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolAccum = new Map<number, { id: string; name: string; arguments: string }>();
    let tokenCount = 0;
    let thinkingCount = 0;

    const emitDone = (finishReason: string | null) => {
      appendLlamaRuntimeLog(
        logPath,
        `[stream:done] requestId=${requestId} finish_reason=${String(finishReason)} tokens=${String(tokenCount)} thinking_chunks=${String(thinkingCount)} tool_calls=${String(toolAccum.size)}`,
      );
      broadcastToWindows('llama-cpp-stream-event', {
        requestId,
        type: 'done',
        finishReason,
      } satisfies LlamaStreamEvent);
    };

    const emitToolCalls = () => {
      if (toolAccum.size === 0) return;
      const toolCalls: OpenAiToolCall[] = [...toolAccum.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => ({
          id: acc.id || randomUUID(),
          type: 'function',
          function: {
            name: acc.name,
            arguments: acc.arguments,
          },
        }));
      appendLlamaRuntimeLog(
        logPath,
        `[stream:tool-calls] requestId=${requestId} count=${String(toolCalls.length)} names=${toolCalls.map((call) => call.function.name).join(',')}`,
      );

      broadcastToWindows('llama-cpp-stream-event', {
        requestId,
        type: 'tool_calls',
        toolCalls,
      } satisfies LlamaStreamEvent);
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            emitDone(null);
            managedAbortControllers.delete(requestId);
            return { success: true };
          }

          let chunk: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
          };

          try {
            chunk = JSON.parse(payload) as typeof chunk;
          } catch {
            continue;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const content = choice.delta?.content;
          if (content) {
            tokenCount += 1;
            if (tokenCount === 1) {
              appendLlamaRuntimeLog(logPath, `[stream:first-token] requestId=${requestId} token=${JSON.stringify(content.slice(0, 120))}`);
            }
            broadcastToWindows('llama-cpp-stream-event', {
              requestId,
              type: 'token',
              token: content,
            } satisfies LlamaStreamEvent);
          }

          const thinking = choice.delta?.reasoning_content;
          if (thinking) {
            thinkingCount += 1;
            broadcastToWindows('llama-cpp-stream-event', {
              requestId,
              type: 'thinking',
              thinking,
            } satisfies LlamaStreamEvent);
          }

          const deltaToolCalls = choice.delta?.tool_calls;
          if (deltaToolCalls) {
            for (const toolCall of deltaToolCalls) {
              const idx = toolCall.index ?? 0;
              if (!toolAccum.has(idx)) {
                toolAccum.set(idx, { id: '', name: '', arguments: '' });
              }
              const acc = toolAccum.get(idx)!;
              if (toolCall.id) acc.id = toolCall.id;
              if (toolCall.function?.name) acc.name += toolCall.function.name;
              if (toolCall.function?.arguments) acc.arguments += toolCall.function.arguments;
            }
          }

          if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
            if (choice.finish_reason === 'tool_calls') {
              emitToolCalls();
            }
            emitDone(choice.finish_reason);
            managedAbortControllers.delete(requestId);
            return { success: true };
          }
        }
      }

      emitDone(null);
      managedAbortControllers.delete(requestId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLlamaRuntimeLog(logPath, `[stream:exception] requestId=${requestId} message=${message}`);
      if (message === 'This operation was aborted') {
        emitDone('cancelled');
      } else {
        broadcastToWindows('llama-cpp-stream-event', {
          requestId,
          type: 'error',
          error: message,
        } satisfies LlamaStreamEvent);
      }
      managedAbortControllers.delete(requestId);
      return { success: true };
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    managedAbortControllers.delete(requestId);
    appendLlamaRuntimeLog(
      logPath,
      `[stream:startup-error] requestId=${requestId} message=${error instanceof Error ? error.message : String(error)}`,
    );
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerLlamaRuntimeIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('set-ollama-cleanup-targets', async (_event, payload: OllamaCleanupState) => {
    const previous = ollamaCleanupState;
    if (previous.runtime !== payload.runtime) {
      if (payload.runtime === 'ollama') {
        await Promise.all([stopManagedLlamaServer(), stopManagedSttServer()]);
      } else {
        await unloadOllamaModels(previous.models);
      }
    }

    ollamaCleanupState = {
      runtime: payload.runtime,
      models: [...new Set(payload.models.map((model) => model.trim()).filter(Boolean))],
    };
    return { success: true };
  });

  ipcMain.handle('llama-cpp-health-check', async (_event, config: LlamaCppConfig): Promise<LlamaCppHealthResult> => {
    return ensureManagedLlamaServer(config);
  });

  ipcMain.handle('llama-cpp-list-models', async (_event, config: LlamaCppConfig) => {
    return fetchLlamaModels(config);
  });

  ipcMain.handle('llama-cpp-start-stream', async (_event, { requestId, config, request }: { requestId: string; config: LlamaCppConfig; request: Record<string, unknown> }) => {
    return streamLlamaChat(requestId, config, request);
  });

  ipcMain.handle('llama-cpp-abort-stream', async (_event, { requestId }: { requestId: string }) => {
    managedAbortControllers.get(requestId)?.abort();
    managedAbortControllers.delete(requestId);
    return { success: true };
  });
}

export async function cleanupLlamaRuntimeOnQuit(): Promise<void> {
  for (const controller of managedAbortControllers.values()) {
    controller.abort();
  }
  managedAbortControllers.clear();
  if (ollamaCleanupState.runtime === 'ollama') {
    await unloadOllamaModels(ollamaCleanupState.models);
    return;
  }
  await Promise.all([stopManagedLlamaServer(), stopManagedSttServer()]);
}
