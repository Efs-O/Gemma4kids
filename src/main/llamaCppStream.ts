import { randomUUID } from 'crypto';
import {
  appendLlamaRuntimeLog,
  broadcastToWindows,
  getLlamaRuntimeLogPath,
  summarizeChatRequest,
} from './llamaCppUtils';

/**
 * Splits a streaming content string into content vs thinking segments by
 * detecting <think>...</think> tags across chunk boundaries.
 * Used when llama-server emits thinking inline in delta.content instead of
 * delta.reasoning_content (Gemma 4 behaviour on most llama.cpp builds).
 */
function makeThinkTagSplitter(
  emitToken: (t: string) => void,
  emitThinking: (t: string) => void,
): { push: (raw: string) => void; flush: () => void } {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inThink = false;
  let held = '';

  function longestPrefixSuffix(text: string, tag: string): string {
    for (let len = Math.min(text.length, tag.length - 1); len > 0; len--) {
      if (text.endsWith(tag.slice(0, len))) return text.slice(text.length - len);
    }
    return '';
  }

  function emit(s: string): void { inThink ? emitThinking(s) : emitToken(s); }

  function push(raw: string): void {
    let text = held + raw;
    held = '';
    while (text.length > 0) {
      const tag = inThink ? CLOSE : OPEN;
      const idx = text.indexOf(tag);
      if (idx === -1) {
        const partial = longestPrefixSuffix(text, tag);
        if (text.length > partial.length) emit(text.slice(0, text.length - partial.length));
        held = partial;
        return;
      }
      if (idx > 0) emit(text.slice(0, idx));
      inThink = !inThink;
      text = text.slice(idx + tag.length);
    }
  }

  function flush(): void {
    if (held) { emit(held); held = ''; }
  }

  return { push, flush };
}

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
  promptTokens?: number;
  evalTokens?: number;
}

export async function streamLlamaChat(
  requestId: string,
  config: LlamaCppConfig,
  request: Record<string, unknown>,
  abortControllers: Map<string, AbortController>,
  getServerLogPath: () => string | null,
): Promise<{ success: boolean; error?: string }> {
  const controller = new AbortController();
  abortControllers.set(requestId, controller);
  const logPath = getServerLogPath() ?? getLlamaRuntimeLogPath();
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
      abortControllers.delete(requestId);
      broadcastToWindows('llama-cpp-stream-event', {
        requestId,
        type: 'error',
        error: `HTTP ${response.status}: ${body}`,
      } satisfies LlamaStreamEvent);
      return { success: true };
    }

    if (!response.body) {
      abortControllers.delete(requestId);
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
    let promptTokens = 0;
    let evalTokens = 0;
    let storedFinishReason: string | null = null;

    const thinkSplitter = makeThinkTagSplitter(
      (t) => {
        tokenCount += 1;
        if (tokenCount === 1) appendLlamaRuntimeLog(logPath, `[stream:first-token] requestId=${requestId} token=${JSON.stringify(t.slice(0, 120))}`);
        broadcastToWindows('llama-cpp-stream-event', { requestId, type: 'token', token: t } satisfies LlamaStreamEvent);
      },
      (t) => {
        thinkingCount += 1;
        broadcastToWindows('llama-cpp-stream-event', { requestId, type: 'thinking', thinking: t } satisfies LlamaStreamEvent);
      },
    );

    const emitDone = (finishReason: string | null) => {
      thinkSplitter.flush();
      appendLlamaRuntimeLog(
        logPath,
        `[stream:done] requestId=${requestId} finish_reason=${String(finishReason)} tokens=${String(tokenCount)} thinking_chunks=${String(thinkingCount)} tool_calls=${String(toolAccum.size)} prompt_tokens=${String(promptTokens)} eval_tokens=${String(evalTokens)}`,
      );
      broadcastToWindows('llama-cpp-stream-event', {
        requestId,
        type: 'done',
        finishReason,
        promptTokens,
        evalTokens,
      } satisfies LlamaStreamEvent);
    };

    const emitToolCalls = () => {
      if (toolAccum.size === 0) return;
      const toolCalls: OpenAiToolCall[] = [...toolAccum.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => ({
          id: acc.id || randomUUID(),
          type: 'function',
          function: { name: acc.name, arguments: acc.arguments },
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
            emitDone(storedFinishReason);
            abortControllers.delete(requestId);
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
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          try {
            chunk = JSON.parse(payload) as typeof chunk;
          } catch {
            continue;
          }

          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
            evalTokens = chunk.usage.completion_tokens ?? evalTokens;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          const content = choice.delta?.content;
          if (content) thinkSplitter.push(content);

          const reasoning = choice.delta?.reasoning_content;
          if (reasoning) {
            thinkingCount += 1;
            broadcastToWindows('llama-cpp-stream-event', { requestId, type: 'thinking', thinking: reasoning } satisfies LlamaStreamEvent);
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
            storedFinishReason = choice.finish_reason;
            if (choice.finish_reason === 'tool_calls') {
              emitToolCalls();
            }
            // Don't return yet — llama-server sends a usage chunk after finish_reason, before [DONE].
          }
        }
      }

      emitDone(storedFinishReason);
      abortControllers.delete(requestId);
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
      abortControllers.delete(requestId);
      return { success: true };
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    abortControllers.delete(requestId);
    appendLlamaRuntimeLog(
      logPath,
      `[stream:startup-error] requestId=${requestId} message=${error instanceof Error ? error.message : String(error)}`,
    );
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
