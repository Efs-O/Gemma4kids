import { OLLAMA_NUM_CTX } from '../ollamaConstants';

const OLLAMA_BASE = 'http://localhost:11434';

export async function isRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json() as { models: Array<{ name: string }> };
    return data.models.map(m => m.name);
  } catch {
    return [];
  }
}

/** Transcribe audio via Gemma 4 E4B. audioBase64 is a base64-encoded WAV blob. */
export async function transcribe(audioBase64: string, model: string = 'gemma4:e4b'): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: 'Transcribe exactly what the child said. Return only the transcription text, nothing else.',
        images: [audioBase64],
      }],
      keep_alive: 0,
      stream: false,
      options: { num_ctx: OLLAMA_NUM_CTX },
    }),
  });

  if (!res.ok) throw new Error(`Transcribe HTTP ${res.status}`);

  const data = await res.json() as { message?: { content?: string } };
  const text = (data.message?.content ?? '').trim();
  if (!text) throw new Error('Empty transcription returned');
  return text;
}
