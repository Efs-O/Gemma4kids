import { useState, useCallback, useRef } from 'react';
import { streamChatCompletion } from '../llm/OpenAIClient';
import { CancellationToken } from '../llm/cancellation';
import type { ChatMessage, ToolCall } from '../llm/types';
import { KIDS_TOOLS } from '../tools';
import { SYSTEM_PROMPT } from '../prompts';

const OLLAMA_BASE = 'http://localhost:11434';

function extractHtml(text: string): string | null {
  const match = text.match(/```(?:html)?\n([\s\S]*?)```/i);
  return match ? match[1].trim() : null;
}

/** Keep system + last 24 non-system messages to avoid context blowout. */
function buildRequestMessages(history: ChatMessage[]): ChatMessage[] {
  const nonSystem = history.filter(m => m.role !== 'system');
  const kept = nonSystem.length > 24 ? nonSystem.slice(-24) : nonSystem;
  return [{ role: 'system', content: SYSTEM_PROMPT }, ...kept];
}

export interface UseChatResult {
  messages: ChatMessage[];
  streamingText: string;
  latestCode: string | null;
  lastSaved: string | null;
  status: 'idle' | 'streaming' | 'error';
  errorMsg: string;
  sendMessage: (text: string) => void;
  cancel: () => void;
  retry: () => void;
}

export function useChat(model: string): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
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
      let firedToolCalls: ToolCall[] | null = null;
      let loopError: Error | null = null;

      await new Promise<void>((resolve) => {
        streamChatCompletion(
          OLLAMA_BASE,
          { model, messages: buildRequestMessages(history), stream: true, temperature: 0.7, tools: KIDS_TOOLS },
          {
            onToken: (t) => { assembled += t; setStreamingText(assembled); },
            onToolCalls: (calls) => { firedToolCalls = calls; },
            onDone: () => resolve(),
            onError: (err) => { loopError = err; resolve(); },
          },
          token.signal,
        );
      });

      if (token.signal.aborted) {
        if (assembled) {
          const msg: ChatMessage = { role: 'assistant', content: assembled };
          history = [...history, msg];
          historyRef.current = history;
          setMessages([...history]);
        }
        setStreamingText('');
        setStatus('idle');
        return;
      }

      if (loopError) {
        setStatus('error');
        setErrorMsg((loopError as Error).message);
        setStreamingText('');
        return;
      }

      if (firedToolCalls) {
        const calls = firedToolCalls as ToolCall[];

        // Append the assistant tool_calls turn (no text content).
        const assistantMsg: ChatMessage = { role: 'assistant', content: null, tool_calls: calls };
        history = [...history, assistantMsg];
        historyRef.current = history;
        setMessages([...history]);
        setStreamingText('');

        // Dispatch each tool call and append the tool result.
        for (const call of calls) {
          let result: unknown;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are dynamic by design
            const args = JSON.parse(call.function.arguments) as Record<string, any>;

            switch (call.function.name) {
              case 'save_animation': {
                const res = await window.electronAPI.saveAnimation(
                  args.filename as string,
                  args.html_content as string,
                );
                result = res;
                if (res.success) {
                  setLatestCode(args.html_content as string);
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

        // Re-enter the loop — Gemma generates its follow-up text.
        continue;
      }

      // Plain text final response — loop ends.
      const finalMsg: ChatMessage = { role: 'assistant', content: assembled };
      history = [...history, finalMsg];
      historyRef.current = history;
      setMessages([...history]);
      setStreamingText('');

      const extracted = extractHtml(assembled);
      if (extracted) setLatestCode(extracted);

      setStatus('idle');
      return;
    }
  }, [model]);

  const sendMessage = useCallback((text: string) => {
    const token = new CancellationToken();
    cancelRef.current = token;
    setStatus('streaming');
    setErrorMsg('');

    const userMsg: ChatMessage = { role: 'user', content: text };
    const updated = [...historyRef.current, userMsg];
    historyRef.current = updated;
    setMessages(updated);
    runLoop(updated, token);
  }, [runLoop]);

  const cancel = useCallback(() => {
    cancelRef.current?.cancel();
  }, []);

  const retry = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const token = new CancellationToken();
    cancelRef.current = token;
    setStatus('streaming');
    setErrorMsg('');
    runLoop(historyRef.current, token);
  }, [runLoop]);

  return { messages, streamingText, latestCode, lastSaved, status, errorMsg, sendMessage, cancel, retry };
}
