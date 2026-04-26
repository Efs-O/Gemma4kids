import React, { useEffect, useRef } from 'react';
import { Message } from './Message';
import { InputRow } from './InputRow';
import type { ChatMessage } from '../llm/types';

const STARTER_PROMPTS: { label: string; text: string }[] = [
  { label: '🏀 Make a bouncing ball animation', text: 'Make a bouncing ball animation' },
  { label: '❄️ Make snowflakes gently falling', text: 'Make snowflakes gently falling from the sky' },
  { label: '🎆 Make colorful fireworks exploding', text: 'Make colorful fireworks exploding in the night sky' },
];

const FOLLOW_UP_CHIPS: { label: string; text: string }[] = [
  { label: '⚡ Make it faster', text: 'Make it faster' },
  { label: '🔴 Change color to red', text: 'Change the main color to red' },
  { label: '🎵 Add floating music notes', text: 'Add floating music notes to the animation' },
];

interface Props {
  messages: ChatMessage[];
  streamingText: string;
  status: 'idle' | 'streaming' | 'error';
  errorMsg: string;
  onSend: (text: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  e4bAvailable: boolean;
}

export function ChatPanel({ messages, streamingText, status, errorMsg, onSend, onCancel, onRetry, e4bAvailable }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText]);

  // Only show user and assistant text turns — hide tool call/result rows.
  const visible = messages.filter(
    m => m.role === 'user' || (m.role === 'assistant' && m.content != null && m.content !== ''),
  );

  const showStarters = visible.length === 0 && !streamingText && status === 'idle';
  const lastIsAssistant = visible.length > 0 && visible[visible.length - 1].role === 'assistant';
  const showChips = status === 'idle' && lastIsAssistant && !errorMsg;

  return (
    <div className="chat-panel">
      <div className="chat-label">💬 Chat with Gemma</div>
      <div className="message-list">
        {visible.length === 0 && !streamingText && (
          <div className="chat-empty">
            Hi! I'm Gemma, your coding buddy! 🎉<br />
            <em>Tell me what you want to make!</em>
          </div>
        )}
        {showStarters && (
          <div className="prompt-cards">
            {STARTER_PROMPTS.map(p => (
              <button key={p.label} className="prompt-card" onClick={() => onSend(p.text)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
        {visible.map((msg, i) => (
          <Message key={i} role={msg.role as string} content={msg.content ?? ''} />
        ))}
        {streamingText && <Message role="assistant" content={streamingText} streaming />}
        {errorMsg && (
          <div>
            <div className="error-msg">😕 Oops! Something went wrong. Try again?</div>
            <button className="btn-retry" onClick={onRetry}>🔄 Try Again</button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {showChips && (
        <div className="suggestion-chips">
          {FOLLOW_UP_CHIPS.map(c => (
            <button key={c.label} className="chip" onClick={() => onSend(c.text)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <InputRow status={status} onSend={onSend} onCancel={onCancel} e4bAvailable={e4bAvailable} />
    </div>
  );
}
