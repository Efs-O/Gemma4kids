import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  role: string;
  content: string;
  streaming?: boolean;
}

/** Replace ```html ... ``` blocks with a short note — the code goes to the editor. */
function stripHtmlBlocks(text: string): string {
  return text.replace(/```(?:html)?\n[\s\S]*?```/gi, '\n*✨ Your animation code is in the editor!*\n');
}

export function Message({ role, content, streaming }: Props) {
  const display = role === 'assistant' ? stripHtmlBlocks(content) : content;

  return (
    <div className={`message message-${role}${streaming ? ' message-streaming' : ''}`}>
      <div className="message-role">{role === 'user' ? 'You' : '✨ Gemma'}</div>
      <div className="message-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{display}</ReactMarkdown>
      </div>
    </div>
  );
}
