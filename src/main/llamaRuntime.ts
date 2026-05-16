import { type IpcMain } from 'electron';
import { getManagedSttResolvedPort, stopManagedSttServer } from './llamaSttRuntime';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  findMmprojForConfig,
  resolveGgufPath,
  runtimeConfigKey,
  buildHealthResult,
  getLlamaRuntimeLogPath,
  resetLlamaRuntimeLog,
  appendLlamaRuntimeLog,
  validateLlamaConfig,
  getLlamaStartupTimeoutMs,
  resolveLlamaServerCommand,
  canReachLlamaServer,
  resolveLocalServerPort,
} from './llamaCppUtils';
import { streamLlamaChat } from './llamaCppStream';

const LLAMA_DEFAULT_BATCH_SIZE = 512;

export interface ManagedLlamaServer {
  configKey: string;
  config: LlamaCppConfig;
  process: ChildProcess | null;
  logPath: string;
  resolvedPort: number;
}

interface OllamaCleanupState {
  runtime: 'ollama' | 'llama_cpp';
  models: string[];
}

export const managedAbortControllers = new Map<string, AbortController>();
export let managedLlamaServer: ManagedLlamaServer | null = null;
let managedLlamaStartup: { configKey: string; promise: Promise<LlamaCppHealthResult> } | null = null;
let ollamaCleanupState: OllamaCleanupState = { runtime: 'ollama', models: [] };

export function getManagedLlamaResolvedPort(): number | null {
  return managedLlamaServer?.resolvedPort ?? null;
}

export function getManagedLlamaModelPath(): string | null {
  return managedLlamaServer?.config.modelPath ?? null;
}

