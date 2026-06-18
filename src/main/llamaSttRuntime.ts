import { type IpcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { resolveGgufPath, resolveLocalServerPort, killProcessTree, recordManagedPid, forgetManagedPid } from './llamaCppUtils';
import { getManagedLlamaResolvedPort } from './llamaRuntime';
import { buildTranscribePrompt } from '../shared/transcription';
import {
  LLAMA_STT_BATCH_SIZE,
  LLAMA_STT_CTX_SIZE,
  appendSttRuntimeLog,
  buildHealthResult,
  canReachSttServer,
  findMmprojForConfig,
  getSttRuntimeLogPath,
  resetSttRuntimeLog,
  resolveSttServerCommand,
  sanitizeLlamaSttReply,
  shouldFallbackToMtmdCli,
  transcribeWithMtmdCli,
  validateSttConfig,
} from './llamaSttUtils';

const LLAMA_STT_STARTUP_TIMEOUT_MS = 120000;

interface ManagedSttServer {
  configKey: string;
  process: ChildProcess | null;
  logPath: string;
  resolvedPort: number;
}

let managedSttServer: ManagedSttServer | null = null;
let managedSttStartup: { configKey: string; promise: Promise<LlamaCppHealthResult> } | null = null;

export function getManagedSttResolvedPort(): number | null {
  return managedSttServer?.resolvedPort ?? null;
}

function sttConfigKey(config: LlamaCppSttConfig): string {
  return JSON.stringify({
    serverPath: config.serverPath.trim(),
    sttModelPath: config.sttModelPath.trim(),
    mmprojSearchPaths: config.mmprojSearchPaths.map((value) => value.trim()),
    mainPort: config.mainPort,
    sttPort: config.sttPort,
    gpuLayers: config.gpuLayers,
  });
}

export async function stopManagedSttServer(): Promise<void> {
  const current = managedSttServer;
  if (!current) return;

  managedSttServer = null;
  await killProcessTree(current.process);
}

async function ensureManagedSttServer(config: LlamaCppSttConfig): Promise<LlamaCppHealthResult> {
  const resolvedConfig: LlamaCppSttConfig = { ...config, sttModelPath: resolveGgufPath(config.sttModelPath) };
  const invalid = validateSttConfig(resolvedConfig);
  if (invalid) return invalid;
  config = resolvedConfig;

  const configKey = sttConfigKey(config);

  if (managedSttStartup?.configKey === configKey) {
    return managedSttStartup.promise;
  }
  if (managedSttStartup && managedSttStartup.configKey !== configKey) {
    try { await managedSttStartup.promise; } catch { /* ignore previous startup */ }
  }

  const startupPromise = (async (): Promise<LlamaCppHealthResult> => {
    if (managedSttServer && managedSttServer.configKey === configKey) {
      if (
        (!managedSttServer.process || managedSttServer.process.exitCode === null) &&
        await canReachSttServer(managedSttServer.resolvedPort, 1500)
      ) {
        return {
          ...buildHealthResult(true, 'ready', `STT server is ready on port ${String(managedSttServer.resolvedPort)}.`),
          preferredPort: config.sttPort,
          resolvedPort: managedSttServer.resolvedPort,
        };
      }
      await stopManagedSttServer();
    } else if (managedSttServer) {
      await stopManagedSttServer();
    }

    const logPath = resetSttRuntimeLog();
    const reservedPorts = new Set<number>();
    if (Number.isInteger(config.mainPort)) {
      reservedPorts.add(config.mainPort as number);
    }
    const activeMainPort = getManagedLlamaResolvedPort();
    if (activeMainPort != null) {
      reservedPorts.add(activeMainPort);
    }
    const portResolution = await resolveLocalServerPort({
      preferredPort: config.sttPort,
      expectedModelPath: config.sttModelPath,
      roleLabel: 'STT llama.cpp server',
      excludedPorts: [...reservedPorts],
      log: (line) => appendSttRuntimeLog(logPath, line),
    });
    if (!portResolution.ok || portResolution.resolvedPort == null) {
      return {
        ...buildHealthResult(false, 'port_conflict', portResolution.reason, portResolution.reason, portResolution.details),
        preferredPort: config.sttPort,
      };
    }
    const resolvedPort = portResolution.resolvedPort;

    let commandInfo: { command: string; args: string[] };
    try {
      commandInfo = resolveSttServerCommand(config.serverPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildHealthResult(false, 'binary_missing', 'I could not find the llama-server binary.', message);
    }

    const gpuLayers = config.gpuLayers === -1 ? 'all' : String(config.gpuLayers);
    const detectedMmproj = findMmprojForConfig(config.sttModelPath, config.mmprojSearchPaths);
    if (portResolution.reusedExisting) {
      managedSttServer = { configKey, process: null, logPath, resolvedPort };
      appendSttRuntimeLog(logPath, `[ready] reused-existing-server port=${String(resolvedPort)} mmproj=${detectedMmproj ?? 'none'}`);
      return {
        ...buildHealthResult(true, 'ready', portResolution.reason, undefined, portResolution.details),
        preferredPort: config.sttPort,
        resolvedPort,
      };
    }
    const spawnArgs = [
      ...commandInfo.args,
      '-m', config.sttModelPath,
      ...(detectedMmproj ? ['--mmproj', detectedMmproj] : []),
      '--host', '127.0.0.1',
      '--port', String(resolvedPort),
      '--jinja',
      '--ctx-size', String(LLAMA_STT_CTX_SIZE),
      '--batch-size', String(LLAMA_STT_BATCH_SIZE),
      '--parallel', '1',
      '--flash-attn', 'on',
      '--n-gpu-layers', gpuLayers,
    ];
    appendSttRuntimeLog(logPath, `[port-resolution] preferred=${String(config.sttPort)} resolved=${String(resolvedPort)} main_reserved=${String(config.mainPort ?? 'none')}`);
    appendSttRuntimeLog(logPath, `[spawn] ${commandInfo.command} ${spawnArgs.join(' ')}`);

    const proc = spawn(commandInfo.command, spawnArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    recordManagedPid(proc.pid);

    let spawnProcessError: string | null = null;
    proc.once('error', (err) => {
      spawnProcessError = err.message;
      appendSttRuntimeLog(logPath, `[spawn:error] ${err.message}`);
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (stdout.length > 4000) stdout = stdout.slice(-4000);
      appendSttRuntimeLog(logPath, `[stdout] ${text.trimEnd()}`);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
      appendSttRuntimeLog(logPath, `[stderr] ${text.trimEnd()}`);
    });
    proc.once('exit', (code, signal) => {
      forgetManagedPid(proc.pid);
      appendSttRuntimeLog(logPath, `[exit] code=${String(code)} signal=${String(signal)}`);
    });

    managedSttServer = { configKey, process: proc, logPath, resolvedPort };

    const startedAt = Date.now();
    while (Date.now() - startedAt < LLAMA_STT_STARTUP_TIMEOUT_MS) {
      if (spawnProcessError !== null) {
        managedSttServer = null;
        return buildHealthResult(
          false, 'binary_missing',
          'Could not start the STT server. Check the llama-server binary path.',
          spawnProcessError,
          [`Command: ${commandInfo.command}`, `Log file: ${logPath}`],
        );
      }
      if (proc.exitCode !== null) {
        managedSttServer = null;
        return buildHealthResult(
          false, 'server_exited_early',
          'The STT server stopped before it was ready.',
          stderr || `llama-server exited with code ${String(proc.exitCode)}.`,
          [
            `Command: ${commandInfo.command}`,
            `Log file: ${logPath}`,
            ...(stdout ? [`stdout tail: ${stdout.slice(-500)}`] : []),
            ...(stderr ? [`stderr tail: ${stderr.slice(-500)}`] : []),
          ],
        );
      }
      if (await canReachSttServer(resolvedPort, 1500)) {
        appendSttRuntimeLog(logPath, `[ready] /v1/models responded port=${String(resolvedPort)} mmproj=${detectedMmproj ?? 'none'}`);
        return {
          ...buildHealthResult(true, 'ready', portResolution.reason, undefined, portResolution.details),
          preferredPort: config.sttPort,
          resolvedPort,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await stopManagedSttServer();
    return buildHealthResult(
      false, 'startup_timeout',
      'The STT server took too long to start.',
      stderr || `Timed out after ${String(Math.round(LLAMA_STT_STARTUP_TIMEOUT_MS / 1000))} seconds.`,
      [
        `Command: ${commandInfo.command}`,
        `Log file: ${logPath}`,
        ...(stdout ? [`stdout tail: ${stdout.slice(-500)}`] : []),
        ...(stderr ? [`stderr tail: ${stderr.slice(-500)}`] : []),
      ],
    );
  })();

  managedSttStartup = { configKey, promise: startupPromise };
  try {
    return await startupPromise;
  } finally {
    if (managedSttStartup?.promise === startupPromise) {
      managedSttStartup = null;
    }
  }
}

export function registerLlamaSttIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('llama-cpp-stt-health-check', async (_event, sttConfig: LlamaCppSttConfig): Promise<LlamaCppHealthResult> => {
    return ensureManagedSttServer(sttConfig);
  });

  ipcMain.handle('llama-cpp-transcribe', async (_event, { sttConfig, audioBase64, languageHint }: { sttConfig: LlamaCppSttConfig; audioBase64: string; languageHint?: string }) => {
    const health = await ensureManagedSttServer(sttConfig);
    if (!health.ok) {
      return { success: false, error: health.error ?? health.message ?? 'STT server is not ready.' };
    }

    const transcribePort = health.resolvedPort ?? sttConfig.sttPort;
    const logPath = managedSttServer?.logPath ?? getSttRuntimeLogPath();
    const modelName = path.basename(sttConfig.sttModelPath, path.extname(sttConfig.sttModelPath));
    const prompt = buildTranscribePrompt(languageHint);
    appendSttRuntimeLog(logPath, `[transcribe:start] model=${modelName} lang=${languageHint ?? ''}`);

    let result: { success: boolean; text?: string; error?: string };
    try {
      const res = await fetch(`http://127.0.0.1:${String(transcribePort)}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{
            role: 'user',
            content: [
              { type: 'input_audio', input_audio: { data: audioBase64, format: 'wav' } },
              { type: 'text', text: prompt },
            ],
          }],
          stream: false,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        appendSttRuntimeLog(logPath, `[transcribe:http-error] status=${String(res.status)} body=${body.slice(0, 500)}`);
        if (shouldFallbackToMtmdCli(body, res.status)) {
          appendSttRuntimeLog(logPath, '[transcribe:fallback] server audio unsupported, trying llama-mtmd-cli');
          result = await transcribeWithMtmdCli(sttConfig, audioBase64, prompt, logPath);
        } else {
          result = { success: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
      } else {
        const data = await res.json() as {
          choices?: Array<{
            message?: {
              content?: string;
              reasoning_content?: string;
            };
          }>;
        };
        const rawContent = data.choices?.[0]?.message?.content ?? '';
        const reasoning = data.choices?.[0]?.message?.reasoning_content ?? '';
        const text = sanitizeLlamaSttReply(rawContent, languageHint);
        appendSttRuntimeLog(
          logPath,
          `[transcribe:done] contentLen=${String(rawContent.trim().length)} sanitizedLen=${String(text.length)} reasoningLen=${String(reasoning.trim().length)}`,
        );
        result = text ? { success: true, text } : { success: false, error: 'Empty transcription returned' };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appendSttRuntimeLog(logPath, `[transcribe:error] ${msg}`);
      result = { success: false, error: msg };
    }

    // Release the dedicated STT server to free VRAM — coding server stays loaded.
    void stopManagedSttServer();
    return result;
  });
}
