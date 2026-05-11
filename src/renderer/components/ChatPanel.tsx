import React, { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Message } from './Message';
import { InputRow } from './InputRow';
import type { ChatMessage } from '../llm/types';
import { createTTSService } from '../services/TTSService';
import type { ModelTier } from '../utils/pickCodingModel';
import type { SendMessageInput } from '../hooks/useChat';
import type { LLMRuntimeAdapter } from '../services/OllamaService';
import type { AppLanguage } from './WelcomeScreen';

const ALL_STARTERS: { label: string; text: string }[] = [
  { label: '🏀 Make a bouncing ball animation', text: 'Make a bouncing ball animation' },
  { label: '❄️ Make snowflakes gently falling', text: 'Make snowflakes gently falling from the sky' },
  { label: '🎆 Make colorful fireworks exploding', text: 'Make colorful fireworks exploding in the night sky' },
  { label: '🌈 Make a rainbow appear after rain', text: 'Make a rainbow appear after rain' },
  { label: '🦋 Make butterflies flying around flowers', text: 'Make colorful butterflies flying around flowers' },
  { label: '🚀 Launch a rocket into space', text: 'Make a rocket launch into space with stars in the background' },
  { label: '🌊 Make ocean waves on a beach', text: 'Make animated ocean waves crashing on a sunny beach' },
  { label: '🎠 Make a spinning carousel', text: 'Make a colorful spinning carousel with horses' },
  { label: '🌙 Make a night sky with shooting stars', text: 'Make a night sky with twinkling stars and shooting stars' },
  { label: '🐠 Make fish swimming in the sea', text: 'Make colorful fish swimming in the sea with bubbles' },
  { label: '🍂 Make falling autumn leaves', text: 'Make colorful autumn leaves gently falling from trees' },
  { label: '🎪 Make a bouncing clown juggling balls', text: 'Make a fun clown juggling colorful bouncing balls' },
];

const ALL_CHIPS: { label: string; text: string }[] = [
  { label: '⚡ Make it faster', text: 'Make it faster' },
  { label: '🐢 Make it slower', text: 'Make it slower' },
  { label: '🎨 Change color', text: 'Change the main color' },
  { label: '💜 Change color to purple', text: 'Change the main color to purple' },
  { label: '🌈 Add more colors', text: 'Add more bright rainbow colors' },
  { label: '🎵 Add floating music notes', text: 'Add floating music notes to the animation' },
  { label: '⭐ Add twinkling stars', text: 'Add twinkling stars in the background' },
  { label: '💥 Make it bigger', text: 'Make everything bigger' },
  { label: '🔮 Make it glow', text: 'Make the shapes glow with a neon light effect' },
  { label: '🌀 Add a spinning effect', text: 'Add a spinning or rotating effect' },
  { label: '💦 Add splashing water', text: 'Add splashing water or bubbles' },
  { label: '🎉 Add confetti', text: 'Add falling confetti in many colors' },
];

const NEW_ANIMATION_CHIP = { label: '🎨 Make something new', text: 'Make me a completely new animation' };
const SIMPLE_NEW_CHIP = { label: '🎨 Make something new', text: 'Make me a new colourful picture' };

const SIMPLE_STARTERS: { label: string; text: string }[] = [
  { label: '🎂 Make a birthday card', text: 'Make a colourful birthday card with balloons and a cake' },
  { label: '☀️ Draw a happy sunshine', text: 'Draw a big happy sunshine with a blue sky' },
  { label: '🌸 Paint a flower in a vase', text: 'Paint a flower in a vase with colourful petals' },
  { label: '🌈 Make a rainbow flag', text: 'Make a rainbow flag with all the colours' },
  { label: '😊 Draw a smiling face', text: 'Draw a big smiling emoji face' },
  { label: '🏠 Draw a house with a garden', text: 'Draw a house with a garden and flowers' },
  { label: '🐱 Draw a cute cat face', text: 'Draw a cute cat face with whiskers and big eyes' },
  { label: '🍕 Make a pizza slice', text: 'Make a colourful pizza slice with toppings' },
  { label: '🦸 Draw a superhero badge', text: 'Draw a superhero badge with a bold letter' },
  { label: '🎈 Make a hot air balloon', text: 'Make a colourful hot air balloon in the sky' },
  { label: '🌙 Paint a night sky', text: 'Paint a night scene with a moon and stars' },
  { label: '🌺 Make a welcome sign', text: 'Make a colourful Welcome sign with flowers around it' },
];

