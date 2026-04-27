/** Strip optional registry path so "host/gemma4:e4b" → "gemma4:e4b". */
export function normalizeOllamaModelRef(name: string): string {
  const t = name.trim();
  const slash = t.lastIndexOf('/');
  return slash >= 0 ? t.slice(slash + 1) : t;
}

/** True for Gemma 4 edge E4B tags (gemma4:e4b, gemma4:e4b-it-…), not 26B MoE. */
export function isGemma4EdgeE4b(name: string): boolean {
  const n = normalizeOllamaModelRef(name);
  return /^gemma4:e4b(?:$|[-.])/i.test(n);
}

/** True for Gemma 4 26B workstation / MoE tags. */
export function isGemma426b(name: string): boolean {
  const n = normalizeOllamaModelRef(name);
  return /^gemma4:26b(?:$|[-.])/i.test(n);
}

/**
 * Prefer E4B (small) when installed — for testing; swap order with 26B if you want
 * the large MoE model for chat + tools.
 * When tags are still loading, callers may pass [] — default matches Ollama’s edge tag.
 */
export function pickCodingModel(models: string[]): string {
  if (models.length === 0) return 'gemma4:e4b';
  const e4b = models.find(isGemma4EdgeE4b);
  if (e4b) return e4b;
  const g26 = models.find(isGemma426b);
  if (g26) return g26;
  const gemma = models.find(m => /gemma/i.test(m));
  return gemma ?? models[0];
}

/** Exact Ollama name for STT, or default string if none pulled yet. */
export function pickTranscribeModel(models: string[]): string {
  const e4b = models.find(isGemma4EdgeE4b);
  return e4b ?? 'gemma4:e4b';
}
