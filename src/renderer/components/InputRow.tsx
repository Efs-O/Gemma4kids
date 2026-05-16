import React, { useEffect, useRef, useState, KeyboardEvent, ChangeEvent, type MutableRefObject } from 'react';
import { VoiceInput } from './VoiceInput';
import {
  AttachmentPreview,
  releaseAttachmentResources,
  type AttachmentState,
} from './AttachmentPreview';
import {
  prepareAudioAttachment,
  prepareImageAttachment,
  prepareVideoAttachment,
  prepareVideoMessagePayload,
  readFileAsBase64,
} from '../services/MediaAttachmentService';
import type { LLMRuntimeAdapter } from '../services/OllamaService';
import { transcribeAudioBlobWithRuntime } from '../services/OllamaService';
import type { SendMessageInput } from '../hooks/useChat';
import type { AppLanguage } from './WelcomeScreen';

const ACCEPTED_IMAGE_EXTENSIONS = '.png,.jpg,.jpeg,.webp,.gif,.bmp,.heic,.heif';
const ACCEPTED_AUDIO_EXTENSIONS = '.wav,.mp3,.m4a,.aac,.ogg,.webm';
const ACCEPTED_VIDEO_EXTENSIONS = '.mp4,.m4v,.mov,.webm,.ogv';
const ACCEPTED_FILE_EXTENSIONS = `${ACCEPTED_IMAGE_EXTENSIONS},${ACCEPTED_AUDIO_EXTENSIONS},${ACCEPTED_VIDEO_EXTENSIONS}`;
const ACCEPTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const ACCEPTED_AUDIO_MIME_TYPES = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/webm'];
const ACCEPTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'video/ogg'];

function logRendererVideoPrep(scope: string, payload: unknown): void {
  void window.electronAPI.appendRendererDebugLog(scope, payload).catch(() => {
    // Logging should never block the UI path.
  });
}

interface Props {
  status: 'idle' | 'streaming' | 'error';
  onSend: (input: SendMessageInput) => void;
  onCancel: () => void;
  onVoiceActivityChange?: (active: boolean) => void;
  e4bAvailable: boolean;
  greekTranscribeModel: string | null;
  transcribeModel: string;
  voiceModelLabel: string;
  codingModel: string;
  runtimeAdapter: LLMRuntimeAdapter;
  ctxUsedPct?: number;
  onClearContext?: () => void;
  supportsVisualAttachments: boolean;
  /** Filled while a video attachment is active so Gemma's save_video_frame tool can read the File. */
  videoAttachmentFileRef?: MutableRefObject<File | null>;
  appLanguage: AppLanguage;
}

function AttachIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="M7 16l3.5-3.5a1.5 1.5 0 0 1 2.1 0L15 15l1-1a1.5 1.5 0 0 1 2.1 0L19 15" />
    </svg>
  );
}

function isAcceptedImage(file: File): boolean {
  return ACCEPTED_IMAGE_MIME_TYPES.includes(file.type) || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name);
}

const isAcceptedAudio = (file: File): boolean => ACCEPTED_AUDIO_MIME_TYPES.includes(file.type) || /\.(wav|mp3|m4a|aac|ogg|webm)$/i.test(file.name);
const isAcceptedVideo = (file: File): boolean => ACCEPTED_VIDEO_MIME_TYPES.includes(file.type) || /\.(mp4|m4v|mov|webm|ogv)$/i.test(file.name);

function buildImagePrompt(text: string, imageCount: number): string {
  const trimmed = text.trim();
  if (trimmed) return imageCount > 1 ? `${trimmed}\n\nThe attached pictures are in the same order the child picked them.` : trimmed;
  return imageCount > 1
    ? 'Please look at these pictures in the same order I picked them and help me with them.'
    : 'Please look at this picture and help me with it.';
}

function buildAudioPrompt(text: string, transcript: string): string {
  const trimmed = text.trim();
  return !trimmed ? transcript : `${trimmed}\n\nTranscript from the attached audio:\n${transcript}`;
}

function buildVideoPrompt(text: string, transcript: string | null): string {
  const trimmed = text.trim();
  const parts: string[] = [];
  if (trimmed) {
    parts.push(trimmed);
  } else {
    parts.push('Please help me with my short video.');
  }
  if (transcript) {
    parts.push(`Spoken audio transcript:\n${transcript}`);
  }
  return parts.join('\n\n');
}

