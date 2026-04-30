export interface OllamaSamplingProfile {
  temperature: number;
  topP: number;
  topK: number;
}

export interface OllamaChatProfile extends OllamaSamplingProfile {
  think: boolean;
  numCtx: number;
  numPredict: number;
}

export interface OllamaTranscribeProfile {
  think: boolean;
  numCtx: number;
  keepAlive: 0 | string;
}

/**
 * Shared text-generation defaults for Gemma 4 in this app.
 * Keep these aligned with the active product policy instead of scattering
 * raw numbers across request builders.
 */
export const OLLAMA_SAMPLING: OllamaSamplingProfile = {
  temperature: 1.0,
  topP: 0.95,
  topK: 64,
};

/**
 * Main coding chat profile.
 * Large context and reply budget are intentional here because the model must
 * emit full HTML files and tool-call payloads in one response loop.
 */
export const OLLAMA_CHAT_PROFILE: OllamaChatProfile = {
  think: true,
  numCtx: 65536,
  numPredict: 32768,
  ...OLLAMA_SAMPLING,
};

/** 26B / 31B only: wider ctx + reply cap (more KV-cache VRAM than edge models). */
export const OLLAMA_CHAT_WORKSTATION_CTX = 122880;
export const OLLAMA_CHAT_WORKSTATION_PREDICT = 65536;

/**
 * Audio transcription profile for Gemma 4 E4B.
 * This stays smaller than coding chat on purpose: short prompt, no tools,
 * no streaming UI, and immediate unload to free VRAM for the coding model.
 */
export const OLLAMA_TRANSCRIBE_PROFILE: OllamaTranscribeProfile = {
  think: false,
  numCtx: 8192,
  keepAlive: 0,
};

/**
 * Legacy aliases kept to minimize churn while the refactor settles.
 */
export const OLLAMA_NUM_CTX = OLLAMA_CHAT_PROFILE.numCtx;
export const OLLAMA_MAX_REPLY_TOKENS = OLLAMA_CHAT_PROFILE.numPredict;
