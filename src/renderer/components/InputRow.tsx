import React, { useState, KeyboardEvent } from 'react';

interface Props {
  status: 'idle' | 'streaming' | 'error';
  onSend: (text: string) => void;
  onCancel: () => void;
}

export function InputRow({ status, onSend, onCancel }: Props) {
  const [text, setText] = useState('');

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (status !== 'streaming') handleSend();
    }
  }

  return (
    <div className="input-row">
      <textarea
        className="input-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Gemma to make something fun... (Enter to send)"
        rows={3}
        disabled={status === 'streaming'}
      />
      <div className="input-buttons">
        {status === 'streaming'
          ? <button className="btn-cancel" onClick={onCancel}>⏹ Stop</button>
          : <button className="btn-send" onClick={handleSend} disabled={!text.trim()}>Send ➤</button>
        }
      </div>
    </div>
  );
}
