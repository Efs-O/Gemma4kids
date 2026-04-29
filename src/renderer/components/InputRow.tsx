import React, { useState, KeyboardEvent } from 'react';
import { VoiceInput } from './VoiceInput';

interface Props {
  status: 'idle' | 'streaming' | 'error';
  onSend: (text: string) => void;
  onCancel: () => void;
  e4bAvailable: boolean;
  transcribeModel: string;
  codingModel: string;
  ctxUsedPct?: number;
  onClearContext?: () => void;
}

export function InputRow({ status, onSend, onCancel, e4bAvailable, transcribeModel, codingModel, ctxUsedPct = 0, onClearContext }: Props) {
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

  const remaining = 100 - ctxUsedPct;
  const meterClass = remaining > 50 ? 'ctx-meter ctx-meter-green'
    : remaining > 20 ? 'ctx-meter ctx-meter-orange'
    : 'ctx-meter ctx-meter-red';
  const meterTitle = remaining > 50 ? "We're good — plenty of space!"
    : remaining > 20 ? "Context is filling up — think about starting fresh soon"
    : "Almost full — click to start a fresh chat!";

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
        {ctxUsedPct > 0 && (
          <button
            className={meterClass}
            onClick={onClearContext}
            title={meterTitle}
          >
            {remaining}%
          </button>
        )}
        <VoiceInput
          e4bAvailable={e4bAvailable}
          transcribeModel={transcribeModel}
          codingModel={codingModel}
          onTranscription={onSend}
          disabled={status === 'streaming'}
        />
        {status === 'streaming'
          ? <button className="btn-cancel" onClick={onCancel}>⏹ Stop</button>
          : <button className="btn-send" onClick={handleSend} disabled={!text.trim()}>Send ➤</button>
        }
      </div>
    </div>
  );
}
