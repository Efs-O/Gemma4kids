import { useState, useCallback, useRef, startTransition, type MutableRefObject } from 'react';
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
import { SIMPLE_VIDEO_UNDERSTANDING_CONTEXT, VIDEO_EXPORT_TOOL_CONTEXT } from '../videoPromptNotes';
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

export type SendMessageInput =
  | string
  | { text: string; images?: string[]; videos?: string[]; hasAttachment?: boolean; contextNote?: string };

function stripHeavyMultimodalForUi(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || (!message.images?.length && !message.videos?.length)) {
      return message;
    }
    const { images: _images, videos: _videos, ...rest } = message;
    return rest;
  });
}

function isEditIntent(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.startsWith('[context:')) return true;
  return [
    'fix', 'bug', 'broken', 'check', 'review', 'debug', 'read', 'update',
    'change', 'edit', 'continue', 'improve', 'make it', 'add more',
    'faster', 'slower', 'color', 'bigger', 'smaller', 'wrong',
  ].some((term) => lower.includes(term));
}

function isCodeCreationIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'animation',
    'animate',
    'game',
    'html',
    'code',
    'canvas',
    'css',
    'javascript',
    'js',
    'web page',
    'webpage',
    'editor',
    'open in browser',
  ].some((term) => lower.includes(term));
}

function isVideoFrameExportIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'save frame',
    'save frames',
    'save some frames',
    'save a few frames',
    'export frame',
    'export frames',
    'grab frame',
    'grab frames',
    'pick frame',
    'pick frames',
    'capture frame',
    'capture frames',
    'video frame',
    'video frames',
    'still frame',
    'still frames',
    'snapshot',
    'snapshots',
  ].some((term) => lower.includes(term));
}

function isVideoUnderstandingIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'what is happening',
    "what's happening",
    'what happens',
    'what is this video about',
    "what's this video about",
    'what this video is about',
    'what is in this video',
    "what's in this video",
    'what does this video show',
    'describe this video',
    'describe the video',
    'summarize this video',
    'summarise this video',
    'about this video',
    'tell me about this video',
    'what do you see',
    'who is in the video',
    'what color',
    'what colour',
    'is it',
    'are they',
  ].some((term) => lower.includes(term));
}

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
  sendMessage: (input: SendMessageInput) => void;
  cancel: () => void;
  retry: () => void;
  clearContext: () => void;
  injectContext: (text: string) => void;
}

