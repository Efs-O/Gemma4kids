import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TTSService } from '../services/TTSService';

interface Props {
  role: string;
  content: string;
  streaming?: boolean;
  tts?: TTSService;
}

function stripHtmlBlocks(text: string): string {
  return text.replace(/```(?:html)?\n[\s\S]*?```/gi, '\n*✨ Your animation code is in the editor!*\n');
}

export function Message({ role, content, streaming, tts }: Props) {
  const [speaking, setSpeaking] = useState(false);
  const display = role === 'assistant' ? stripHtmlBlocks(content) : content;

  const handleSpeak = async () => {
    if (!tts) return;
    if (speaking) {
      tts.cancel();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    try {
      await tts.speak(content);
    } catch {
      // Piper not available — fail silently
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <div className={`message message-${role}${streaming ? ' message-streaming' : ''}`}>
      <div className="message-role">{role === 'user' ? 'You' : '✨ Gemma'}</div>
      <div className="message-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
      </div>
      {role === 'assistant' && !streaming && tts && (
        <button
          className={`btn-speaker${speaking ? ' btn-speaker-speaking' : ''}`}
          onClick={handleSpeak}
          aria-label={speaking ? 'Stop reading' : 'Read aloud'}
          title={speaking ? 'Stop' : 'Read aloud'}
        >
          {speaking ? '⏹' : '🔊'}
        </button>
      )}
    </div>
  );
}
