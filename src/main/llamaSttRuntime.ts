import { app, type IpcMain } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveGgufPath, resolveLocalServerPort } from './llamaCppUtils';
import { getManagedLlamaResolvedPort } from './llamaRuntime';

const LLAMA_STT_STARTUP_TIMEOUT_MS = 120000;
const LLAMA_STT_CTX_SIZE = 8192;
const LLAMA_STT_BATCH_SIZE = 512;
const LLAMA_STT_RUNTIME_LOG = 'llama-stt-runtime.log';

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

function getSttRuntimeLogPath(): string {
  return path.join(app.getPath('userData'), LLAMA_STT_RUNTIME_LOG);
}

function resetSttRuntimeLog(): string {
  const logPath = getSttRuntimeLogPath();
  fs.writeFileSync(logPath, '', 'utf8');
  return logPath;
}

function appendSttRuntimeLog(logPath: string, line: string): void {
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // Logging must never break STT startup.
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

function validateSttConfig(config: LlamaCppSttConfig): LlamaCppHealthResult | null {
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

function resolveSttServerCommand(serverPath: string): { command: string; args: string[] } {
  const trimmed = serverPath.trim();
  if (!trimmed) throw new Error('llama-server binary path is empty.');

  if (!path.isAbsolute(trimmed)) return { command: trimmed, args: [] };

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
      // ignore
    }
  }

  throw new Error(`llama-server binary not found at ${trimmed}.`);
}

function resolveMtmdCliCommand(serverPath: string): { command: string; args: string[] } {
  const trimmed = serverPath.trim();
  if (!trimmed) throw new Error('llama-server binary path is empty.');

  const cliName = process.platform === 'win32' ? 'llama-mtmd-cli.exe' : 'llama-mtmd-cli';
  const serverExeName = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

  const candidates: string[] = [];
  if (!path.isAbsolute(trimmed)) {
    candidates.push(trimmed.replace(/llama-server(?:\.exe)?$/i, cliName));
    candidates.push(cliName);
  } else if (fs.existsSync(trimmed)) {
    const st = fs.statSync(trimmed);
    if (st.isFile()) {
      const dir = path.dirname(trimmed);
      const base = path.basename(trimmed);
      if (base.toLowerCase() === serverExeName.toLowerCase()) {
        candidates.push(path.join(dir, cliName));
      }
      candidates.push(path.join(dir, cliName));
    } else if (st.isDirectory()) {
      candidates.push(path.join(trimmed, cliName));
    }
  } else {
    const dir = path.dirname(trimmed);
    candidates.push(path.join(dir, cliName));
  }

  for (const candidate of candidates) {
    try {
      if (path.isAbsolute(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { command: candidate, args: [] };
      }
      if (!path.isAbsolute(candidate)) {
        return { command: candidate, args: [] };
      }
    } catch {
      // ignore
    }
  }

  throw new Error(`llama-mtmd-cli not found next to llama-server. Expected ${cliName}.`);
}

function shouldFallbackToMtmdCli(body: string, status: number): boolean {
  const normalized = body.toLowerCase();
  return status >= 500 && (
    normalized.includes('audio input is not supported') ||
    normalized.includes('unsupported content part type') ||
    normalized.includes('input_audio')
  );
}

function buildTranscribePrompt(languageHint?: string): string {
  const hint = (languageHint ?? '').trim().toLowerCase();
  if (hint.startsWith('el') && hint.includes('strict')) {
    return 'The spoken language is Greek (el-GR). Transcribe exactly what is spoken. Output only Greek script, spaces, digits, and normal punctuation. Never translate. Never transliterate. Never output Arabic script, Cyrillic script, or Latin transliteration unless a foreign word is unmistakably spoken. If unsure, prefer the most plausible Greek-script transcription. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('el')) {
    return 'The spoken language is most likely Greek (el-GR). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is Greek, return only Greek script. If a short foreign word is clearly spoken, keep that word exactly as spoken. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('de')) {
    return 'The spoken language is most likely German (de-DE). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is German, return only German text with normal German spelling. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('en')) {
    return 'The spoken language is most likely English (en). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is English, return only English text. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  return 'Transcribe exactly what is spoken in the audio. First infer whether the speech is Greek, German, English, or another language. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages unless the speaker actually switches languages. If the speech is Greek, return Greek script. If the speech is German, return German spelling. If the speech is English, return English text. Output only the transcription text, with no newlines. Write numbers as digits.';
}

async function transcribeWithMtmdCli(
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

async function canReachSttServer(port: number, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function stopManagedSttServer(): Promise<void> {
  const current = managedSttServer;
  if (!current) return;

  managedSttServer = null;
  const proc = current.process;
  if (!proc) return;
  if (proc.exitCode !== null || proc.killed) return;

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

    const modelName = path.basename(sttConfig.sttModelPath, path.extname(sttConfig.sttModelPath));
    const prompt = buildTranscribePrompt(languageHint);

    const logPath = managedSttServer?.logPath ?? getSttRuntimeLogPath();
    appendSttRuntimeLog(logPath, `[transcribe:start] model=${modelName} lang=${languageHint ?? ''}`);

    try {
      const res = await fetch(`http://127.0.0.1:${health.resolvedPort ?? sttConfig.sttPort}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelName,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'input_audio', input_audio: { data: audioBase64, format: 'wav' } },
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
          return transcribeWithMtmdCli(sttConfig, audioBase64, prompt, logPath);
        }
        return { success: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      appendSttRuntimeLog(logPath, `[transcribe:done] textLen=${String(text.length)}`);
      if (!text) return { success: false, error: 'Empty transcription returned' };
      return { success: true, text };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      appendSttRuntimeLog(logPath, `[transcribe:error] ${msg}`);
      return { success: false, error: msg };
    }
  });
}
