/** Strip optional registry path so "host/gemma4:e4b" becomes "gemma4:e4b". */
export function normalizeOllamaModelRef(name: string): string {
  const t = name.trim();
  const slash = t.lastIndexOf('/');
  return slash >= 0 ? t.slice(slash + 1) : t;
}

/** True for Gemma 4 edge E4B tags (gemma4:e4b, gemma4:e4b-it-...). */
export function isGemma4EdgeE4b(name: string): boolean {
  const n = normalizeOllamaModelRef(name);
  return /^gemma4:e4b(?:$|[-.])/i.test(n);
}

/** True for Gemma 4 edge E2B tags (gemma4:e2b, gemma4:e2b-it-...). Lightest option for older GPUs. */
export function isGemma4EdgeE2b(name: string): boolean {
  const n = normalizeOllamaModelRef(name);
  return /^gemma4:e2b(?:$|[-.])/i.test(n);
}

/** True for Gemma 4 26B workstation / MoE tags. */
export function isGemma426b(name: string): boolean {
  const n = normalizeOllamaModelRef(name);
  return /^gemma4:26b(?:$|[-.])/i.test(n);
}

/** True for Gemma 4 31B tags (gemma4:31b, gemma4:31b-it-...). */
export function isGemma431b(name: string): boolean {
  const n = normalizeOllamaModelRef(name);
  return /^gemma4:31b(?:$|[-.])/i.test(n);
}

/**
 * Auto-select best available coding model: 31B > 26B > E4B > E2B > any gemma > first.
 * When tags are still loading, callers may pass [] -- default to 31B tag.
 */
export function pickCodingModel(models: string[]): string {
  if (models.length === 0) return 'gemma4:31b';
  const g31 = models.find(isGemma431b);
  if (g31) return g31;
  const g26 = models.find(isGemma426b);
  if (g26) return g26;
  const e4b = models.find(isGemma4EdgeE4b);
  if (e4b) return e4b;
  const e2b = models.find(isGemma4EdgeE2b);
  if (e2b) return e2b;
  const gemma = models.find(m => /gemma/i.test(m));
  return gemma ?? models[0];
}

/** Exact Ollama name for STT, or default string if none pulled yet. */
export function pickTranscribeModel(models: string[]): string {
  const e4b = models.find(isGemma4EdgeE4b);
  return e4b ?? 'gemma4:e4b';
}
