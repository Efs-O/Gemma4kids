import { useState, useCallback, useRef } from 'react';
import { CancellationToken } from '../llm/cancellation';
import type { ChatMessage, ToolCall } from '../llm/types';
import { KIDS_TOOLS } from '../tools';
import { SISTER_MESSAGE } from '../prompts';
import type { ModelTier } from '../utils/pickCodingModel';
import type { LLMRuntimeAdapter } from '../services/OllamaService';
import {
  OLLAMA_CHAT_PROFILE,
  OLLAMA_CHAT_WORKSTATION_CTX,
  OLLAMA_CHAT_WORKSTATION_PREDICT,
} from '../ollamaConstants';
import { auditHtml } from '../htmlAudit';
import { isGemma426b, isGemma431b } from '../utils/pickCodingModel';
import {
  buildRequestMessages,
  classifySimpleMode,
  detectLang,
  extractHtml,
  extractPartialHtml,
  formatRuntimeError,
  getLatestUserText,
  isSimpleMotionKeyword,
  previewText,
  type SimpleMode,
} from '../chatRouting';
import { executeToolCall, parseInlineExecuteTool, type AuditSummary } from '../chatTools';

export type { AuditSummary } from '../chatTools';

export interface UseChatResult {
  messages: ChatMessage[];
  streamingText: string;
  streamingThinking: string;
  latestCode: string | null;
  lastSaved: string | null;
  lastAudit: AuditSummary | null;
  status: 'idle' | 'streaming' | 'error';
  errorMsg: string;
  ctxUsedPct: number;
  sendMessage: (input: string | { text: string; images?: string[] }) => void;
  cancel: () => void;
  retry: () => void;
  clearContext: () => void;
  injectContext: (text: string) => void;
}

