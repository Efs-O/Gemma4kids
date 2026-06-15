import { useEffect, useRef } from 'react';

const MUSIC_TRACK_SRC = './Glassroom Pulse.mp3';
const MUSIC_VOLUME_NORMAL = 0.35;
const MUSIC_FADE_OUT_DELAY_MS = 150;  // brief pause before fade starts when mic opens
const MUSIC_FADE_OUT_MS = 300;        // time to reach 0
const MUSIC_FADE_IN_MS = 500;         // time to ramp back to normal after mic closes
const MUSIC_FADE_STEP_MS = 16;        // ~60 fps

interface Params {
  musicEnabled: boolean;
  voiceActive: boolean;
  workspaceScreenVisible: boolean;
  hasEnteredWorkspace: boolean;
  /** Surface a kid-friendly playback error (or '' to clear). */
  setUiError: (message: string) => void;
}

/**
 * Background music playback with retry, mic-aware volume fade, and teardown.
 * Extracted verbatim from App.tsx — identical track, volume, fade timings, retry
 * schedule, and effect dependencies. `setUiError` is read through a ref so its
 * identity never re-triggers the play effect (matching the original).
 */
export function useBackgroundMusic({
  musicEnabled,
  voiceActive,
  workspaceScreenVisible,
  hasEnteredWorkspace,
  setUiError,
}: Params): void {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const musicFadeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const musicFadeDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setUiErrorRef = useRef(setUiError);
  setUiErrorRef.current = setUiError;

  useEffect(() => {
    if (musicRetryTimeoutRef.current) {
      clearTimeout(musicRetryTimeoutRef.current);
      musicRetryTimeoutRef.current = null;
    }
    const shouldHoldMusic = workspaceScreenVisible && hasEnteredWorkspace;
    if (!musicEnabled || !shouldHoldMusic) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      return;
    }

    const audio = audioRef.current ?? new Audio(MUSIC_TRACK_SRC);
    audioRef.current = audio;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = MUSIC_VOLUME_NORMAL;

    let cancelled = false;

    const handleError = () => {
      if (cancelled) return;
      audio.pause();
      audio.currentTime = 0;
      setUiErrorRef.current('I could not play the background music yet. Make sure "Glassroom Pulse.mp3" is in the app bundle and try again.');
    };

    const tryPlay = (attempt: number) => {
      if (cancelled) return;
      const playPromise = audio.play();
      if (!playPromise) return;
      void playPromise.then(() => {
        if (cancelled) return;
        setUiErrorRef.current('');
      }).catch(() => {
        if (cancelled) return;
        if (attempt >= 4) {
          handleError();
          return;
        }
        musicRetryTimeoutRef.current = setTimeout(() => {
          tryPlay(attempt + 1);
        }, attempt === 0 ? 250 : 1000);
      });
    };

    const handleCanPlay = () => {
      tryPlay(0);
    };

    audio.addEventListener('error', handleError);
    audio.addEventListener('canplaythrough', handleCanPlay);
    audio.load();
    tryPlay(0);

    return () => {
      cancelled = true;
      if (musicRetryTimeoutRef.current) {
        clearTimeout(musicRetryTimeoutRef.current);
        musicRetryTimeoutRef.current = null;
      }
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('canplaythrough', handleCanPlay);
    };
  }, [hasEnteredWorkspace, musicEnabled, workspaceScreenVisible]);

  useEffect(() => {
    if (!audioRef.current || !musicEnabled) return;
    const audio = audioRef.current;
    if (musicFadeIntervalRef.current) { clearInterval(musicFadeIntervalRef.current); musicFadeIntervalRef.current = null; }
    if (musicFadeDelayRef.current) { clearTimeout(musicFadeDelayRef.current); musicFadeDelayRef.current = null; }
    if (voiceActive) {
      musicFadeDelayRef.current = setTimeout(() => {
        const steps = Math.round(MUSIC_FADE_OUT_MS / MUSIC_FADE_STEP_MS);
        const decrement = audio.volume / steps;
        musicFadeIntervalRef.current = setInterval(() => {
          const next = Math.max(0, audio.volume - decrement);
          audio.volume = next;
          if (next <= 0) { clearInterval(musicFadeIntervalRef.current!); musicFadeIntervalRef.current = null; }
        }, MUSIC_FADE_STEP_MS);
      }, MUSIC_FADE_OUT_DELAY_MS);
    } else {
      const start = audio.volume;
      const steps = Math.round(MUSIC_FADE_IN_MS / MUSIC_FADE_STEP_MS);
      const increment = (MUSIC_VOLUME_NORMAL - start) / steps;
      musicFadeIntervalRef.current = setInterval(() => {
        const next = Math.min(MUSIC_VOLUME_NORMAL, audio.volume + increment);
        audio.volume = next;
        if (next >= MUSIC_VOLUME_NORMAL) { clearInterval(musicFadeIntervalRef.current!); musicFadeIntervalRef.current = null; }
      }, MUSIC_FADE_STEP_MS);
    }
  }, [musicEnabled, voiceActive]);

  useEffect(() => () => {
    if (musicFadeIntervalRef.current) { clearInterval(musicFadeIntervalRef.current); musicFadeIntervalRef.current = null; }
    if (musicFadeDelayRef.current) { clearTimeout(musicFadeDelayRef.current); musicFadeDelayRef.current = null; }
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, []);
}