async function stopManagedLlamaServer(): Promise<void> {
  const current = managedLlamaServer;
  if (!current) return;

  managedLlamaServer = null;
  const proc = current.process;
  if (!proc) {
    return;
  }
  if (proc.exitCode !== null || proc.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill();
      }
      resolve();
    }, 3000);

    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    proc.kill();
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
        body: JSON.stringify({ model, keep_alive: 0 }),
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
  const resolvedConfig: LlamaCppConfig = { ...config, modelPath: resolveGgufPath(config.modelPath) };
  const invalid = validateLlamaConfig(resolvedConfig);
  if (invalid) return invalid;
  config = resolvedConfig;

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
      if (
        (!managedLlamaServer.process || managedLlamaServer.process.exitCode === null) &&
        await canReachLlamaServer(managedLlamaServer.resolvedPort, 1500)
      ) {
        return {
          ...buildHealthResult(true, 'ready', `llama.cpp is ready on port ${String(managedLlamaServer.resolvedPort)}.`),
          mmprojPath: findMmprojForConfig(config.modelPath, config.mmprojSearchPaths) ?? undefined,
          sttMmprojPath: config.sttModelPath?.trim() ? findMmprojForConfig(config.sttModelPath.trim(), config.mmprojSearchPaths) ?? undefined : undefined,
          preferredPort: config.port,
          resolvedPort: managedLlamaServer.resolvedPort,
        };
      }
      await stopManagedLlamaServer();
    } else if (managedLlamaServer) {
      await stopManagedLlamaServer();
    }

    const logPath = resetLlamaRuntimeLog();
    const reservedPorts = new Set<number>();
    if (Number.isInteger(config.sttPort) && config.sttPort !== config.port) {
      reservedPorts.add(config.sttPort as number);
    }
    const activeSttPort = getManagedSttResolvedPort();
    if (activeSttPort != null && activeSttPort !== config.port) {
      reservedPorts.add(activeSttPort);
    }
    const portResolution = await resolveLocalServerPort({
      preferredPort: config.port,
      expectedModelPath: config.modelPath,
      roleLabel: 'Main llama.cpp server',
      excludedPorts: [...reservedPorts],
      log: (line) => appendLlamaRuntimeLog(logPath, line),
    });
    if (!portResolution.ok || portResolution.resolvedPort == null) {
      return {
        ...buildHealthResult(false, 'port_conflict', portResolution.reason, portResolution.reason, portResolution.details),
        preferredPort: config.port,
      };
    }
    const resolvedPort = portResolution.resolvedPort;

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
    const sttMmproj = config.sttModelPath?.trim() ? findMmprojForConfig(config.sttModelPath.trim(), config.mmprojSearchPaths) : null;
    if (portResolution.reusedExisting) {
      managedLlamaServer = { configKey, config, process: null, logPath, resolvedPort };
      appendLlamaRuntimeLog(logPath, `[ready] reused-existing-server port=${String(resolvedPort)} mmproj=${detectedMmproj ?? 'none'} stt_mmproj=${sttMmproj ?? 'none'}`);
      return {
        ...buildHealthResult(true, 'ready', portResolution.reason, undefined, portResolution.details),
        mmprojPath: detectedMmproj ?? undefined,
        sttMmprojPath: sttMmproj ?? undefined,
        preferredPort: config.port,
        resolvedPort,
      };
    }
    const spawnArgs = [
      ...commandInfo.args,
      '-m', config.modelPath,
      ...(detectedMmproj ? ['--mmproj', detectedMmproj] : []),
      '--host', '127.0.0.1',
      '--port', String(resolvedPort),
      '--jinja',
      '--ctx-size', String(ctxSize),
      '--batch-size', String(LLAMA_DEFAULT_BATCH_SIZE),
      '--parallel', '1',
      '--cache-type-k', cacheTypeK,
      '--cache-type-v', cacheTypeV,
      '--flash-attn', 'on',
      '--n-gpu-layers', gpuLayers,
    ];
    appendLlamaRuntimeLog(logPath, `[port-resolution] preferred=${String(config.port)} resolved=${String(resolvedPort)} stt_reserved=${String(config.sttPort ?? 'none')}`);
    appendLlamaRuntimeLog(logPath, `[spawn:config] ctx_size=${String(ctxSize)} startup_timeout_s=${String(Math.round(startupTimeoutMs / 1000))}`);
    appendLlamaRuntimeLog(logPath, `[spawn] ${commandInfo.command} ${spawnArgs.join(' ')}`);
    const proc = spawn(commandInfo.command, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

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

    managedLlamaServer = { configKey, config, process: proc, logPath, resolvedPort };

    const startedAt = Date.now();
    while (Date.now() - startedAt < startupTimeoutMs) {
      if (spawnProcessError !== null) {
        managedLlamaServer = null;
        return buildHealthResult(
          false, 'binary_missing',
          'Could not start llama-server. Check that the path is the real program (llama-server.exe on Windows).',
          spawnProcessError,
          [`Command: ${commandInfo.command}`, `Log file: ${logPath}`],
        );
      }
      if (proc.exitCode !== null) {
        managedLlamaServer = null;
        return buildHealthResult(
          false, 'server_exited_early',
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

      if (await canReachLlamaServer(resolvedPort, 1500)) {
        appendLlamaRuntimeLog(logPath, `[ready] /v1/models responded successfully port=${String(resolvedPort)} mmproj=${detectedMmproj ?? 'none'} stt_mmproj=${sttMmproj ?? 'none'}`);
        return {
          ...buildHealthResult(true, 'ready', portResolution.reason, undefined, portResolution.details),
          mmprojPath: detectedMmproj ?? undefined,
          sttMmprojPath: sttMmproj ?? undefined,
          preferredPort: config.port,
          resolvedPort,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await stopManagedLlamaServer();
    return buildHealthResult(
      false, 'startup_timeout',
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

  const resolvedPort = health.resolvedPort ?? config.port;
  try {
    const res = await fetch(`http://127.0.0.1:${resolvedPort}/v1/models`, {
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

async function streamLlamaChatWithHealth(
  requestId: string,
  config: LlamaCppConfig,
  request: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const health = await ensureManagedLlamaServer(config);
  if (!health.ok) {
    return { success: false, error: health.error ?? health.message ?? 'llama.cpp is not ready.' };
  }
  return streamLlamaChat(
    requestId,
    { ...config, port: health.resolvedPort ?? config.port },
    request,
    managedAbortControllers,
    () => managedLlamaServer?.logPath ?? null,
  );
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
    return streamLlamaChatWithHealth(requestId, config, request);
  });

  ipcMain.handle('llama-cpp-abort-stream', async (_event, { requestId }: { requestId: string }) => {
    managedAbortControllers.get(requestId)?.abort();
    managedAbortControllers.delete(requestId);
    return { success: true };
  });

  ipcMain.handle('llama-cpp-clear-kv', async (_event, { port }: { port: number }) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/slots/0?action=erase`, { method: 'POST' });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
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
