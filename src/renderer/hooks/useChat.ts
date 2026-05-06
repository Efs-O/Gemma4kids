import { useState, useCallback, useRef } from 'react';
import { CancellationToken } from '../llm/cancellation';
import type { ChatMessage, ToolCall } from '../llm/types';
import { KIDS_TOOLS } from '../tools';
import {
  CREATE_SYSTEM_PROMPT,
  EDIT_SYSTEM_PROMPT,
  KID_CHAT_SYSTEM_PROMPT,
  SIMPLE_INTENT_CLASSIFIER_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
  SISTER_MESSAGE,
} from '../prompts';
import type { ModelTier } from '../utils/pickCodingModel';
import type { LLMRuntimeAdapter } from '../services/OllamaService';
import {
  OLLAMA_CHAT_PROFILE,
  OLLAMA_CHAT_WORKSTATION_CTX,
  OLLAMA_CHAT_WORKSTATION_PREDICT,
} from '../ollamaConstants';
import { auditHtml } from '../htmlAudit';
import { isGemma4EdgeE2b, isGemma4EdgeE4b, isGemma426b, isGemma431b } from '../utils/pickCodingModel';
const INLINE_TOOL_QUOTE = '<|"|>';
type SimpleMode = 'art' | 'chat' | 'motion';

const SIMPLE_MOTION_KEYWORDS = [
  'bounce', 'bouncing', 'fall', 'falling', 'spin', 'spinning',
  'rotate', 'rotating', 'move', 'moving', 'float', 'floating',
  'fly', 'flying', 'animate', 'animation', 'animated',
  'firework', 'fireworks', 'explode', 'explosion', 'confetti',
  'particle', 'sparkle', 'twinkle', 'twinkling',
  'wave', 'waves', 'meteor', 'shooting star', 'carousel',
  'launch', 'juggle', 'juggling', 'dancing', 'dance',
  'game', 'score', 'collision', 'shoot', 'jump',
  'swim', 'swimming', 'appear', 'appearing',
  'κινούμενο', 'κίνηση', 'πέφτει', 'αναπηδά', 'περιστρέφεται',
  'animiert', 'bewegt', 'fallen', 'springen', 'drehen', 'rotieren',
];

function isSimpleMotionKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return SIMPLE_MOTION_KEYWORDS.some(kw => lower.includes(kw));
}

function detectLang(text: string): 'en' | 'de' | 'el' {
  if (/[Ͱ-Ͽἀ-῿]/.test(text)) return 'el';
  if (/[äöüßÄÖÜ]/.test(text)) return 'de';
  return 'en';
}

function previewText(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

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

type ToolArgs =
  | { filename: string; html_content: string }
  | { filename: string }
  | Record<string, never>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseToolArgs(raw: string): ToolArgs {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }

  const filename = parsed.filename;
  const htmlContent = parsed.html_content;

  if (filename !== undefined && typeof filename !== 'string') {
    throw new Error('Tool argument "filename" must be a string');
  }
  if (htmlContent !== undefined && typeof htmlContent !== 'string') {
    throw new Error('Tool argument "html_content" must be a string');
  }

  return parsed as ToolArgs;
}

function getLatestUserText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === 'user' && typeof msg.content === 'string') return msg.content;
  }
  return '';
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

function isGeneralChatIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower || lower.startsWith('[context:')) return false;
  const generalPrefixes = [
    'tell me',
    'say',
    'write',
    'explain',
    'what is',
    'who is',
    'why',
    'how',
    'can you',
    'do you know',
    'πες μου',
    'πες',
    'γράψε',
    'εξήγησε',
    'τι είναι',
    'ποιος είναι',
    'γιατί',
    'πως',
    'πώς',
    'μπορείς',
  ];
  const generalKeywords = [
    'story', 'joke', 'riddle', 'quiz', 'poem', 'song',
    'explain', 'meaning', 'planet', 'animal', 'space',
    'math', 'science', 'hello', 'hi', 'hey',
    'ιστορια', 'ιστορία', 'παραμυθι', 'παραμύθι', 'ανεκδοτο', 'ανέκδοτο',
    'αινιγμα', 'αίνιγμα', 'κουιζ', 'κουίζ', 'ποιημα', 'ποίημα', 'τραγουδι', 'τραγούδι',
    'εξηγ', 'σημαινει', 'σημαίνει', 'πλανητ', 'πλανήτ', 'ζωο', 'ζώο',
    'διαστημα', 'διάστημα', 'μαθηματικ', 'μαθηματικά', 'επιστημη', 'επιστήμη',
    'γεια', 'γεια σου', 'γεια σου',
  ];
  const visualKeywords = [
    'make', 'draw', 'paint', 'create', 'build', 'code',
    'animation', 'animate', 'html', 'css', 'javascript',
    'picture', 'illustration', 'card', 'scene', 'browser',
    'save', 'open', 'edit', 'fix', 'change', 'faster', 'slower',
    'φτιαξε', 'φτιάξε', 'ζωγραφισε', 'ζωγράφισε', 'δημιουργησε', 'δημιούργησε',
    'κωδικ', 'κώδικ', 'εικονα', 'εικόνα', 'ζωγραφια', 'ζωγραφιά',
    'κινηση', 'κίνηση', 'animation', 'html', 'css', 'browser',
    'αποθηκευ', 'άνοιξε', 'ανοιξε', 'διορθω', 'αλλαξε', 'άλλαξε',
    'πιο γρηγ', 'πιο αργ',
  ];

  if (visualKeywords.some((term) => lower.includes(term))) return false;
  if (generalPrefixes.some((prefix) => lower.startsWith(prefix))) return true;
  return generalKeywords.some((term) => lower.includes(term));
}

