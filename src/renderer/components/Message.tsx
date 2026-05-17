import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TTSService } from '../services/TTSService';

const CODE_READY_MESSAGE = 'Your code is ready in the editor! Press the green Open in Browser button when it lights up to see your creation.';

interface Props {
  role: string;
  content: string;
  thinking?: string;
  showThinking?: boolean;
  streaming?: boolean;
  tts?: TTSService;
}

function hasStartedCodeStream(text: string): boolean {
  return /```(?:html)?\n/i.test(text) || /<!DOCTYPE html/i.test(text) || /<html\b/i.test(text);
}

function getSpeakableText(text: string): string {
  return text
    .replace(/\*Your animation code is in the editor\.\*/gi, '')
    .replace(new RegExp(`\\*${CODE_READY_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*`, 'gi'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hideHtmlOutput(text: string): string {
  const replacement = `\n\n*${CODE_READY_MESSAGE}*\n\n`;
  let next = text.replace(/```(?:html)?\n[\s\S]*?(?:```|$)/gi, replacement);
  next = next.replace(/<!DOCTYPE html[\s\S]*$/i, replacement);
  next = next.replace(/<html\b[\s\S]*$/i, replacement);
  next = next.replace(/\n{3,}/g, '\n\n');
  return next.trim();
}

function flattenText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return React.Children.toArray(node).map(flattenText).join('');
}

function friendifyThinking(text: string): string {
  return text.replace(/\bThe user\b/g, 'My friend').replace(/\bthe user\b/g, 'my friend');
}

export function Message({ role, content, thinking = '', showThinking = false, streaming, tts }: Props) {
  const [speaking, setSpeaking] = useState(false);
  const [ttsHint, setTtsHint] = useState('');
  const display = role === 'assistant' ? hideHtmlOutput(content) : content;
  const speakableText = role === 'assistant' ? getSpeakableText(display) : display;
  const canSpeakWhileStreaming = role === 'assistant' && !!speakableText && (hasStartedCodeStream(content) || !!display);
  const showSpeakButton = role === 'assistant' && !!tts && !!display && (!streaming || canSpeakWhileStreaming);

  const handleSpeak = async () => {
    if (!tts) return;
    if (speaking) {
      tts.cancel();
      setSpeaking(false);
      return;
    }
    setTtsHint('');
    setSpeaking(true);
    try {
      await tts.speak(speakableText || display);
    } catch (error) {
      console.error('[Message] Read aloud failed:', error);
      const reason = error instanceof Error ? error.message : String(error);
      setTtsHint(`Reading voice isn't ready right now. (${reason})`);
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <div className={`message message-${role}${streaming ? ' message-streaming' : ''}`}>
      <div className="message-role">{role === 'user' ? 'You' : 'Gemma'}</div>
      {role === 'assistant' && showThinking && thinking.trim() && (
        <details className="thinking-bubble" open={streaming}>
          <summary>{streaming ? 'Thinking...' : 'Thought Process'}</summary>
          <div className="thinking-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{friendifyThinking(thinking)}</ReactMarkdown>
          </div>
        </details>
      )}
      {display && (
        <div className="message-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              em: ({ children }) => {
                const text = flattenText(children).trim();
                if (text === CODE_READY_MESSAGE) {
                  return <em className="message-code-ready">{children}</em>;
                }
                return <em>{children}</em>;
              },
            }}
          >
            {display}
          </ReactMarkdown>
        </div>
      )}
      {showSpeakButton && (
        <div className="message-actions">
          <button
            className={`btn-speaker${speaking ? ' btn-speaker-speaking' : ''}`}
            onClick={handleSpeak}
            aria-label={speaking ? 'Stop speaking' : 'Speak aloud'}
            title={speaking ? 'Stop speaking' : 'Speak aloud'}
          >
            {speaking ? 'Stop' : 'Speak'}
          </button>
          {ttsHint && <div className="message-tts-hint">{ttsHint}</div>}
        </div>
      )}
    </div>
  );
}