export function useChat(
  runtimeAdapter: LLMRuntimeAdapter,
  model: string,
  thinkEnabled: boolean,
  thinkingAvailable: boolean,
  onThinkingUnsupported: (modelName: string) => void,
  modelTier: ModelTier = 'full',
  runtimeLimits?: { numCtx?: number; numPredict?: number },
  videoAttachmentFileRef?: MutableRefObject<File | null>,
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
  const streamFrameRef = useRef<number | null>(null);
  const pendingStreamingTextRef = useRef('');
  const pendingStreamingThinkingRef = useRef('');
  const pendingLatestCodeRef = useRef<string | null>(null);

  const cancelPendingStreamFrame = useCallback(() => {
    if (streamFrameRef.current != null) {
      cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
  }, []);

  const flushPendingStreamUi = useCallback(() => {
    streamFrameRef.current = null;
    const nextText = pendingStreamingTextRef.current;
    const nextThinking = pendingStreamingThinkingRef.current;
    const nextCode = pendingLatestCodeRef.current;
    startTransition(() => {
      setStreamingText(nextText);
      setStreamingThinking(nextThinking);
      if (nextCode) {
        setLatestCode(nextCode);
      }
    });
  }, []);

  const scheduleStreamUiFlush = useCallback(() => {
    if (streamFrameRef.current != null) return;
    streamFrameRef.current = requestAnimationFrame(() => {
      flushPendingStreamUi();
    });
  }, [flushPendingStreamUi]);

  const resetPendingStreamUi = useCallback(() => {
    cancelPendingStreamFrame();
    pendingStreamingTextRef.current = '';
    pendingStreamingThinkingRef.current = '';
    pendingLatestCodeRef.current = null;
  }, [cancelPendingStreamFrame]);

  function normalizeMessageInput(input: SendMessageInput): {
    text: string;
    images?: string[];
    videos?: string[];
    hasAttachment: boolean;
    contextNote?: string;
  } {
    if (typeof input === 'string') return { text: input, hasAttachment: false };
    return {
      text: input.text,
      images: input.images?.filter((image) => image.trim().length > 0),
      videos: input.videos?.filter((video) => video.trim().length > 0),
      hasAttachment: input.hasAttachment === true,
      contextNote: input.contextNote?.trim() || undefined,
    };
  }

  const runLoop = useCallback(async (startHistory: ChatMessage[], token: CancellationToken) => {
    const myClearId = clearIdRef.current;
    let history = startHistory;
    const workstationLarge = isGemma426b(model) || isGemma431b(model);
    let effectiveThinkEnabled = thinkEnabled && thinkingAvailable;
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
        setMessages(stripHeavyMultimodalForUi(history));
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
      let loopError: unknown = null;

      await new Promise<void>((resolve) => {
        runtimeAdapter.streamChat(
          {
            model,
            messages: buildRequestMessages(history, modelTier, simpleMode),
            think: effectiveThinkEnabled,
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
              pendingStreamingTextRef.current = assembled;
              const partial = extractPartialHtml(assembled);
              if (partial) pendingLatestCodeRef.current = partial;
              scheduleStreamUiFlush();
            },
            onThinkingToken: (t) => {
              thinking += t;
              pendingStreamingThinkingRef.current = thinking;
              scheduleStreamUiFlush();
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
        flushPendingStreamUi();
        if (clearIdRef.current === myClearId && (assembled || thinking)) {
          const msg: ChatMessage = {
            role: 'assistant',
            content: assembled || null,
            thinking: thinking || null,
          };
          history = [...history, msg];
          historyRef.current = history;
          setMessages(stripHeavyMultimodalForUi(history));
        }
        resetPendingStreamUi();
        setStreamingText('');
        setStreamingThinking('');
        setStatus('idle');
        return;
      }

      if (loopError) {
        flushPendingStreamUi();
        const normalizedError = loopError instanceof Error ? loopError : new Error(String(loopError));
        const errorMessage = normalizedError.message;
        const shouldRetryWithoutThinking =
          effectiveThinkEnabled &&
          /HTTP 500:/i.test(errorMessage) &&
          /unable to load model/i.test(errorMessage);

        if (shouldRetryWithoutThinking) {
          onThinkingUnsupported(model);
          effectiveThinkEnabled = false;
          setStreamingText('');
          setStreamingThinking('');
          continue;
        }

        setStatus('error');
        setErrorMsg(formatRuntimeError(normalizedError, model));
        resetPendingStreamUi();
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
        flushPendingStreamUi();
        const calls = firedToolCalls;
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: assembled || null,
          thinking: thinking || null,
          tool_calls: calls,
        };
        history = [...history, assistantMsg];
        historyRef.current = history;
        setMessages(stripHeavyMultimodalForUi(history));
        resetPendingStreamUi();
        setStreamingText('');
        setStreamingThinking('');

        for (const call of calls) {
          const result = await executeToolCall(call, {
            setLastAudit,
            setLatestCode,
            setLastSaved,
            getAttachedVideoFile: () => videoAttachmentFileRef?.current ?? null,
          });

          const toolMsg: ChatMessage = {
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: call.id,
            name: call.function.name,
          };
          history = [...history, toolMsg];
          historyRef.current = history;
          setMessages(stripHeavyMultimodalForUi(history));
        }

        if (assembled.trim()) {
          resetPendingStreamUi();
          setStreamingText('');
          setStreamingThinking('');
          setStatus('idle');
          return;
        }
        if (token.signal.aborted) {
          resetPendingStreamUi();
          setStreamingText('');
          setStreamingThinking('');
          setStatus('idle');
          return;
        }
        continue;
      }

      let finalContent = assembled || null;
      flushPendingStreamUi();
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
      setMessages(stripHeavyMultimodalForUi(history));
      resetPendingStreamUi();
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
  }, [flushPendingStreamUi, model, onThinkingUnsupported, resetPendingStreamUi, scheduleStreamUiFlush, thinkEnabled, thinkingAvailable, modelTier, runtimeAdapter, runtimeLimits?.numCtx, runtimeLimits?.numPredict, videoAttachmentFileRef]);

  const sendMessage = useCallback((input: SendMessageInput) => {
    const { text, images, videos, hasAttachment, contextNote } = normalizeMessageInput(input);
    console.info('[chat:user-message]', {
      model,
      tier: modelTier,
      lang: detectLang(text),
      inputKind: hasAttachment ? 'multimodal' : 'text',
      textPreview: previewText(text),
    });
    if (modelTier === 'simple' && !hasAttachment && !images?.length && !videos?.length && isSimpleMotionKeyword(text)) {
      const userMsg: ChatMessage = { role: 'user', content: text, images, videos };
      const sisterMsg: ChatMessage = { role: 'assistant', content: SISTER_MESSAGE[detectLang(text)] };
      const updated = [...historyRef.current, userMsg, sisterMsg];
      historyRef.current = updated;
      setMessages(stripHeavyMultimodalForUi(updated));
      return;
    }

    const token = new CancellationToken();
    cancelRef.current = token;
    resetPendingStreamUi();
    setStatus('streaming');
    setErrorMsg('');
    setStreamingText('');
    setStreamingThinking('');
    setLatestCode(null);

    const userMsg: ChatMessage = { role: 'user', content: text, images, videos };
    const contextMessages: ChatMessage[] = [];
    if (contextNote) {
      contextMessages.push({ role: 'user', content: `[Context: ${contextNote}]` });
    }
    if (
      videos?.length &&
      isVideoFrameExportIntent(text) &&
      !isCodeCreationIntent(text) &&
      !isEditIntent(text)
    ) {
      contextMessages.push({ role: 'user', content: `[Context: ${VIDEO_EXPORT_TOOL_CONTEXT}]` });
    }
    if (
      modelTier === 'simple' &&
      videos?.length &&
      isVideoUnderstandingIntent(text) &&
      !isVideoFrameExportIntent(text) &&
      !isCodeCreationIntent(text) &&
      !isEditIntent(text)
    ) {
      contextMessages.push({ role: 'user', content: `[Context: ${SIMPLE_VIDEO_UNDERSTANDING_CONTEXT}]` });
    }
    const updated = [...historyRef.current, userMsg, ...contextMessages];
    historyRef.current = updated;
    setMessages(stripHeavyMultimodalForUi(updated));
    void runLoop(updated, token);
  }, [model, modelTier, resetPendingStreamUi, runLoop, videoAttachmentFileRef]);

  const cancel = useCallback(() => {
    cancelRef.current?.cancel();
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  const retry = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const token = new CancellationToken();
    cancelRef.current = token;
    resetPendingStreamUi();
    setStatus('streaming');
    setErrorMsg('');
    setStreamingText('');
    setStreamingThinking('');
    void runLoop(historyRef.current, token);
  }, [resetPendingStreamUi, runLoop]);

  const clearContext = useCallback(() => {
    ++clearIdRef.current;
    cancelRef.current?.cancel();
    resetPendingStreamUi();
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
    setMessages(stripHeavyMultimodalForUi(updated));
  }, []);

  return { messages, streamingText, streamingThinking, latestCode, lastSaved, lastAudit, status, errorMsg, ctxUsedPct, sendMessage, cancel, retry, clearContext, injectContext };
}
