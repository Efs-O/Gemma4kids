import { useState, useCallback, useRef } from 'react';
import { streamOllamaNativeChat } from '../llm/ollamaNativeChat';
import { CancellationToken } from '../llm/cancellation';
import type { ChatMessage, ToolCall } from '../llm/types';
import { KIDS_TOOLS } from '../tools';
import { SYSTEM_PROMPT } from '../prompts';
import { OLLAMA_CHAT_PROFILE } from '../ollamaConstants';
import { auditHtml } from '../htmlAudit';

const OLLAMA_BASE = 'http://localhost:11434';
const INLINE_TOOL_QUOTE = '<|"|>';

function extractHtml(text: string): string | null {
  const match = text.match(/```(?:html)?\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

/** Extracts partial HTML as it streams — no closing fence required. */
function extractPartialHtml(text: string): string | null {
  const start = text.indexOf('<!DOCTYPE html>');
  if (start === -1) return null;
  let html = text.slice(start);
  // Strip trailing fence if the block has closed
  const fence = html.lastIndexOf('\n```');
  if (fence !== -1) html = html.slice(0, fence);
  return html.trim() || null;
}

/** Keep system + last 24 non-system messages to avoid context blowout. */
function buildRequestMessages(history: ChatMessage[]): ChatMessage[] {
  const nonSystem = history.filter(m => m.role !== 'system');
  const kept = nonSystem.length > 24 ? nonSystem.slice(-24) : nonSystem;
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...kept];
}

