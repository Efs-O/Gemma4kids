import { OLLAMA_TRANSCRIBE_PROFILE } from '../ollamaConstants';

const OLLAMA_BASE = 'http://localhost:11434';

interface OllamaTagsResponse {
  models: Array<{ name: string }>;
}

function formatOllamaError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

async function fetchTags(timeoutMs: number): Promise<OllamaTagsResponse> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      throw new Error(`Ollama replied with HTTP ${res.status} while checking installed models.`);
    }
    return await res.json() as OllamaTagsResponse;
  } catch (error) {
    throw formatOllamaError(error);
  }
}

export async function getModels(): Promise<string[]> {
  const data = await fetchTags(5000);
  return data.models.map(m => m.name);
}

/** Fire-and-forget: loads the coding model into VRAM so the first prompt is instant. */
export function warmupCodingModel(model: string): void {
  fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
      options: { num_predict: 1 },
    }),
  }).catch(() => { /* silent — warmup is best-effort */ });
}

export interface EncodedAudioPayload {
  audioBase64: string;
  durationSeconds: number;
}

function buildTranscribePrompt(languageHint?: string): string {
  const hint = (languageHint ?? '').trim().toLowerCase();
  if (hint.startsWith('el')) {
    return 'The spoken language is Greek (el-GR). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Return only Greek characters. Never translate. Never transliterate. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  return 'Transcribe exactly what is spoken in the audio. Keep the original language and script exactly as spoken. Never translate. Never transliterate. If the speaker uses Greek, return Greek characters. Output only the transcription text, with no newlines. Write numbers as digits.';
}

/**
 * Convert any browser audio blob (WebM/Ogg/etc.) to a 16kHz mono WAV with a
 * proper RIFF header — required by Ollama's Gemma4 audio workaround.
 */
export async function audioBlobToWav16k(blob: Blob): Promise<EncodedAudioPayload> {
  const arrayBuf = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuf);
  audioCtx.close();

  const TARGET_SR = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET_SR), TARGET_SR);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  const pcmData = rendered.getChannelData(0);
  const pcmBytes = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    pcmBytes[i] = Math.max(-32768, Math.min(32767, Math.round(pcmData[i] * 32767)));
  }

  // Build RIFF/WAV header (44 bytes)
  const pcmLen = pcmBytes.byteLength;
  const wavBuf = new ArrayBuffer(44 + pcmLen);
  const view = new DataView(wavBuf);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');  view.setUint32(4, 36 + pcmLen, true);
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SR, true); view.setUint32(28, TARGET_SR * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, pcmLen, true);
  new Int16Array(wavBuf, 44).set(pcmBytes);

  const bytes = new Uint8Array(wavBuf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return {
    audioBase64: btoa(binary),
    durationSeconds: decoded.duration,
  };
}

export async function audioBlobToWav16kBase64(blob: Blob): Promise<string> {
  const encoded = await audioBlobToWav16k(blob);
  return encoded.audioBase64;
}

/**
 * Transcribe audio via Gemma 4 E4B.
 * audioBase64 must be a base64-encoded 16kHz mono WAV (use audioBlobToWav16kBase64).
 * Workaround per https://github.com/ollama/ollama/issues/15333:
 *   - images field before text prompt, num_ctx capped at 8192.
 */
export async function transcribe(
  audioBase64: string,
  model: string = 'gemma4:e4b',
  keepAlive: 0 | string = OLLAMA_TRANSCRIBE_PROFILE.keepAlive,
  languageHint?: string,
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        // Audio must come before text prompt per Ollama workaround
        images: [audioBase64],
        content: buildTranscribePrompt(languageHint),
      }],
      think: OLLAMA_TRANSCRIBE_PROFILE.think,
      keep_alive: keepAlive,
      stream: false,
      options: { num_ctx: OLLAMA_TRANSCRIBE_PROFILE.numCtx },
    }),
  });

  if (!res.ok) throw new Error(`Transcribe HTTP ${res.status}`);

  const data = await res.json() as { message?: { content?: string } };
  const text = (data.message?.content ?? '').trim();
  if (!text) throw new Error('Empty transcription returned');
  return text;
}