export function useChat(
  runtimeAdapter: LLMRuntimeAdapter,
  model: string,
  thinkEnabled: boolean,
  modelTier: ModelTier = 'full',
  runtimeLimits?: { numCtx?: number; numPredict?: number },
): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [latestCode, setLatestCode] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [lastAudit, setLastAudit] = useState<AuditSummary | null>(null);
  const [status, setStatus] = useState<'idle' | 'streaming' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [ctxUsedPct, setCtxUsedPct] = useState(0);

  const historyRef = useRef<ChatMessage[]>([]);
  const cancelRef = useRef<CancellationToken | null>(null);
  const clearIdRef = useRef(0);

  function normalizeMessageInput(input: string | { text: string; images?: string[] }): { text: string; images?: string[] } {
    if (typeof input === 'string') return { text: input };
    return {
      text: input.text,
      images: input.images?.filter((image) => image.trim().length > 0),
    };
  }

  const runLoop = useCallback(async (startHistory: ChatMessage[], token: CancellationToken) => {
    const myClearId = clearIdRef.current;
    let history = startHistory;
    const workstationLarge = isGemma426b(model) || isGemma431b(model);
    const defaultNumCtx = workstationLarge ? OLLAMA_CHAT_WORKSTATION_CTX : OLLAMA_CHAT_PROFILE.numCtx;
    const defaultNumPredict = workstationLarge ? OLLAMA_CHAT_WORKSTATION_PREDICT : OLLAMA_CHAT_PROFILE.numPredict;
    const numCtx = runtimeLimits?.numCtx ?? defaultNumCtx;
    const numPredict = runtimeLimits?.numPredict ?? defaultNumPredict;
    const latestUserText = getLatestUserText(history);
    let simpleMode: SimpleMode | null = null;

    if (modelTier === 'simple') {
      simpleMode = await classifySimpleMode(runtimeAdapter, model, latestUserText, token.signal);
      if (token.signal.aborted) {
        setStreamingText('');
        setStreamingThinking('');
        setStatus('idle');
        return;
      }
      console.info('[chat:route]', {
        model,
        tier: modelTier,
        lang: detectLang(latestUserText),
        simpleMode,
        toolExposure: simpleMode === 'chat' ? 'off' : 'on',
        textPreview: previewText(latestUserText),
      });
      if (simpleMode === 'motion') {
        const msg: ChatMessage = {
          role: 'assistant',
          content: SISTER_MESSAGE[detectLang(latestUserText)],
        };
        history = [...history, msg];
        historyRef.current = history;
        setMessages([...history]);
        setStreamingText('');
        setStreamingThinking('');
        setStatus('idle');
        return;
      }
    }

    while (true) {
      if (token.signal.aborted) {
        setStreamingText('');
        setStreamingThinking('');
        setStatus('idle');
        return;
      }

      let assembled = '';
      let thinking = '';
      let firedToolCalls: ToolCall[] | null = null;
      let loopError: Error | null = null;

      await new Promise<void>((resolve) => {
        runtimeAdapter.streamChat(
          {
            model,
            messages: buildRequestMessages(history, modelTier, simpleMode),
            think: thinkEnabled,
            temperature: OLLAMA_CHAT_PROFILE.temperature,
            topP: OLLAMA_CHAT_PROFILE.topP,
            topK: OLLAMA_CHAT_PROFILE.topK,
            tools: simpleMode === 'chat' ? undefined : KIDS_TOOLS,
            numCtx,
            numPredict,
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
          (promptTokens, evalTokens) => {
            if (clearIdRef.current !== myClearId) return;
            const used = promptTokens + evalTokens;
            setCtxUsedPct(Math.min(100, Math.round((used / numCtx) * 10) * 10));
          },
        );
      });

      if (token.signal.aborted) {
        if (clearIdRef.current === myClearId && (assembled || thinking)) {
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
        setErrorMsg(formatRuntimeError(loopError, model));
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
        const calls = firedToolCalls;
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

        for (const call of calls) {
          const result = await executeToolCall(call, {
            setLastAudit,
            setLatestCode,
            setLastSaved,
          });

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

        if (assembled.trim()) {
          setStreamingText('');
          setStreamingThinking('');
          setStatus('idle');
          return;
        }
        if (token.signal.aborted) {
          setStreamingText('');
          setStreamingThinking('');
          setStatus('idle');
          return;
        }
        continue;
      }

      let finalContent = assembled || null;
      if (modelTier === 'simple' && assembled.trim() === '__TOOBIG__') {
        finalContent = SISTER_MESSAGE[detectLang(getLatestUserText(history))];
      }
      const finalMsg: ChatMessage = {
        role: 'assistant',
        content: finalContent,
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
        setLastAudit({ fixes: audited.fixes, visualWarnings: audited.visualWarnings });
        if (audited.fixes.length > 0) {
          console.info('[htmlAudit] post-stream fixes:', audited.fixes);
        }
        setLatestCode(audited.html);
      }

      setStatus('idle');
      return;
    }
  }, [model, thinkEnabled, modelTier, runtimeAdapter, runtimeLimits?.numCtx, runtimeLimits?.numPredict]);

  const sendMessage = useCallback((input: string | { text: string; images?: string[] }) => {
    if (ctxUsedPct >= 90) {
      return;
    }
    const { text, images } = normalizeMessageInput(input);
    console.info('[chat:user-message]', {
      model,
      tier: modelTier,
      lang: detectLang(text),
      inputKind: Array.isArray(images) && images.length > 0 ? 'multimodal' : 'text',
      textPreview: previewText(text),
    });
    if (modelTier === 'simple' && isSimpleMotionKeyword(text)) {
      const userMsg: ChatMessage = { role: 'user', content: text, images };
      const sisterMsg: ChatMessage = { role: 'assistant', content: SISTER_MESSAGE[detectLang(text)] };
      const updated = [...historyRef.current, userMsg, sisterMsg];
      historyRef.current = updated;
      setMessages(updated);
      return;
    }

    const token = new CancellationToken();
    cancelRef.current = token;
    setStatus('streaming');
    setErrorMsg('');
    setStreamingText('');
    setStreamingThinking('');
    setLatestCode(null);

    const userMsg: ChatMessage = { role: 'user', content: text, images };
    const updated = [...historyRef.current, userMsg];
    historyRef.current = updated;
    setMessages(updated);
    void runLoop(updated, token);
  }, [ctxUsedPct, model, modelTier, runLoop]);

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
    void runLoop(historyRef.current, token);
  }, [runLoop]);

  const clearContext = useCallback(() => {
    ++clearIdRef.current;
    cancelRef.current?.cancel();
    historyRef.current = [];
    setMessages([]);
    setStreamingText('');
    setStreamingThinking('');
    setLatestCode(null);
    setLastSaved(null);
    setLastAudit(null);
    setCtxUsedPct(0);
    setStatus('idle');
    setErrorMsg('');
  }, []);

  const injectContext = useCallback((text: string) => {
    const filtered = historyRef.current.filter(
      (m) => !(m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[Context:')),
    );
    const msg: ChatMessage = { role: 'user', content: text };
    const updated = [...filtered, msg];
    historyRef.current = updated;
    setMessages(updated);
  }, []);

  return { messages, streamingText, streamingThinking, latestCode, lastSaved, lastAudit, status, errorMsg, ctxUsedPct, sendMessage, cancel, retry, clearContext, injectContext };
}
