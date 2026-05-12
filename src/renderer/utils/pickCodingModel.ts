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

/** True only for the plain latest Ollama E2B tag, not the suffixed variants. */
export function isPlainGemma4E2b(name: string): boolean {
  return normalizeOllamaModelRef(name).toLowerCase() === 'gemma4:e2b';
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

/** Sort key for Gemma 4 coding tags: smallest (E2B) → largest (31B). */
function gemma4CodingModelSizeRank(name: string): number {
  if (isGemma4EdgeE2b(name)) return 0;
  if (isGemma4EdgeE4b(name)) return 1;
  if (isGemma426b(name)) return 2;
  if (isGemma431b(name)) return 3;
  return 99;
}

/** Drop-down order: E2B, E4B, 26B, 31B; same tier sorted by tag string. */
export function sortGemma4CodingModelsSmallestFirst(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const d = gemma4CodingModelSizeRank(a) - gemma4CodingModelSizeRank(b);
    if (d !== 0) return d;
    return normalizeOllamaModelRef(a).localeCompare(normalizeOllamaModelRef(b), undefined, {
      sensitivity: 'base',
    });
  });
}

/**
 * Auto-select default coding model: E2B > E4B > 26B > 31B > any gemma > first.
 * Starts with the fastest/lightest model so the app loads quickly; user can
 * upgrade manually during the session.
 * When tags are still loading, callers may pass [] -- default to E2B tag.
 */
export function pickCodingModel(models: string[]): string {
  if (models.length === 0) return 'gemma4:e2b';
  const e2b = models.find(isGemma4EdgeE2b);
  if (e2b) return e2b;
  const e4b = models.find(isGemma4EdgeE4b);
  if (e4b) return e4b;
  const g26 = models.find(isGemma426b);
  if (g26) return g26;
  const g31 = models.find(isGemma431b);
  if (g31) return g31;
  const gemma = models.find(m => /gemma/i.test(m));
  return gemma ?? models[0];
}

export type ModelTier = 'simple' | 'full';

/** Simple tier = E2B / E4B; full tier = 26B / 31B and anything else. */
export function getModelTier(name: string): ModelTier {
  return isGemma4EdgeE2b(name) || isGemma4EdgeE4b(name) ? 'simple' : 'full';
}

/** Exact Ollama name for STT, or default string if none pulled yet. */
export function pickTranscribeModel(models: string[]): string {
  const e4b = models.find(isGemma4EdgeE4b);
  const e2b = models.find(isGemma4EdgeE2b);
  return e4b ?? e2b ?? 'gemma4:e4b';
}

/**
 * Greek STT fallback: prefer E2B when available.
 * Current local tests show E4B is stronger for German/English, but Greek audio
 * is less unstable on E2B. Keep this helper isolated so we can remove it if a
 * future Gemma/Ollama update fixes Greek ASR quality on E4B.
 */
export function pickGreekTranscribeModel(models: string[]): string | null {
  const e2b = models.find(isGemma4EdgeE2b);
  if (e2b) return e2b;
  const e4b = models.find(isGemma4EdgeE4b);
  return e4b ?? null;
}
