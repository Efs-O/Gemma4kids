import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  role: string;
  content: string;
  streaming?: boolean;
}

export function Message({ role, content, streaming }: Props) {
  return (
    <div className={`message message-${role}${streaming ? ' message-streaming' : ''}`}>
      <div className="message-role">{role === 'user' ? 'You' : '✨ Gemma'}</div>
      <div className="message-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
