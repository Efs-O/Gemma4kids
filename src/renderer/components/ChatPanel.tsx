import React, { useEffect, useMemo, useRef } from 'react';
import { Message } from './Message';
import { InputRow } from './InputRow';
import type { ChatMessage } from '../llm/types';
import { createTTSService } from '../services/TTSService';

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
  { label: '🔴 Change color to red', text: 'Change the main color to red' },
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
  onSend: (text: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  e4bAvailable: boolean;
  transcribeModel: string;
  codingModel: string;
  showThinking: boolean;
}

export function ChatPanel({
  messages,
  streamingText,
  streamingThinking,
  status,
  errorMsg,
  onSend,
  onCancel,
  onRetry,
  e4bAvailable,
  transcribeModel,
  codingModel,
  showThinking,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const tts = useMemo(() => createTTSService(), []);

  // Picked once at mount; reshuffled after each assistant reply (messages.length changes).
  const starters = useMemo(() => pickRandom(ALL_STARTERS, 3), []);
  const chips = useMemo(() => pickRandom(ALL_CHIPS, 3), [messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, streamingThinking]);

  // Only show user and assistant text turns — hide tool call/result rows.
  const visible = messages.filter(
    m => m.role === 'user' || (
      m.role === 'assistant' &&
      ((m.content != null && m.content !== '') || (showThinking && !!m.thinking))
    ),
  );

  const hasStreamingMessage = !!streamingText || (showThinking && !!streamingThinking);
  const showStarters = visible.length === 0 && !hasStreamingMessage && status === 'idle';
  const lastIsAssistant = visible.length > 0 && visible[visible.length - 1].role === 'assistant';
  const showChips = status === 'idle' && lastIsAssistant && !errorMsg;

  return (
    <div className="chat-panel">
      <div className="chat-label">💬 Chat with Gemma</div>
      <div className="message-list">
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
            showThinking={showThinking}
            tts={tts}
          />
        ))}
        {(streamingText || (showThinking && streamingThinking)) && (
          <Message
            role="assistant"
            content={streamingText}
            thinking={streamingThinking}
            showThinking={showThinking}
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
        </div>
      )}
      <InputRow
        status={status}
        onSend={onSend}
        onCancel={onCancel}
        e4bAvailable={e4bAvailable}
        transcribeModel={transcribeModel}
        codingModel={codingModel}
      />
    </div>
  );
}
