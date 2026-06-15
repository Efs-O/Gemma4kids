// Shared, dependency-free transcription helpers used by BOTH the renderer
// (OllamaService) and the main process (llamaSttRuntime). Keep this file pure —
// no Electron, DOM, or Node imports — so each esbuild target can bundle it.
// Extracted from byte-identical copies that previously lived in both files.

export function buildTranscribePrompt(languageHint?: string): string {
  const hint = (languageHint ?? '').trim().toLowerCase();
  if (hint.startsWith('el') && hint.includes('strict')) {
    return 'The spoken language is Greek (el-GR). Transcribe exactly what is spoken. Output only Greek script, spaces, digits, and normal punctuation. Never translate. Never transliterate. Never output Arabic script, Cyrillic script, or Latin transliteration unless a foreign word is unmistakably spoken. If unsure, prefer the most plausible Greek-script transcription. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('el')) {
    return 'The spoken language is most likely Greek (el-GR). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is Greek, return only Greek script. If a short foreign word is clearly spoken, keep that word exactly as spoken. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('de')) {
    return 'The spoken language is most likely German (de-DE). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is German, return only German text with normal German spelling. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  if (hint.startsWith('en')) {
    return 'The spoken language is most likely English (en). Transcribe exactly what is spoken. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages. If the speech is English, return only English text. If the speaker switches briefly to another language, keep those exact spoken words only where they were actually said. Output only the transcription text, with no newlines. Write numbers as digits.';
  }
  return 'Transcribe exactly what is spoken in the audio. First infer whether the speech is Greek, German, English, or another language. Keep the original language and script exactly as spoken. Reply with transcription only. Never translate. Never transliterate. Do not mix languages unless the speaker actually switches languages. If the speech is Greek, return Greek script. If the speech is German, return German spelling. If the speech is English, return English text. Output only the transcription text, with no newlines. Write numbers as digits.';
}

export function stripPromptEcho(text: string, languageHint?: string): string {
  const prompts = [
    buildTranscribePrompt(languageHint),
    buildTranscribePrompt('en'),
    buildTranscribePrompt('de'),
    buildTranscribePrompt('el'),
    buildTranscribePrompt(),
  ];

  let cleaned = text.trim();
  for (const prompt of prompts) {
    if (cleaned === prompt) {
      return '';
    }
    if (cleaned.startsWith(prompt)) {
      cleaned = cleaned.slice(prompt.length).trimStart();
    }
  }

  return cleaned.trim();
}

export function looksLikeTranscriptionRefusal(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;

  return [
    'does not contain audible speech',
    'cannot provide a transcription',
    'i cannot provide a transcription',
    'unable to provide a transcription',
    'no audible speech',
    'no speech detected',
    'there is no speech',
    'no spoken audio',
    'cannot transcribe',
    'unable to transcribe',
  ].some((snippet) => normalized.includes(snippet));
}
