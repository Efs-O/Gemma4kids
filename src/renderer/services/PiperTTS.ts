import type { TTSService } from './TTSService';

function detectLang(text: string): string {
  if (/[Ͱ-Ͽἀ-῿]/.test(text)) return 'el';
  if (/[äöüßÄÖÜ]/.test(text) ||
      /\b(ich|und|ist|das|nicht|eine|wir|hast|haben|kann|machen|auch|aber|dein|schau|sehr|jetzt|dann|hier|machst|bitte|klick|zeigt|zeige|füge|lass|probier)\b/i.test(text))
    return 'de';
  return 'en';
}

function stripForSpeech(text: string): string {
  return text
    // thinking / reasoning blocks (open-source model convention)
    .replace(/<think(?:ing)?[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, '')
    // fenced code blocks — replace with short spoken cue
    .replace(/```[\s\S]*?```/g, ' Your animation code is in the editor. ')
    // inline code — skip content, too noisy to read
    .replace(/`[^`]+`/g, '')
    // markdown links — keep label text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // HTML/XML tags
    .replace(/<[^>]+>/g, '')
    // emojis and pictographic symbols
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FE0F}]/gu, '')
    // remaining markdown syntax characters
    .replace(/[*_#>~|`]/g, '')
    // collapse whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export class PiperTTS implements TTSService {
  private _speaking = false;
  private _source: AudioBufferSourceNode | null = null;
  private _ctx: AudioContext | null = null;
  private _seq = 0;

  get speaking(): boolean { return this._speaking; }

  cancel(): void {
    this._seq++;
    if (this._source) {
      try { this._source.stop(); } catch { /* already stopped */ }
      this._source = null;
    }
    this._speaking = false;
  }

  async speak(text: string): Promise<void> {
    this.cancel();
    const seq = this._seq;
    const clean = stripForSpeech(text);
    if (!clean) return;

    this._speaking = true;
    try {
      const uint8 = await window.electronAPI.ttsSpeak(clean, detectLang(clean));
      if (this._seq !== seq) return;

      // Slice to own ArrayBuffer — avoids shared-pool issues from Node Buffer serialization
      const arrayBuffer = uint8.buffer.slice(uint8.byteOffset, uint8.byteOffset + uint8.byteLength);

      if (!this._ctx || this._ctx.state === 'closed') {
        this._ctx = new AudioContext();
      }
      const audioBuffer = await this._ctx.decodeAudioData(arrayBuffer as ArrayBuffer);
      if (this._seq !== seq) return;

      await new Promise<void>((resolve) => {
        const source = this._ctx!.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this._ctx!.destination);
        this._source = source;
        source.onended = () => {
          if (this._seq === seq) this._speaking = false;
          this._source = null;
          resolve();
        };
        source.start();
      });
    } catch {
      if (this._seq === seq) this._speaking = false;
    }
  }
}