export function InputRow({
  status,
  onSend,
  onCancel,
  onVoiceActivityChange,
  e4bAvailable,
  greekTranscribeModel,
  transcribeModel,
  voiceModelLabel,
  codingModel,
  runtimeAdapter,
  ctxUsedPct = 0,
  onClearContext,
  supportsVisualAttachments,
  videoAttachmentFileRef,
  appLanguage,
}: Props) {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<AttachmentState>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [previewFailures, setPreviewFailures] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [awaitingSendResult, setAwaitingSendResult] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previousStatusRef = useRef(status);
  const attachmentRef = useRef<AttachmentState>(null);

  useEffect(() => {
    attachmentRef.current = attachment;
  }, [attachment]);

  useEffect(() => {
    if (!videoAttachmentFileRef) return;
    videoAttachmentFileRef.current = attachment?.kind === 'video' ? attachment.item.file : null;
  }, [attachment, videoAttachmentFileRef]);

  useEffect(() => {
    if (supportsVisualAttachments || !attachment || attachment.kind === 'audio') return;
    releaseAttachmentResources(attachment);
    setAttachment(null);
    setPreviewFailures([]);
    setAwaitingSendResult(false);
    setAttachmentError('Pictures and video need the Ollama runtime.');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [attachment, supportsVisualAttachments]);

  useEffect(() => () => {
    releaseAttachmentResources(attachmentRef.current);
  }, []);
  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    if (awaitingSendResult && previousStatus === 'streaming' && status === 'idle') {
      const shouldPersistAttachment = attachment?.kind === 'video';
      if (!shouldPersistAttachment) {
        releaseAttachmentResources(attachment);
        setAttachment(null);
        setPreviewFailures([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
      setAttachmentError('');
      setAwaitingSendResult(false);
    }
    if (awaitingSendResult && previousStatus === 'streaming' && status === 'error') setAwaitingSendResult(false);
    previousStatusRef.current = status;
  }, [attachment, awaitingSendResult, status]);

  function replaceAttachment(nextAttachment: AttachmentState) {
    releaseAttachmentResources(attachment);
    setAttachment(nextAttachment);
    setPreviewFailures([]);
    setAttachmentError('');
  }

  function clearAttachment() {
    releaseAttachmentResources(attachment);
    setAttachment(null);
    setPreviewFailures([]);
    setAttachmentError('');
    setAwaitingSendResult(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function canSendCurrentInput(messageText: string = text): boolean {
    return messageText.trim().length > 0 || attachment !== null;
  }

  async function handleImageSelection(files: File[]) {
    const prepared = await Promise.all(files.map((file) => prepareImageAttachment(file)));
    replaceAttachment({ kind: 'images', items: prepared });
  }

  async function handleAudioSelection(file: File) {
    const prepared = await prepareAudioAttachment(file);
    replaceAttachment({ kind: 'audio', item: prepared });
  }

  async function handleVideoSelection(file: File) {
    logRendererVideoPrep('handleVideoSelection:start', { fileName: file.name, type: file.type, size: file.size });
    const prepared = await prepareVideoAttachment(file);
    logRendererVideoPrep('handleVideoSelection:ready', { fileName: file.name, durationSeconds: prepared.durationSeconds });
    replaceAttachment({ kind: 'video', item: prepared });
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const imageFiles = files.filter(isAcceptedImage);
    const audioFiles = files.filter(isAcceptedAudio);
    const videoFiles = files.filter(isAcceptedVideo);
    const requestedVisualAttachment = imageFiles.length > 0 || videoFiles.length > 0;

    if (imageFiles.length + audioFiles.length + videoFiles.length !== files.length) {
      setAttachmentError('Pick pictures, one sound file, or one short video.');
      return;
    }
    if (requestedVisualAttachment && !supportsVisualAttachments) {
      setAttachmentError('Pictures and video work only with the Ollama runtime.');
      return;
    }
    if (audioFiles.length > 0 && (imageFiles.length > 0 || videoFiles.length > 0)) {
      setAttachmentError('Pick pictures together, or one sound file, or one short video.');
      return;
    }
    if (videoFiles.length > 0 && (imageFiles.length > 0 || audioFiles.length > 0)) {
      setAttachmentError('Pick pictures together, or one sound file, or one short video.');
      return;
    }
    if (audioFiles.length > 1) {
      setAttachmentError('Please pick one sound file at a time.');
      return;
    }
    if (videoFiles.length > 1) {
      setAttachmentError('Please pick one short video at a time.');
      return;
    }

    setPreparing(true);
    setAttachmentError('');
    logRendererVideoPrep('fileChange:start', {
      totalFiles: files.length,
      imageCount: imageFiles.length,
      audioCount: audioFiles.length,
      videoCount: videoFiles.length,
    });
    try {
      if (imageFiles.length > 0) {
        await handleImageSelection(imageFiles);
      } else if (audioFiles.length === 1) {
        await handleAudioSelection(audioFiles[0]);
      } else if (videoFiles.length === 1) {
        await handleVideoSelection(videoFiles[0]);
      }
    } catch (error) {
      logRendererVideoPrep('fileChange:error', error instanceof Error ? { message: error.message, stack: error.stack ?? null } : String(error));
      setAttachmentError(error instanceof Error ? error.message : 'That file could not be prepared here.');
    } finally {
      logRendererVideoPrep('fileChange:done', {});
      setPreparing(false);
    }
  }

  async function buildAttachmentPayload(messageText: string): Promise<Exclude<SendMessageInput, string> | null> {
    if (!attachment) {
      const trimmed = messageText.trim();
      return trimmed ? { text: trimmed } : null;
    }

    const activeTranscribeModel =
      appLanguage === 'el' && greekTranscribeModel
        ? greekTranscribeModel
        : transcribeModel;

    if (attachment.kind === 'images') {
      if (!supportsVisualAttachments) {
        throw new Error('Pictures need the Ollama runtime.');
      }
      return {
        text: buildImagePrompt(messageText, attachment.items.length),
        images: attachment.items.map((item) => item.base64),
        hasAttachment: true,
      };
    }

    if (attachment.kind === 'audio') {
      const transcript = await transcribeAudioBlobWithRuntime(
        runtimeAdapter,
        attachment.item.file,
        activeTranscribeModel,
        0,
        appLanguage,
      );
      return {
        text: buildAudioPrompt(messageText, transcript.text),
        hasAttachment: true,
      };
    }

    if (!supportsVisualAttachments) {
      throw new Error('Video needs the Ollama runtime.');
    }
    logRendererVideoPrep('buildPayload:video:start', {
      fileName: attachment.item.fileName,
      durationSeconds: attachment.item.durationSeconds,
      messageText,
    });
    const preparedVideo = await prepareVideoMessagePayload(
      attachment.item.file,
      attachment.item.durationSeconds,
    );
    const videoBase64 = await readFileAsBase64(
      attachment.item.file,
      'That video file could not be attached here.',
    );
    logRendererVideoPrep('buildPayload:video:frames-ready', {
      frameCount: preparedVideo.frames.length,
      hasAudio: Boolean(preparedVideo.audioWavBase64),
      warning: preparedVideo.warning ?? null,
    });
    if (preparedVideo.warning || preparedVideo.audioWavBase64) {
      setAttachmentError('Gemma will use the sampled video pictures first. Audio words are skipped for now.');
    }

    return {
      text: buildVideoPrompt(messageText, null),
      images: preparedVideo.frames,
      videos: [videoBase64],
      hasAttachment: true,
      contextNote: 'The original short video file is attached for tool use. If the child asks to save or export frames, use save_video_frame and do not ask to upload the video again.',
    };
  }

  async function submitCurrentInput(messageText: string) {
    if (!canSendCurrentInput(messageText) || status === 'streaming' || preparing) {
      return;
    }

    setPreparing(true);
    setAttachmentError('');
    logRendererVideoPrep('submit:start', {
      hasAttachment: attachment !== null,
      attachmentKind: attachment?.kind ?? null,
      textLength: messageText.trim().length,
    });
    try {
      const payload = await buildAttachmentPayload(messageText);
      if (!payload) {
        logRendererVideoPrep('submit:no-payload', {});
        return;
      }
      logRendererVideoPrep('submit:onSend', {
        hasImages: Array.isArray(payload.images) ? payload.images.length : 0,
        hasVideos: Array.isArray(payload.videos) ? payload.videos.length : 0,
        hasAttachment: typeof payload === 'string' ? false : payload.hasAttachment === true,
      });
      onSend(
        payload.images?.length || payload.videos?.length || payload.hasAttachment ? payload : payload.text,
      );
      setText('');
      if (attachment) {
        setAwaitingSendResult(true);
      }
    } catch (error) {
      logRendererVideoPrep('submit:error', error instanceof Error ? { message: error.message, stack: error.stack ?? null } : String(error));
      setAttachmentError(error instanceof Error ? error.message : 'That file could not be sent yet.');
    } finally {
      logRendererVideoPrep('submit:done', {});
      setPreparing(false);
    }
  }

  function handleSend() {
    void submitCurrentInput(text);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Attachment-only send must use the Send button — Enter avoids accidental Ollama runs after picking a file.
      if (status !== 'streaming' && !preparing && text.trim().length > 0) {
        handleSend();
      }
    }
  }

  const remaining = 100 - ctxUsedPct;
  const meterClass = remaining > 50 ? 'ctx-meter ctx-meter-green'
    : remaining > 20 ? 'ctx-meter ctx-meter-orange'
    : 'ctx-meter ctx-meter-red';
  const meterTitle = remaining > 50 ? 'Fresh chat — click to start over'
    : remaining > 20 ? 'Chat is getting long — click to start fresh!'
    : 'Chat is too long! Click here to start fresh 🔄';
  const meterFill = remaining > 50
    ? `linear-gradient(to right, #16a34a ${ctxUsedPct}%, #bbf7d0 ${ctxUsedPct}%)`
    : remaining > 20
    ? `linear-gradient(to right, #ea580c ${ctxUsedPct}%, #fed7aa ${ctxUsedPct}%)`
    : `linear-gradient(to right, #dc2626 ${ctxUsedPct}%, #fecaca ${ctxUsedPct}%)`;
  const controlsDisabled = status === 'streaming' || preparing;
  const sendLabel = preparing ? 'Preparing...' : 'Send';
  const acceptedFileExtensions = supportsVisualAttachments ? ACCEPTED_FILE_EXTENSIONS : ACCEPTED_AUDIO_EXTENSIONS;
  const attachTitle = supportsVisualAttachments
    ? 'Attach pictures, one sound file, or one short video'
    : 'Attach one sound file';

  return (
    <div className="input-row">
      <AttachmentPreview
        attachment={attachment}
        controlsDisabled={controlsDisabled}
        previewFailures={previewFailures}
        onPreviewFailure={(id) => {
          setPreviewFailures((current) => current.includes(id) ? current : [...current, id]);
        }}
        onRemoveImage={(id) => {
          if (attachment?.kind !== 'images') return;
          const removedItem = attachment.items.find((candidate) => candidate.id === id);
          const nextItems = attachment.items.filter((candidate) => candidate.id !== id);
          if (removedItem) {
            URL.revokeObjectURL(removedItem.previewUrl);
          }
          setPreviewFailures((current) => current.filter((currentId) => currentId !== id));
          if (nextItems.length === 0) {
            clearAttachment();
          } else {
            setAttachment({ kind: 'images', items: nextItems });
          }
        }}
        onClearAttachment={clearAttachment}
      />

      <textarea
        className="input-textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask Gemma to make something fun... (Enter sends when you typed text; use Send for an attachment only)"
        rows={3}
        disabled={controlsDisabled}
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
            accept={acceptedFileExtensions}
            multiple
            onChange={(e) => { void handleFileChange(e); }}
            tabIndex={-1}
          />
          <button
            className="btn-attach"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={controlsDisabled}
            title={attachTitle}
          >
            <AttachIcon />
          </button>
          <VoiceInput
            e4bAvailable={e4bAvailable}
            greekTranscribeModel={greekTranscribeModel}
            transcribeModel={transcribeModel}
            voiceModelLabel={voiceModelLabel}
            codingModel={codingModel}
            runtimeAdapter={runtimeAdapter}
            onVoiceActivityChange={onVoiceActivityChange}
            onTranscription={(spokenText) => {
              void submitCurrentInput(spokenText);
            }}
            disabled={controlsDisabled}
            appLanguage={appLanguage}
          />
        </div>
        <div className="input-buttons-right">
          {onClearContext && (
            <button
              className={meterClass}
              onClick={onClearContext}
              title={meterTitle}
              style={{ background: meterFill }}
            >
              New Chat
            </button>
          )}
          {status === 'streaming'
            ? <button className="btn-cancel" onClick={onCancel}>Stop</button>
            : <button className="btn-send" onClick={handleSend} disabled={!canSendCurrentInput() || preparing}>{sendLabel}</button>
          }
        </div>
      </div>
    </div>
  );
}
