import React, { useState, useRef, useCallback } from 'react';
import { transcribe } from '../services/OllamaService';

type VoiceState = 'idle' | 'recording' | 'transcribing' | 'error';

interface Props {
  e4bAvailable: boolean;
  transcribeModel: string;
  onTranscription: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInput({ e4bAvailable, transcribeModel, onTranscription, disabled }: Props) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const maxRecordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doTranscribe = useCallback(async (blob: Blob, attempt = 1) => {
    setVoiceState('transcribing');
    try {
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);

      const text = await transcribe(base64, transcribeModel);
      setVoiceState('idle');
      // ~2s delay lets VRAM clear before the coding model picks up.
      setTimeout(() => onTranscription(text), 2000);
    } catch (err) {
      console.error('[VoiceInput] transcription error (attempt', attempt, '):', err);
      if (attempt < 2) {
        // GGML crash retry after 8s
        setTimeout(() => { void doTranscribe(blob, attempt + 1); }, 8000);
      } else {
        setVoiceState('error');
        setTimeout(() => setVoiceState('idle'), 3000);
      }
    }
  }, [onTranscription, transcribeModel]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
        void doTranscribe(blob);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setVoiceState('recording');
      // Model card: audio max 30 seconds
      maxRecordTimerRef.current = setTimeout(() => { recorder.stop(); }, 30000);
    } catch {
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 3000);
    }
  }, [doTranscribe]);

  const stopRecording = useCallback(() => {
    if (maxRecordTimerRef.current) { clearTimeout(maxRecordTimerRef.current); maxRecordTimerRef.current = null; }
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

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
      <button className="btn-mic btn-mic-transcribing" disabled title="Thinking...">
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
