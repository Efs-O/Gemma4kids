import React from 'react';
import type {
  PreparedAudioAttachment,
  PreparedImageAttachment,
  PreparedVideoAttachment,
} from '../services/MediaAttachmentService';
import { VIDEO_MAX_SECONDS } from '../services/MediaAttachmentService';

export interface ImageAttachmentListState {
  kind: 'images';
  items: PreparedImageAttachment[];
}

export interface AudioAttachmentState {
  kind: 'audio';
  item: PreparedAudioAttachment;
}

export interface VideoAttachmentState {
  kind: 'video';
  item: PreparedVideoAttachment;
}

export type AttachmentState = ImageAttachmentListState | AudioAttachmentState | VideoAttachmentState | null;

function AttachIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="M7 16l3.5-3.5a1.5 1.5 0 0 1 2.1 0L15 15l1-1a1.5 1.5 0 0 1 2.1 0L19 15" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 9v6h4l5 4V5L9 9H5Z" />
      <path d="M18 9a4 4 0 0 1 0 6" />
      <path d="M20.5 6.5a7 7 0 0 1 0 11" />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4" />
    </svg>
  );
}

function formatDuration(durationSeconds: number): string {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return '0:00';
  }
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function releaseAttachmentResources(attachment: AttachmentState) {
  if (attachment?.kind === 'images') {
    for (const item of attachment.items) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
}

interface Props {
  attachment: AttachmentState;
  controlsDisabled: boolean;
  previewFailures: string[];
  onPreviewFailure: (id: string) => void;
  onRemoveImage: (id: string) => void;
  onClearAttachment: () => void;
}

export function AttachmentPreview({
  attachment,
  controlsDisabled,
  previewFailures,
  onPreviewFailure,
  onRemoveImage,
  onClearAttachment,
}: Props) {
  if (!attachment) {
    return null;
  }

  if (attachment.kind === 'images') {
    return (
      <div className="input-attachment-strip">
        {attachment.items.map((item) => {
          const previewFailed = previewFailures.includes(item.id);
          return (
            <div className="input-attachment-card" key={item.id}>
              {previewFailed ? (
                <div className="input-attachment-fallback" aria-hidden="true">
                  <AttachIcon />
                </div>
              ) : (
                <img
                  className="input-attachment-thumb"
                  src={item.previewUrl}
                  alt={item.fileName}
                  onError={() => onPreviewFailure(item.id)}
                />
              )}
              <div className="input-attachment-meta">
                <div className="input-attachment-label">Picture ready</div>
                <div className="input-attachment-name" title={item.fileName}>{item.fileName}</div>
              </div>
              <button
                className="input-attachment-remove"
                type="button"
                onClick={() => onRemoveImage(item.id)}
                disabled={controlsDisabled}
                title="Remove picture"
              >
                x
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  if (attachment.kind === 'audio') {
    return (
      <div className="input-attachment-preview">
        <div className="input-attachment-fallback" aria-hidden="true">
          <SoundIcon />
        </div>
        <div className="input-attachment-meta">
          <div className="input-attachment-label">Sound ready</div>
          <div className="input-attachment-name" title={attachment.item.fileName}>{attachment.item.fileName}</div>
          <div className="input-attachment-detail">{formatDuration(attachment.item.durationSeconds)}</div>
        </div>
        <button
          className="input-attachment-remove"
          type="button"
          onClick={onClearAttachment}
          disabled={controlsDisabled}
          title="Remove sound file"
        >
          x
        </button>
      </div>
    );
  }

  return (
    <div className="input-attachment-preview">
      <img className="input-attachment-thumb" src={attachment.item.posterDataUrl} alt={attachment.item.fileName} />
      <div className="input-attachment-meta">
        <div className="input-attachment-label">Video ready — full clip sent to Gemma</div>
        <div className="input-attachment-name" title={attachment.item.fileName}>{attachment.item.fileName}</div>
        <div className="input-attachment-detail">
          {formatDuration(attachment.item.durationSeconds)} · up to {VIDEO_MAX_SECONDS}s · say what you want in the box · save_video_frame can export JPEGs
        </div>
      </div>
      <div className="input-attachment-video-icon" aria-hidden="true">
        <FilmIcon />
      </div>
      <button
        className="input-attachment-remove"
        type="button"
        onClick={onClearAttachment}
        disabled={controlsDisabled}
        title="Remove video"
      >
        x
      </button>
    </div>
  );
}
