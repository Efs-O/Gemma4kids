import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { LLMRuntimeAdapter } from '../services/OllamaService';
import { audioBlobToWav16k } from '../services/OllamaService';
import type { AppLanguage } from './WelcomeScreen';
import { detectLang } from '../services/PiperTTS';
import { normalizeOllamaModelRef } from '../utils/pickCodingModel';

type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error';


function previewText(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

function isExactGemma4E4b(name: string): boolean {
  return normalizeOllamaModelRef(name).toLowerCase() === 'gemma4:e4b';
}

function logVoice(scope: string, payload: unknown): void {
  void window.electronAPI.appendRendererDebugLog(`voice:${scope}`, payload).catch(() => {
    // Logging should never block voice input.
  });
}

function pickRecorderMimeType(): string | undefined {
  const options = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  for (const option of options) {
    if (MediaRecorder.isTypeSupported(option)) {
      return option;
    }
  }

  return undefined;
}

const MISMATCH_HINTS: Partial<Record<AppLanguage, string>> = {
  en: 'I heard English! 🇬🇧 Restart to change language.',
  de: 'Ich hörte Deutsch! 🇩🇪 Neustart zum Wechseln.',
  el: 'Άκουσα Ελληνικά! 🇬🇷 Επανεκκίνηση για αλλαγή γλώσσας.',
};

interface Props {
  e4bAvailable: boolean;
  greekTranscribeModel: string | null;
  transcribeModel: string;
  voiceModelLabel: string;
  codingModel: string;
  runtimeAdapter: LLMRuntimeAdapter;
  onTranscription: (text: string) => void;
  onVoiceActivityChange?: (active: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  appLanguage: AppLanguage;
}

export function VoiceInput({ e4bAvailable, greekTranscribeModel, transcribeModel, voiceModelLabel, codingModel, runtimeAdapter, onTranscription, onVoiceActivityChange, disabled, disabledReason, appLanguage }: Props) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [mismatchHint, setMismatchHint] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deliverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mismatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startInFlightRef = useRef(false);
  const ignoreStopRef = useRef(false);
  const mountedRef = useRef(true);

  const clearTimer = useCallback((timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearTimer(maxRecordTimerRef);
    clearTimer(retryTimerRef);
    clearTimer(deliverTimerRef);
    clearTimer(errorResetTimerRef);
    clearTimer(mismatchTimerRef);
  }, [clearTimer]);

  const stopActiveStream = useCallback(() => {
    activeStreamRef.current?.getTracks().forEach((track) => track.stop());
    activeStreamRef.current = null;
  }, []);

  const setVoiceStateSafe = useCallback((next: VoiceState) => {
    if (mountedRef.current) {
      setVoiceState(next);
    }
  }, []);

  const doTranscribe = useCallback(async (blob: Blob, attempt = 1) => {
    setVoiceStateSafe('transcribing');
    try {
      logVoice('transcribe:start', {
        attempt,
        blobType: blob.type,
        blobSize: blob.size,
      });
      const encoded = await audioBlobToWav16k(blob, { gainMultiplier: 1.1 });
      const activeTranscribeModel =
        appLanguage === 'el' && greekTranscribeModel
          ? greekTranscribeModel
          : transcribeModel;
      const keepAlive: -1 | 0 | string = isExactGemma4E4b(activeTranscribeModel) && isExactGemma4E4b(codingModel)
        ? -1
        : 0;
      const languageHintForSTT = appLanguage;
      console.info('[voice:transcribe:selected-model]', {
        attempt,
        runtime: runtimeAdapter.runtime,
        appLanguage,
        languageHintForSTT,
        activeVoiceModelLabel: voiceModelLabel,
        activeTranscribeModel,
        codingModel,
        keepAlive,
        durationSeconds: Number(encoded.durationSeconds.toFixed(2)),
      });
      logVoice('transcribe:selected-model', {
        attempt,
        runtime: runtimeAdapter.runtime,
        appLanguage,
        languageHintForSTT,
        activeVoiceModelLabel: voiceModelLabel,
        activeTranscribeModel,
        codingModel,
        keepAlive,
        durationSeconds: Number(encoded.durationSeconds.toFixed(2)),
      });
      if (!runtimeAdapter.transcribe) {
        throw new Error('Voice input is not available for the selected runtime.');
      }
      const text = await runtimeAdapter.transcribe(encoded.audioBase64, activeTranscribeModel, keepAlive, languageHintForSTT);
      console.info('[voice:transcribe:deliver]', {
        attempt,
        languageHintForSTT,
        activeTranscribeModel,
        textPreview: previewText(text),
      });
      logVoice('transcribe:done', {
        attempt,
        languageHintForSTT,
        activeTranscribeModel,
        textPreview: previewText(text),
      });
      setVoiceStateSafe('idle');
      // Short delay gives E4B a moment to release VRAM before the coding model starts.
      clearTimer(deliverTimerRef);
      deliverTimerRef.current = setTimeout(() => {
        deliverTimerRef.current = null;
        if (mountedRef.current) {
          onTranscription(text);
          if (text.trim().length > 8) {
            const detected = detectLang(text) as AppLanguage;
            if (detected !== appLanguage) {
              const hint = MISMATCH_HINTS[detected] ?? null;
              if (hint) {
                if (mismatchTimerRef.current) clearTimeout(mismatchTimerRef.current);
                setMismatchHint(hint);
                mismatchTimerRef.current = setTimeout(() => {
                  mismatchTimerRef.current = null;
                  setMismatchHint(null);
                }, 4000);
              }
            }
          }
        }
      }, 200);
    } catch (err) {
      console.error('[VoiceInput] transcription error (attempt', attempt, '):', err);
      logVoice('transcribe:error', err instanceof Error ? {
        attempt,
        message: err.message,
        stack: err.stack ?? null,
      } : { attempt, error: String(err) });
      if (attempt < 2) {
        // GGML crash retry after 8s
        clearTimer(retryTimerRef);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (mountedRef.current) {
            void doTranscribe(blob, attempt + 1);
          }
        }, 8000);
      } else {
        setVoiceStateSafe('error');
        clearTimer(errorResetTimerRef);
        errorResetTimerRef.current = setTimeout(() => {
          errorResetTimerRef.current = null;
          setVoiceStateSafe('idle');
        }, 3000);
      }
    }
  }, [clearTimer, codingModel, greekTranscribeModel, onTranscription, runtimeAdapter, setVoiceStateSafe, transcribeModel, appLanguage, voiceModelLabel]);

  const startRecording = useCallback(async () => {
    if (startInFlightRef.current || voiceState === 'recording' || voiceState === 'transcribing') {
      return;
    }

    startInFlightRef.current = true;
    try {
      clearAllTimers();
      ignoreStopRef.current = false;
      setVoiceStateSafe('requesting');
      logVoice('start:requesting', {
        runtime: runtimeAdapter.runtime,
        appLanguage,
      });
      const micAccess = await window.electronAPI.requestMicrophoneAccess();
      logVoice('start:mic-access', micAccess);
      if (!micAccess.granted) {
        throw new Error(`Microphone access ${micAccess.status}.`);
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        logVoice('start:get-user-media-success', {
          audioTrackCount: stream.getAudioTracks().length,
        });
      } catch (error) {
        logVoice('start:get-user-media-error', error instanceof Error ? {
          message: error.message,
          name: error.name,
          stack: error.stack ?? null,
        } : { error: String(error) });
        throw error;
      }
      activeStreamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        logVoice('start:media-recorder-success', {
          requestedMimeType: mimeType ?? 'default',
          recorderMimeType: recorder.mimeType || 'default',
          state: recorder.state,
        });
      } catch (error) {
        logVoice('start:media-recorder-error', error instanceof Error ? {
          message: error.message,
          name: error.name,
          stack: error.stack ?? null,
          requestedMimeType: mimeType ?? 'default',
        } : { error: String(error), requestedMimeType: mimeType ?? 'default' });
        throw error;
      }
      logVoice('start:stream-ready', {
        mimeType: mimeType ?? 'default',
        recorderMimeType: recorder.mimeType || 'default',
        trackStates: stream.getAudioTracks().map((track) => ({
          kind: track.kind,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
        })),
      });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onerror = (event) => {
        logVoice('start:recorder-error', {
          errorName: event.error?.name ?? 'unknown',
          errorMessage: event.error?.message ?? 'unknown',
        });
      };
      recorder.onstop = () => {
        mediaRecorderRef.current = null;
        clearTimer(maxRecordTimerRef);
        stopActiveStream();
        if (ignoreStopRef.current) {
          ignoreStopRef.current = false;
          return;
        }
        const chunkBytes = chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
        logVoice('stop:chunks-ready', {
          chunkCount: chunksRef.current.length,
          chunkBytes,
          recorderMimeType: recorder.mimeType || 'default',
        });
        if (chunksRef.current.length === 0 || chunkBytes === 0) {
          setVoiceStateSafe('error');
          clearTimer(errorResetTimerRef);
          errorResetTimerRef.current = setTimeout(() => {
            errorResetTimerRef.current = null;
            setVoiceStateSafe('idle');
          }, 3000);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm' });
        void doTranscribe(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setVoiceStateSafe('recording');
      // Model card: audio max 30 seconds
      maxRecordTimerRef.current = setTimeout(() => {
        maxRecordTimerRef.current = null;
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, 30000);
    } catch (error) {
      logVoice('start:catch', error instanceof Error ? {
        message: error.message,
        name: error.name,
        stack: error.stack ?? null,
      } : { error: String(error) });
      stopActiveStream();
      setVoiceStateSafe('error');
      clearTimer(errorResetTimerRef);
      errorResetTimerRef.current = setTimeout(() => {
        errorResetTimerRef.current = null;
        setVoiceStateSafe('idle');
      }, 3000);
    } finally {
      startInFlightRef.current = false;
    }
  }, [clearAllTimers, clearTimer, doTranscribe, setVoiceStateSafe, stopActiveStream, voiceState]);

  const stopRecording = useCallback(() => {
    clearTimer(maxRecordTimerRef);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    stopActiveStream();
  }, [clearTimer, stopActiveStream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ignoreStopRef.current = true;
      startInFlightRef.current = false;
      clearAllTimers();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      mediaRecorderRef.current = null;
      stopActiveStream();
    };
  }, [clearAllTimers, stopActiveStream]);

  useEffect(() => {
    onVoiceActivityChange?.(voiceState !== 'idle');
  }, [onVoiceActivityChange, voiceState]);

  if (!e4bAvailable) {
    return (
      <button
        className="btn-mic btn-mic-disabled"
        title={disabledReason ?? 'Voice unavailable: install gemma4:latest or gemma4:e4b in Ollama, or place the mmproj .gguf next to your model when using llama.cpp'}
        disabled
      >
        🎤
      </button>
    );
  }

  if (voiceState === 'recording') {
    return (
      <button className="btn-mic btn-mic-recording" onClick={stopRecording} title="Stop recording">
        ⏹
      </button>
    );
  }

  if (voiceState === 'requesting') {
    return (
      <button className="btn-mic btn-mic-transcribing" disabled title="Waiting for microphone access...">
        β³
      </button>
    );
  }

  if (voiceState === 'transcribing') {
    return (
      <button className="btn-mic btn-mic-transcribing" disabled title="Converting speech to text...">
        ⏳
      </button>
    );
  }

  if (voiceState === 'error') {
    return (
      <button className="btn-mic btn-mic-error" disabled title="Voice error, retrying...">
        ❌
      </button>
    );
  }

  return (
    <>
      {mismatchHint && (
        <div className="voice-mismatch-hint" role="status">{mismatchHint}</div>
      )}
      <button
        className="btn-mic"
        onClick={() => { void startRecording(); }}
        disabled={disabled}
        title="Speak your idea!"
      >
        🎤
      </button>
    </>
  );
}
