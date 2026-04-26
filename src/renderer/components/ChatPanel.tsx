import React, { useEffect, useRef } from 'react';
import { Message } from './Message';
import { InputRow } from './InputRow';
import type { ChatMessage } from '../llm/types';

interface Props {
  messages: ChatMessage[];
  streamingText: string;
  status: 'idle' | 'streaming' | 'error';
  errorMsg: string;
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function ChatPanel({ messages, streamingText, status, errorMsg, onSend, onCancel }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText]);

  return (
    <div className="chat-panel">
      <div className="chat-label">Chat with Gemma</div>
      <div className="message-list">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask Gemma to make something! Try:<br />
            <em>"Make a bouncing ball animation"</em>
          </div>
        )}
        {messages.map((msg, i) => (
          <Message key={i} role={msg.role as string} content={msg.content ?? ''} />
        ))}
        {streamingText && <Message role="assistant" content={streamingText} streaming />}
        {errorMsg && <div className="error-msg">⚠️ {errorMsg}</div>}
        <div ref={bottomRef} />
      </div>
      <InputRow status={status} onSend={onSend} onCancel={onCancel} />
    </div>
  );
}
