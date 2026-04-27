import { PiperTTS } from './PiperTTS';

export interface TTSService {
  speak(text: string): Promise<void>;
  cancel(): void;
  readonly speaking: boolean;
}

export function createTTSService(): TTSService {
  return new PiperTTS();
}