const SIMPLE_CHIPS: { label: string; text: string }[] = [
  { label: '🎨 Change colour', text: 'Change the main colour' },
  { label: '💥 Make everything bigger', text: 'Make everything bigger' },
  { label: '🌈 Add more bright colours', text: 'Add more bright colours' },
];

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, n);
}

interface Props {
  messages: ChatMessage[];
  streamingText: string;
  streamingThinking: string;
  status: 'idle' | 'streaming' | 'error';
  errorMsg: string;
  hasCode: boolean;
  onSend: (input: SendMessageInput) => void;
  onCancel: () => void;
  onRetry: () => void;
  e4bAvailable: boolean;
  greekTranscribeModel: string | null;
  transcribeModel: string;
  codingModel: string;
  runtimeAdapter: LLMRuntimeAdapter;
  showThinking: boolean;
  ctxUsedPct?: number;
  onClearContext?: () => void;
  modelTier?: ModelTier;
  supportsVisualAttachments: boolean;
  videoAttachmentFileRef?: MutableRefObject<File | null>;
  appLanguage: AppLanguage;
}

export function ChatPanel({
  messages,
  streamingText,
  streamingThinking,
  status,
  errorMsg,
  hasCode,
  onSend,
  onCancel,
  onRetry,
  e4bAvailable,
  greekTranscribeModel,
  transcribeModel,
  codingModel,
  runtimeAdapter,
  showThinking,
  ctxUsedPct,
  onClearContext,
  modelTier = 'full',
  supportsVisualAttachments,
  videoAttachmentFileRef,
  appLanguage,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const effectiveShowThinking = showThinking;
  const userScrolledUpRef = useRef(false);
  /** True only while we assign scrollTop — ignore synthetic scroll events for stick-to-bottom heuristics. */
  const programmaticScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const tts = useMemo(() => createTTSService(), []);

  // Picked once at mount; reshuffled after each assistant reply (messages.length changes).
  const starters = useMemo(
    () => modelTier === 'simple' ? pickRandom(SIMPLE_STARTERS, 5) : pickRandom(ALL_STARTERS, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modelTier],
  );
  const chips = useMemo(
    () => modelTier === 'simple' ? SIMPLE_CHIPS : pickRandom(ALL_CHIPS, 3),
    [modelTier, messages.length],
  );

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    userScrolledUpRef.current = !nearBottom;
  }, []);

  /** Wheel is user-driven; scroll-up pauses stick-to-bottom during streaming. */
  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = listRef.current;
    if (!el) return;
    if (e.deltaY < 0) {
      userScrolledUpRef.current = true;
      return;
    }
    if (e.deltaY > 0) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (nearBottom) userScrolledUpRef.current = false;
    }
  }, []);

  // Smoothly animate scrollTop toward scrollHeight using rAF so rapid
  // chunk updates never cancel each other — one frame per tick, silky.
  const scheduleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return; // already scheduled
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = listRef.current;
      if (!el || userScrolledUpRef.current) return;
      const target = el.scrollHeight - el.clientHeight;
      const diff = target - el.scrollTop;
      if (diff <= 0) return;
      // Ease toward target: jump most of the gap each frame.
      programmaticScrollRef.current = true;
      el.scrollTop += diff * 0.3;
      programmaticScrollRef.current = false;
      // If still not there, keep animating.
      if (diff > 2) scheduleScroll();
    });
  }, []);

  // New message turn → always scroll to bottom and re-enable auto-scroll.
  useEffect(() => {
    userScrolledUpRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // During streaming → smooth rAF-based scroll that survives rapid chunks.
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    scheduleScroll();
  }, [streamingText, streamingThinking, scheduleScroll]);

  // Only show user and assistant text turns — hide tool call/result rows and silent context injections.
  const visible = messages.filter(
    m => (m.role === 'user' && !String(m.content ?? '').startsWith('[Context:')) || (
      m.role === 'assistant' &&
      (
        (m.content != null && m.content !== '') ||
        (!m.tool_calls && effectiveShowThinking && !!m.thinking)
      )
    ),
  );

  const hasStreamingMessage = !!streamingText || (effectiveShowThinking && !!streamingThinking);
  const lastIsAssistant = visible.length > 0 && visible[visible.length - 1].role === 'assistant';
  // Show starters when no animation exists yet (no code generated), regardless of message count.
  const showStarters = !hasCode && !hasStreamingMessage && status === 'idle';
  // Show modification chips only when an animation exists; always append the "make new" escape chip.
  const showChips = status === 'idle' && lastIsAssistant && !errorMsg && hasCode;

  // When chips appear they shrink message-list height; snap to new bottom
  // using its own rAF so it never races with the streaming scroll chain.
  useEffect(() => {
    if (!showChips) return;
    userScrolledUpRef.current = false;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      programmaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      programmaticScrollRef.current = false;
    });
  }, [showChips]);

  return (
    <div className="chat-panel">
      <div className="chat-label">💬 Chat with Gemma</div>
      <div className="message-list" ref={listRef} onScroll={handleScroll} onWheel={handleWheel}>
        {visible.length === 0 && !hasStreamingMessage && (
          <div className="chat-empty">
            Hi! I'm Gemma, your coding buddy! 🎉<br />
            <em>Tell me what you want to make!</em>
          </div>
        )}
        {showStarters && (
          <div className="prompt-cards">
            {starters.map(p => (
              <button key={p.label} className="prompt-card" onClick={() => onSend(p.text)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
        {visible.map((msg, i) => (
          <Message
            key={i}
            role={msg.role as string}
            content={msg.content ?? ''}
            thinking={msg.thinking ?? ''}
            showThinking={effectiveShowThinking}
            tts={tts}
          />
        ))}
        {(streamingText || (effectiveShowThinking && streamingThinking)) && (
          <Message
            role="assistant"
            content={streamingText}
            thinking={streamingThinking}
            showThinking={effectiveShowThinking}
            streaming
            tts={tts}
          />
        )}
        {errorMsg && (
          <div>
            <div className="error-msg">
              <div>😕 Oops! Gemma hit a snag. You can try again, or show this note to a grown-up.</div>
              <pre className="error-detail" role="status">{errorMsg}</pre>
            </div>
            <button className="btn-retry" onClick={onRetry}>🔄 Try Again</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {showChips && (
        <div className="suggestion-chips">
          {chips.map(c => (
            <button key={c.label} className="chip" onClick={() => onSend(c.text)}>
              {c.label}
            </button>
          ))}
          <button className="chip chip--new" onClick={() => onSend(modelTier === 'simple' ? SIMPLE_NEW_CHIP.text : NEW_ANIMATION_CHIP.text)}>
            {NEW_ANIMATION_CHIP.label}
          </button>
        </div>
      )}
        <InputRow
          status={status}
          onSend={onSend}
          onCancel={onCancel}
          e4bAvailable={e4bAvailable}
          greekTranscribeModel={greekTranscribeModel}
          transcribeModel={transcribeModel}
          codingModel={codingModel}
          runtimeAdapter={runtimeAdapter}
          ctxUsedPct={ctxUsedPct}
          onClearContext={onClearContext}
          supportsVisualAttachments={supportsVisualAttachments}
          videoAttachmentFileRef={videoAttachmentFileRef}
          appLanguage={appLanguage}
        />
    </div>
  );
}