function getSystemPrompt(history: ChatMessage[], tier: ModelTier): string {
  const latestUserText = getLatestUserText(history);
  if (tier === 'simple') return SIMPLE_SYSTEM_PROMPT;
  return isEditIntent(latestUserText) ? EDIT_SYSTEM_PROMPT : CREATE_SYSTEM_PROMPT;
}

function getPromptForMode(history: ChatMessage[], tier: ModelTier, simpleMode: SimpleMode | null): string {
  if (tier === 'simple') {
    return simpleMode === 'chat' ? KID_CHAT_SYSTEM_PROMPT : SIMPLE_SYSTEM_PROMPT;
  }
  return getSystemPrompt(history, tier);
}

function parseSimpleModeLabel(text: string): SimpleMode | null {
  const normalized = text.trim().toUpperCase();
  if (normalized === 'CHAT') return 'chat';
  if (normalized === 'ART') return 'art';
  if (normalized === 'MOTION') return 'motion';
  const match = normalized.match(/\b(CHAT|ART|MOTION)\b/);
  if (!match) return null;
  return match[1] === 'CHAT' ? 'chat' : match[1] === 'ART' ? 'art' : 'motion';
}

async function classifySimpleMode(
  runtimeAdapter: LLMRuntimeAdapter,
  model: string,
  text: string,
  signal: AbortSignal,
): Promise<SimpleMode> {
  const fallback: SimpleMode = isSimpleMotionKeyword(text)
    ? 'motion'
    : isGeneralChatIntent(text)
      ? 'chat'
      : 'art';

  if (isEditIntent(text)) {
    console.info('[chat:simple-classifier:bypass-edit]', {
      model,
      lang: detectLang(text),
      route: 'art',
      textPreview: previewText(text),
    });
    return 'art';
  }

  let assembled = '';
  let loopErrorMessage = '';

  await new Promise<void>((resolve) => {
    runtimeAdapter.streamChat(
      {
        model,
        messages: [
          { role: 'system', content: SIMPLE_INTENT_CLASSIFIER_PROMPT },
          { role: 'user', content: text },
        ],
        think: false,
        temperature: 0,
        topP: 1,
        topK: 1,
        numCtx: 2048,
        numPredict: 12,
      },
      {
        onToken: (token) => { assembled += token; },
        onDone: () => resolve(),
        onError: (err) => { loopErrorMessage = err.message; resolve(); },
      },
      signal,
    );
  });

  if (signal.aborted) {
    console.info('[chat:simple-classifier:aborted]', {
      model,
      lang: detectLang(text),
      fallback,
      textPreview: previewText(text),
    });
    return fallback;
  }
  if (loopErrorMessage) {
    console.info('[chat:simple-classifier:fallback-error]', {
      model,
      lang: detectLang(text),
      fallback,
      error: loopErrorMessage,
      textPreview: previewText(text),
    });
    return fallback;
  }
  const parsed = parseSimpleModeLabel(assembled) ?? fallback;
  console.info('[chat:simple-classifier:result]', {
    model,
    lang: detectLang(text),
    labelRaw: assembled.trim(),
    route: parsed,
    fallback,
    textPreview: previewText(text),
  });
  return parsed;
}

