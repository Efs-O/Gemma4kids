import React, { useState, useRef, useCallback, useEffect } from 'react';
import { audioBlobToWav16k, transcribe } from '../services/OllamaService';

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error';

function estimateWarmKeepAlive(durationSeconds: number): string {
  const seconds = Math.max(15, Math.min(45, Math.ceil(durationSeconds * 2 + 5)));
  return `${seconds}s`;
}

interface Props {
  e4bAvailable: boolean;
  transcribeModel: string;
  codingModel: string;
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInput({ e4bAvailable, transcribeModel, codingModel, onTranscription, disabled }: Props) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deliverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const encoded = await audioBlobToWav16k(blob);
      const keepAlive = transcribeModel === codingModel
        ? estimateWarmKeepAlive(encoded.durationSeconds)
        : 0;
      const text = await transcribe(encoded.audioBase64, transcribeModel, keepAlive);
      setVoiceStateSafe('idle');
      // Short delay gives E4B a moment to release VRAM before the coding model starts.
      clearTimer(deliverTimerRef);
      deliverTimerRef.current = setTimeout(() => {
        deliverTimerRef.current = null;
        if (mountedRef.current) {
          onTranscription(text);
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
  }, [clearTimer, codingModel, onTranscription, setVoiceStateSafe, transcribeModel]);

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

  if (!e4bAvailable) {
    return (
      <button
        className="btn-mic btn-mic-disabled"
        title="Install gemma4:e4b to use voice input"
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
    <button
      className="btn-mic"
      onClick={() => { void startRecording(); }}
      disabled={disabled}
      title="Speak your idea!"
    >
      🎤
    </button>
  );
}
