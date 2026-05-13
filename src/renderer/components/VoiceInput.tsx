import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { LLMRuntimeAdapter } from '../services/OllamaService';
import { audioBlobToWav16k } from '../services/OllamaService';
import type { AppLanguage } from './WelcomeScreen';
import { detectLang } from '../services/PiperTTS';

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error';

function estimateWarmKeepAlive(durationSeconds: number): string {
  const seconds = Math.max(15, Math.min(45, Math.ceil(durationSeconds * 2 + 5)));
  return `${seconds}s`;
}

function previewText(text: string, max = 140): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
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
  codingModel: string;
  runtimeAdapter: LLMRuntimeAdapter;
  onTranscription: (text: string) => void;
  onVoiceActivityChange?: (active: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  appLanguage: AppLanguage;
}

export function VoiceInput({ e4bAvailable, greekTranscribeModel, transcribeModel, codingModel, runtimeAdapter, onTranscription, onVoiceActivityChange, disabled, disabledReason, appLanguage }: Props) {
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
      const encoded = await audioBlobToWav16k(blob, { gainMultiplier: 1.1 });
      const activeTranscribeModel =
        appLanguage === 'el' && greekTranscribeModel
          ? greekTranscribeModel
          : transcribeModel;
      const keepAlive = activeTranscribeModel === codingModel
        ? estimateWarmKeepAlive(encoded.durationSeconds)
        : 0;
      const languageHintForSTT = appLanguage;
      console.info('[voice:transcribe:selected-model]', {
        attempt,
        appLanguage,
        languageHintForSTT,
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
  }, [clearTimer, codingModel, greekTranscribeModel, onTranscription, runtimeAdapter, setVoiceStateSafe, transcribeModel]);

  const startRecording = useCallback(async () => {
    try {
      clearAllTimers();
      ignoreStopRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        mediaRecorderRef.current = null;
        clearTimer(maxRecordTimerRef);
        stopActiveStream();
        if (ignoreStopRef.current) {
          ignoreStopRef.current = false;
          return;
        }
        const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
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
    } catch {
      stopActiveStream();
      setVoiceStateSafe('error');
      clearTimer(errorResetTimerRef);
      errorResetTimerRef.current = setTimeout(() => {
        errorResetTimerRef.current = null;
        setVoiceStateSafe('idle');
      }, 3000);
    }
  }, [clearAllTimers, clearTimer, doTranscribe, setVoiceStateSafe, stopActiveStream]);

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