/** Keep system prompt + last 10 user/assistant pairs + last 4 tool results. */
function buildRequestMessages(history: ChatMessage[], tier: ModelTier, simpleMode: SimpleMode | null): ChatMessage[] {
  const toolMessages = history.filter((m) => m.role === 'tool');
  const conversationMessages = history.filter((m) => m.role === 'user' || m.role === 'assistant');
  const keptConversation = conversationMessages.slice(-20);
  const keptTools = toolMessages.slice(-4);
  const kept = history.filter((m) => keptConversation.includes(m) || keptTools.includes(m));
  const systemPrompt = getPromptForMode(history, tier, simpleMode);
  return [{ role: 'system', content: systemPrompt }, ...kept];
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

function smallerModelHint(model: string): string {
  if (isGemma431b(model)) return 'gemma4:26b or gemma4:e4b';
  if (isGemma426b(model)) return 'gemma4:e4b or gemma4:e2b';
  if (isGemma4EdgeE4b(model)) return 'gemma4:e2b';
  if (isGemma4EdgeE2b(model)) return 'a smaller Gemma model or close other apps first';
  return 'a smaller Gemma model';
}

function formatRuntimeError(error: Error, model: string): string {
  const raw = error.message.trim();
  const memoryMatch = raw.match(/requires more system memory\s+([0-9.]+\s+GiB)\s+than is available\s+([0-9.]+\s+GiB)/i);

  if (memoryMatch) {
    const required = memoryMatch[1];
    const available = memoryMatch[2];
    return [
      'This Gemma model is too big for this computer right now.',
      'Try closing other apps, then press Try Again.',
      `If it still happens, ask a grown-up to switch to ${smallerModelHint(model)} in the model menu.`,
      '',
      `Grown-up note: Ollama could not load ${model} because it needs ${required} RAM and only ${available} was free.`,
    ].join('\n');
  }

  return raw;
}

export interface AuditSummary {
  fixes: string[];
  visualWarnings: string[];
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

  // Canonical message history — updated synchronously, avoids stale closure in runLoop.
  const historyRef = useRef<ChatMessage[]>([]);
  const cancelRef = useRef<CancellationToken | null>(null);
  // Incremented on clearContext so an in-flight runLoop knows not to write stale history.
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
      // Guard re-entry: abort may have fired during a tool dispatch IPC round-trip.
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
        setErrorMsg(formatRuntimeError(loopError as Error, model));
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
            const args = parseToolArgs(call.function.arguments);

            switch (call.function.name) {
              case 'save_animation': {
                if (!('filename' in args) || !('html_content' in args)) {
                  throw new Error('save_animation requires filename and html_content');
                }
                const audited = auditHtml(args.html_content);
                setLastAudit({ fixes: audited.fixes, visualWarnings: audited.visualWarnings });
                if (audited.fixes.length > 0) {
                  console.info('[htmlAudit] save_animation fixes:', audited.fixes);
                }
                const res = await window.electronAPI.saveAnimation(
                  args.filename,
                  audited.html,
                  'gemma',
                );
                result = res;
                if (res.success) {
                  setLatestCode(audited.html);
                  setLastSaved(res.filename);
                }
                break;
              }
              case 'read_animation':
                if (!('filename' in args)) {
                  throw new Error('read_animation requires filename');
                }
                result = await window.electronAPI.readAnimation(args.filename);
                break;
              case 'list_animations':
                result = await window.electronAPI.listAnimations();
                break;
              case 'open_in_browser':
                if (!('filename' in args)) {
                  throw new Error('open_in_browser requires filename');
                }
                result = await window.electronAPI.openInBrowser(args.filename);
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
        // But honour a Stop that arrived during the IPC round-trip.
        if (token.signal.aborted) {
          setStreamingText('');
          setStreamingThinking('');
          setStatus('idle');
          return;
        }
        continue;
      }

      // Plain text final response — loop ends.
      // Layer 2: sentinel swap — replace __TOOBIG__ with the sister message.
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
    // Layer 1: instant keyword block — no model call, no streaming.
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
    runLoop(updated, token);
  }, [ctxUsedPct, runLoop, modelTier]);

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

  // Silently inject a context note (e.g. project loaded from sidebar) into
  // history without triggering generation. Replaces any previous injection
  // so loading project B after A doesn't stack two context messages.
  const injectContext = useCallback((text: string) => {
    const filtered = historyRef.current.filter(
      m => !(m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[Context:'))
    );
    const msg: ChatMessage = { role: 'user', content: text };
    const updated = [...filtered, msg];
    historyRef.current = updated;
    setMessages(updated);
  }, []);

  return { messages, streamingText, streamingThinking, latestCode, lastSaved, lastAudit, status, errorMsg, ctxUsedPct, sendMessage, cancel, retry, clearContext, injectContext };
}
