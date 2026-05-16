import type { ChatMessage, ToolCall, ToolDefinition } from './types';
import type { StreamHandlers } from './OpenAIClient';
import { normalizeOllamaModelRef } from '../utils/pickCodingModel';

/**
 * Ollama native /api/chat expects `function.arguments` as a JSON object.
 * We store OpenAI-style string arguments in history; sending that string back
 * produces HTTP 400: "Value looks like object, but can't find closing '}' symbol".
 */
function toolCallArgumentsAsObject(args: string): Record<string, unknown> {
  const t = args.trim();
  if (!t) return {};
  try {
    const v = JSON.parse(t) as unknown;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* leave empty */
  }
  return {};
}

function toolCallsForOllamaReplay(calls: ToolCall[]): Record<string, unknown>[] {
  return calls.map((tc) => ({
    id: tc.id,
    type: tc.type,
    function: {
      name: tc.function.name,
      arguments: toolCallArgumentsAsObject(tc.function.arguments),
    },
  }));
}

/** Ollama /api/chat expects non-null string content on tool rows. */
function lastUserTurnIndexWithImages(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.images) && m.images.length > 0) return i;
  }
  return -1;
}

function lastUserTurnIndexWithVideos(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && Array.isArray(m.videos) && m.videos.length > 0) return i;
  }
  return -1;
}

function messagesForOllamaApi(messages: ChatMessage[]): Record<string, unknown>[] {
  const lastImagesIdx = lastUserTurnIndexWithImages(messages);
  const lastVideosIdx = lastUserTurnIndexWithVideos(messages);
  return messages.map((m, i) => {
    const row: Record<string, unknown> = { role: m.role };
    if (m.role === 'tool') {
      row.name = m.name;
      row.content = m.content ?? '';
      if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
      return row;
    }
    if (m.tool_calls?.length) {
      row.tool_calls = toolCallsForOllamaReplay(m.tool_calls);
      row.content = m.content ?? '';
    } else {
      row.content = m.content ?? '';
    }
    if (m.role === 'user' && Array.isArray(m.images) && m.images.length > 0 && i === lastImagesIdx) {
      row.images = m.images;
    }
    if (m.role === 'user' && Array.isArray(m.videos) && m.videos.length > 0 && i === lastVideosIdx) {
      row.videos = m.videos;
    }
    return row;
  });
}

interface NativeStreamEvent {
  load_duration?: number;
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string | Record<string, unknown> };
    }>;
  };
  done?: boolean;
  done_reason?: string;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

function shouldKeepAliveForChat(model: string): boolean {
  return normalizeOllamaModelRef(model).toLowerCase() === 'gemma4:e4b';
}

function toolCallsFromAccum(
  toolAccum: Map<number, { id: string; name: string; arguments: string }>,
): ToolCall[] {
  return [...toolAccum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, acc]) => ({
      id: acc.id || `call_${acc.name}`,
      type: 'function' as const,
      function: { name: acc.name, arguments: acc.arguments },
    }));
}

function mergeFinalToolCalls(
  raw: NonNullable<NativeStreamEvent['message']>['tool_calls'],
): ToolCall[] {
  return (raw ?? []).map((tc, i) => {
    const args = tc.function?.arguments;
    const argStr =
      typeof args === 'string' ? args : args != null ? JSON.stringify(args) : '{}';
    return {
      id: tc.id ?? `call_${i}`,
      type: 'function' as const,
      function: { name: tc.function?.name ?? '', arguments: argStr },
    };
  });
}

/**
 * Streaming chat via Ollama native POST /api/chat (not OpenAI-compatible).
 * Required so options.num_ctx / num_predict are honored; /v1/chat/completions
 * often ignores context_length and keeps server defaults (~16K on many GPUs).
 */
export async function streamOllamaNativeChat(
  baseUrl: string,
  params: {
    model: string;
    messages: ChatMessage[];
    tools?: ToolDefinition[];
    think: boolean;
    temperature: number;
    topP: number;
    topK: number;
    numCtx: number;
    numPredict: number;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
  onContextUsage?: (promptTokens: number, evalTokens: number) => void,
): Promise<void> {
  const root = baseUrl.replace(/\/$/, '');
  const body = {
    model: params.model,
    messages: messagesForOllamaApi(params.messages),
    stream: true,
    think: params.think,
    keep_alive: shouldKeepAliveForChat(params.model) ? -1 : undefined,
    tools: params.tools,
    options: {
      num_ctx: params.numCtx,
      num_predict: params.numPredict,
      temperature: params.temperature,
      top_p: params.topP,
      top_k: params.topK,
    },
  };

  let response: Response;
  try {
    response = await fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      handlers.onDone('cancelled');
    } else {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    handlers.onError(new Error(`HTTP ${response.status}: ${text}`));
    return;
  }

  if (!response.body) {
    handlers.onError(new Error('Response body is null'));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = '';
  const toolAccum = new Map<number, { id: string; name: string; arguments: string }>();

  /** @returns `true` if the stream is finished (caller should return) */
  function handleParsedEvent(evt: NativeStreamEvent): boolean {
    if (evt.error) {
      handlers.onError(new Error(evt.error));
      return true;
    }

    const msg = evt.message;
    if (msg?.content) {
      handlers.onToken(msg.content);
    }
    if (msg?.thinking && handlers.onThinkingToken) {
      handlers.onThinkingToken(msg.thinking);
    }

    const deltaTools = msg?.tool_calls;
    if (deltaTools) {
      for (let i = 0; i < deltaTools.length; i++) {
        const tc = deltaTools[i];
        const idx = i;
        if (!toolAccum.has(idx)) {
          toolAccum.set(idx, { id: '', name: '', arguments: '' });
        }
        const acc = toolAccum.get(idx)!;
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        const args = tc.function?.arguments;
        if (typeof args === 'string') {
          acc.arguments += args;
        } else if (args != null && typeof args === 'object') {
          acc.arguments += JSON.stringify(args);
        }
      }
    }

    if (evt.done) {
      if (evt.load_duration != null) {
        console.info('[ollama:chat:done]', {
          model: params.model,
          keepAlive: shouldKeepAliveForChat(params.model) ? -1 : undefined,
          loadDurationNs: evt.load_duration,
          promptEvalCount: evt.prompt_eval_count ?? 0,
          evalCount: evt.eval_count ?? 0,
        });
      }
      onContextUsage?.(evt.prompt_eval_count ?? 0, evt.eval_count ?? 0);

      let calls: ToolCall[] | null = null;
      if (msg?.tool_calls?.length) {
        calls = mergeFinalToolCalls(msg.tool_calls);
      } else if (toolAccum.size > 0) {
        calls = toolCallsFromAccum(toolAccum);
      }

      if (calls?.length && handlers.onToolCalls) {
        const ok = calls.every((c) => c.function.name.length > 0);
        if (ok) {
          handlers.onToolCalls(calls);
          handlers.onDone('tool_calls');
          return true;
        }
      }

      handlers.onDone(evt.done_reason ?? null);
      return true;
    }

    return false;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let evt: NativeStreamEvent;
        try {
          evt = JSON.parse(trimmed) as NativeStreamEvent;
        } catch {
          continue;
        }

        if (handleParsedEvent(evt)) return;
      }
    }

    const tail = lineBuffer.trim();
    if (tail) {
      try {
        const evt = JSON.parse(tail) as NativeStreamEvent;
        if (handleParsedEvent(evt)) return;
      } catch {
        /* tail not valid JSON */
      }
    }

    handlers.onDone(null);
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      handlers.onDone('cancelled');
    } else {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  } finally {
    reader.releaseLock();
  }
}
