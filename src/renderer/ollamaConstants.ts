/**
 * Target context window (tokens) for Ollama native /api/chat (options.num_ctx).
 * 32K is a stable default for local 26B runs; very high values can OOM or error on /api/chat.
 */
export const OLLAMA_NUM_CTX = 98304;

/**
 * Max new tokens per assistant reply (OpenAI `max_tokens` → Ollama `num_predict`).
 * Enough for a full HTML file; lower if the server rejects huge limits.
 */
export const OLLAMA_MAX_REPLY_TOKENS = 98304;