function parseInlineExecuteTool(text: string): ToolCall[] | null {
  const execIdx = text.indexOf('<execute_tool>');
  if (execIdx === -1) return null;

  const toolCallEnd = text.indexOf('<tool_call|>', execIdx);
  const raw = (toolCallEnd === -1 ? text.slice(execIdx) : text.slice(execIdx, toolCallEnd)).trim();
  const nameMatch = raw.match(/<execute_tool>\s*([a-z_][a-z0-9_]*)\s*\{/i);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  const argsStart = raw.indexOf('{', nameMatch.index);
  const argsEnd = raw.lastIndexOf('}');
  if (argsStart === -1 || argsEnd === -1 || argsEnd <= argsStart) return null;

  const body = raw.slice(argsStart + 1, argsEnd);
  const args: Record<string, string> = {};
  let cursor = 0;

  while (cursor < body.length) {
    while (cursor < body.length && /[\s,]/.test(body[cursor])) cursor++;
    if (cursor >= body.length) break;

    const keyMatch = body.slice(cursor).match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (!keyMatch) break;
    const key = keyMatch[1];
    cursor += keyMatch[0].length;

    if (!body.startsWith(INLINE_TOOL_QUOTE, cursor)) return null;
    cursor += INLINE_TOOL_QUOTE.length;

    const nextMarker = `${INLINE_TOOL_QUOTE},`;
    const nextField = body.indexOf(nextMarker, cursor);
    const valueEnd = nextField === -1 ? body.indexOf(INLINE_TOOL_QUOTE, cursor) : nextField;
    if (valueEnd === -1) return null;

    args[key] = body.slice(cursor, valueEnd);

    if (nextField === -1) {
      cursor = valueEnd + INLINE_TOOL_QUOTE.length;
      break;
    }

    cursor = nextField + 1;
  }

  if (Object.keys(args).length === 0) return null;

  return [{
    id: `inline_${name}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  }];
}

export interface UseChatResult {
  messages: ChatMessage[];
  streamingText: string;
  streamingThinking: string;
  latestCode: string | null;
  lastSaved: string | null;
  status: 'idle' | 'streaming' | 'error';
  errorMsg: string;
  sendMessage: (text: string) => void;
  cancel: () => void;
  retry: () => void;
}

export function useChat(model: string, thinkEnabled: boolean): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Canonical message history — updated synchronously, avoids stale closure in runLoop.
  const historyRef = useRef<ChatMessage[]>([]);
  const cancelRef = useRef<CancellationToken | null>(null);

  const runLoop = useCallback(async (startHistory: ChatMessage[], token: CancellationToken) => {
    let history = startHistory;

    while (true) {
      let assembled = '';
      let thinking = '';
      let firedToolCalls: ToolCall[] | null = null;
      let loopError: Error | null = null;

      await new Promise<void>((resolve) => {
        streamOllamaNativeChat(
          OLLAMA_BASE,
          {
            model,
            messages: buildRequestMessages(history),
            think: thinkEnabled,
            temperature: OLLAMA_CHAT_PROFILE.temperature,
            topP: OLLAMA_CHAT_PROFILE.topP,
            topK: OLLAMA_CHAT_PROFILE.topK,
            tools: KIDS_TOOLS,
            numCtx: OLLAMA_CHAT_PROFILE.numCtx,
            numPredict: OLLAMA_CHAT_PROFILE.numPredict,
          },
          {
            onToken: (t) => {
              assembled += t;
              setStreamingText(assembled);
              const partial = extractPartialHtml(assembled);
              if (partial) setLatestCode(partial);
            },
            onThinkingToken: (t) => {
              thinking += t;
              setStreamingThinking(thinking);
            },
            onToolCalls: (calls) => { firedToolCalls = calls; },
            onDone: () => resolve(),
            onError: (err) => { loopError = err; resolve(); },
          },
          token.signal,
        );
      });

      if (token.signal.aborted) {
        if (assembled || thinking) {
          const msg: ChatMessage = {
            role: 'assistant',
            content: assembled || null,
            thinking: thinking || null,
          };
          history = [...history, msg];
          historyRef.current = history;
          setMessages([...history]);
        }
        setStreamingText('');
        setStreamingThinking('');
        setStatus('idle');
        return;
      }

      if (loopError) {
        setStatus('error');
        setErrorMsg((loopError as Error).message);
        setStreamingText('');
        setStreamingThinking('');
        return;
      }

      if (!firedToolCalls) {
        const inlineCalls = parseInlineExecuteTool(assembled);
        if (inlineCalls) {
          firedToolCalls = inlineCalls;
          assembled = '';
        }
      }

      if (firedToolCalls) {
        const calls = firedToolCalls as ToolCall[];

        // Append the assistant tool_calls turn — preserve any streamed explanation text.
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: assembled || null,
          thinking: thinking || null,
          tool_calls: calls,
        };
        history = [...history, assistantMsg];
        historyRef.current = history;
        setMessages([...history]);
        setStreamingText('');
        setStreamingThinking('');

        // Dispatch each tool call and append the tool result.
        for (const call of calls) {
          let result: unknown;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are dynamic by design
            const args = JSON.parse(call.function.arguments) as Record<string, any>;

            switch (call.function.name) {
              case 'save_animation': {
                const audited = auditHtml(args.html_content as string);
                if (audited.fixes.length > 0) {
                  console.info('[htmlAudit] save_animation fixes:', audited.fixes);
                }
                const res = await window.electronAPI.saveAnimation(
                  args.filename as string,
                  audited.html,
                );
                result = res;
                if (res.success) {
                  setLatestCode(audited.html);
                  setLastSaved(res.filename);
                }
                break;
              }
              case 'read_animation':
                result = await window.electronAPI.readAnimation(args.filename as string);
                break;
              case 'list_animations':
                result = await window.electronAPI.listAnimations();
                break;
              case 'open_in_browser':
                result = await window.electronAPI.openInBrowser(args.filename as string);
                break;
              default:
                result = { error: `Unknown tool: ${call.function.name}` };
            }
          } catch (e) {
            result = { error: String(e) };
          }

          const toolMsg: ChatMessage = {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: call.id,
            name: call.function.name,
          };
          history = [...history, toolMsg];
          historyRef.current = history;
          setMessages([...history]);
        }

        // If Gemma already wrote text before the tool call, that IS the response — no follow-up needed.
        if (assembled.trim()) {
          setStreamingText('');
          setStreamingThinking('');
          setStatus('idle');
          return;
        }
        // No text yet — re-enter so Gemma can confirm the action.
        continue;
      }

      // Plain text final response — loop ends.
      const finalMsg: ChatMessage = {
        role: 'assistant',
        content: assembled || null,
        thinking: thinking || null,
      };
      history = [...history, finalMsg];
      historyRef.current = history;
      setMessages([...history]);
      setStreamingText('');
      setStreamingThinking('');

      const extracted = extractHtml(assembled);
      if (extracted) {
        const audited = auditHtml(extracted);
        if (audited.fixes.length > 0) {
          console.info('[htmlAudit] post-stream fixes:', audited.fixes);
        }
        setLatestCode(audited.html);
      }

      setStatus('idle');
      return;
    }
  }, [model, thinkEnabled]);

  const sendMessage = useCallback((text: string) => {
    const token = new CancellationToken();
    cancelRef.current = token;
    setStatus('streaming');
    setErrorMsg('');
    setStreamingText('');
    setStreamingThinking('');

    const userMsg: ChatMessage = { role: 'user', content: text };
    const updated = [...historyRef.current, userMsg];
    historyRef.current = updated;
    setMessages(updated);
    runLoop(updated, token);
  }, [runLoop]);

  const cancel = useCallback(() => {
    cancelRef.current?.cancel();
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  const retry = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const token = new CancellationToken();
    cancelRef.current = token;
    setStatus('streaming');
    setErrorMsg('');
    setStreamingText('');
    setStreamingThinking('');
    runLoop(historyRef.current, token);
  }, [runLoop]);

  return { messages, streamingText, streamingThinking, latestCode, lastSaved, status, errorMsg, sendMessage, cancel, retry };
}
