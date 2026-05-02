import React, { useEffect, useRef, useState, KeyboardEvent, ChangeEvent } from 'react';
import { VoiceInput } from './VoiceInput';

const ACCEPTED_IMAGE_EXTENSIONS = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif';
const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
];

interface AttachmentState {
  base64: string;
  fileName: string;
  previewUrl: string;
}

interface Props {
  status: 'idle' | 'streaming' | 'error';
  onSend: (input: string | { text: string; images?: string[] }) => void;
  onCancel: () => void;
  e4bAvailable: boolean;
  greekTranscribeModel: string | null;
  transcribeModel: string;
  codingModel: string;
  ctxUsedPct?: number;
  onClearContext?: () => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = result.indexOf(',');
      if (commaIndex === -1) {
        reject(new Error('Could not read that picture.'));
        return;
      }
      resolve(result.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(new Error('Could not read that picture.'));
    reader.readAsDataURL(file);
  });
}

function isAcceptedImage(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return ACCEPTED_IMAGE_MIME_TYPES.includes(file.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(lowerName);
}

export function InputRow({
  status,
  onSend,
  onCancel,
  e4bAvailable,
  greekTranscribeModel,
  transcribeModel,
  codingModel,
  ctxUsedPct = 0,
  onClearContext,
}: Props) {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<AttachmentState | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    };
  }, [attachment]);

  function clearAttachment() {
    setAttachment((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setPreviewFailed(false);
    setAttachmentError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function sendWithCurrentAttachment(messageText: string) {
    const trimmed = messageText.trim();
    if (!trimmed) return;
    if (attachment) {
      onSend({ text: trimmed, images: [attachment.base64] });
      clearAttachment();
    } else {
      onSend(trimmed);
    }
  }

  function handleSend() {
    sendWithCurrentAttachment(text);
    setText('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (status !== 'streaming') handleSend();
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!isAcceptedImage(file)) {
      clearAttachment();
      setAttachmentError('Pick a picture file like PNG, JPG, WebP, GIF, BMP, HEIC, or HEIF.');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    try {
      const base64 = await fileToBase64(file);
      setAttachment((current) => {
        if (current) URL.revokeObjectURL(current.previewUrl);
        return {
          base64,
          fileName: file.name,
          previewUrl,
        };
      });
      setPreviewFailed(false);
      setAttachmentError('');
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      clearAttachment();
      setAttachmentError(error instanceof Error ? error.message : 'Could not read that picture.');
    }
  }

  const remaining = 100 - ctxUsedPct;
  const meterClass = remaining > 50 ? 'ctx-meter ctx-meter-green'
    : remaining > 20 ? 'ctx-meter ctx-meter-orange'
    : 'ctx-meter ctx-meter-red';
  const meterTitle = remaining > 50 ? "We're good — plenty of space!"
    : remaining > 20 ? 'Context is filling up — think about starting fresh soon'
    : 'Almost full — click to start a fresh chat!';

  return (
    <div className="input-row">
      {attachment && (
        <div className="input-attachment-preview">
          {previewFailed ? (
            <div className="input-attachment-fallback" aria-hidden="true">🖼</div>
          ) : (
            <img
              className="input-attachment-thumb"
              src={attachment.previewUrl}
              alt={attachment.fileName}
              onError={() => setPreviewFailed(true)}
            />
          )}
          <div className="input-attachment-meta">
            <div className="input-attachment-label">Picture ready</div>
            <div className="input-attachment-name" title={attachment.fileName}>{attachment.fileName}</div>
          </div>
          <button
            className="input-attachment-remove"
            type="button"
            onClick={clearAttachment}
            disabled={status === 'streaming'}
            title="Remove picture"
          >
            ×
          </button>
        </div>
      )}
      <textarea
        className="input-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Gemma to make something fun... (Enter to send)"
        rows={3}
        disabled={status === 'streaming'}
      />
      {attachmentError && (
        <div className="input-attachment-error" role="status">{attachmentError}</div>
      )}
      <div className="input-buttons">
        <div className="input-buttons-left">
          <input
            ref={fileInputRef}
            className="input-file-picker"
            type="file"
            accept={ACCEPTED_IMAGE_EXTENSIONS}
            onChange={(e) => { void handleFileChange(e); }}
            tabIndex={-1}
          />
          <button
            className="btn-attach"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={status === 'streaming'}
            title="Attach a picture"
          >
            🖼
          </button>
          <VoiceInput
            e4bAvailable={e4bAvailable}
            greekTranscribeModel={greekTranscribeModel}
            transcribeModel={transcribeModel}
            codingModel={codingModel}
            onTranscription={(spokenText) => {
              sendWithCurrentAttachment(spokenText);
              setText('');
            }}
            disabled={status === 'streaming'}
          />
        </div>
        <div className="input-buttons-right">
          {ctxUsedPct > 0 && (
            <button
              className={meterClass}
              onClick={onClearContext}
              title={meterTitle}
            >
              {remaining}%
            </button>
          )}
          {status === 'streaming'
            ? <button className="btn-cancel" onClick={onCancel}>⏹ Stop</button>
            : <button className="btn-send" onClick={handleSend} disabled={!text.trim()}>Send ➤</button>
          }
        </div>
      </div>
    </div>
  );
}
