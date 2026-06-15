import {
  CREATE_SYSTEM_PROMPT,
  EDIT_SYSTEM_PROMPT,
  KID_CHAT_SYSTEM_PROMPT,
  SIMPLE_INTENT_CLASSIFIER_PROMPT,
  SIMPLE_SYSTEM_PROMPT,
} from './prompts';
import type { ChatMessage } from './llm/types';
import type { LLMRuntimeAdapter } from './services/OllamaService';
import type { ModelTier } from './utils/pickCodingModel';

export type SimpleMode = 'art' | 'chat' | 'motion';

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

export function isSimpleMotionKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return SIMPLE_MOTION_KEYWORDS.some((kw) => lower.includes(kw));
}

export function detectLang(text: string): 'en' | 'de' | 'el' {
  if (/[Ͱ-Ͽἀ-῿]/.test(text)) return 'el';
  if (/[äöüßÄÖÜ]/.test(text)) return 'de';
  return 'en';
}

export function previewText(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

export function extractHtml(text: string): string | null {
  // Tolerate fences without a trailing newline / with CRLF / with trailing spaces
  // (```html , ```html\r\n, ```\n). Falls back to a raw <!DOCTYPE…</html> scan so an
  // un-fenced full document is still captured.
  const fenced = text.match(/```(?:html)?[ \t]*\r?\n?([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  return extractPartialHtml(text);
}

export function extractPartialHtml(text: string): string | null {
  const start = text.indexOf('<!DOCTYPE html>');
  if (start === -1) return null;
  let html = text.slice(start);
  const fence = html.lastIndexOf('\n```');
  if (fence !== -1) html = html.slice(0, fence);
  return html.trim() || null;
}

export function getLatestUserText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (
      msg.role === 'user' &&
      typeof msg.content === 'string' &&
      !msg.content.startsWith('[Context:')
    ) {
      return msg.content;
    }
  }
  return '';
}

export function isEditIntent(text: string): boolean {
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

export async function classifySimpleMode(
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

/**
 * Independent slicing of conversation vs tool messages can leave a tool result
 * without its parent `assistant(tool_calls)`, or an assistant tool-call whose
 * result was truncated away. Both shapes make Ollama / OpenAI-compatible servers
 * reject the request (HTTP 400/500). This drops any such orphans so the kept
 * window is always internally consistent.
 */
function pruneOrphanToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const calledIds = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const call of m.tool_calls) calledIds.add(call.id);
    }
  }
  // 1. Drop tool results with no parent assistant tool-call in the window.
  let result = messages.filter(
    (m) => m.role !== 'tool' || (m.tool_call_id != null && calledIds.has(m.tool_call_id)),
  );
  // 2. Drop assistant tool-call messages whose results are not all present.
  const resolvedIds = new Set<string>();
  for (const m of result) {
    if (m.role === 'tool' && m.tool_call_id) resolvedIds.add(m.tool_call_id);
  }
  result = result.filter(
    (m) => m.role !== 'assistant' || !m.tool_calls?.length || m.tool_calls.every((call) => resolvedIds.has(call.id)),
  );
  // 3. Re-prune tool results orphaned by step 2.
  const finalCalledIds = new Set<string>();
  for (const m of result) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const call of m.tool_calls) finalCalledIds.add(call.id);
    }
  }
  return result.filter(
    (m) => m.role !== 'tool' || (m.tool_call_id != null && finalCalledIds.has(m.tool_call_id)),
  );
}

export function buildRequestMessages(history: ChatMessage[], tier: ModelTier, simpleMode: SimpleMode | null): ChatMessage[] {
  const toolMessages = history.filter((m) => m.role === 'tool');
  const conversationMessages = history.filter((m) => m.role === 'user' || m.role === 'assistant');
  const keptConversation = conversationMessages.slice(-20);
  const keptTools = toolMessages.slice(-4);
  const kept = pruneOrphanToolMessages(
    history.filter((m) => keptConversation.includes(m) || keptTools.includes(m)),
  );
  const systemPrompt = getPromptForMode(history, tier, simpleMode);
  return [{ role: 'system', content: systemPrompt }, ...kept];
}

function smallerModelHint(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('31b')) return 'gemma4:26b or gemma4:12b';
  if (lower.includes('26b')) return 'gemma4:12b or gemma4:e4b';
  if (lower.includes('12b')) return 'gemma4:e4b or gemma4:e2b';
  if (lower.includes('e4b')) return 'gemma4:e2b';
  if (lower.includes('e2b')) return 'a smaller Gemma model or close other apps first';
  return 'a smaller Gemma model';
}

export function formatRuntimeError(error: Error, model: string, runtimeLabel = 'Ollama'): string {
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
      `Grown-up note: ${runtimeLabel} could not load ${model} because it needs ${required} RAM and only ${available} was free.`,
    ].join('\n');
  }

  return raw;
}
