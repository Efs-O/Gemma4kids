export {};

declare global {
  interface LlamaCppConfig {
    serverPath: string;
    modelPath: string;
    port: number;
    gpuLayers: number;
    numCtx: number;
    numPredict: number;
    cacheTypeK: string;
    cacheTypeV: string;
    reasoningEnabled: boolean;
  }

  interface LlamaCppHealthResult {
    ok: boolean;
    state?: string;
    error?: string;
    message?: string;
    details?: string[];
  }

  interface LlamaCppModelInfo {
    id: string;
    label: string;
  }

  interface LlamaCppStreamEvent {
    requestId: string;
    type: 'token' | 'thinking' | 'tool_calls' | 'done' | 'error';
    token?: string;
    thinking?: string;
    toolCalls?: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
    finishReason?: string | null;
    error?: string;
  }

  interface Window {
    electronAPI: {
      saveAnimation(filename: string, html_content: string, source?: 'gemma' | 'kid'): Promise<{ success: boolean; filename: string; path: string; error?: string }>;
      saveVideoFrame(filename: string, jpeg_base64: string, source?: 'gemma' | 'kid'): Promise<{ success: boolean; filename: string; path: string; error?: string }>;
      inspectVideoAttachment(videoPath: string): Promise<{
        success: boolean;
        durationSeconds?: number;
        posterDataUrl?: string | null;
        ffmpegPath?: string;
        error?: string;
      }>;
      preprocessVideoAttachment(videoPath: string, durationSeconds: number): Promise<{
        success: boolean;
        frames: Array<{ base64: string; timeSeconds: number }>;
        audioWavBase64: string | null;
        ffmpegPath?: string;
        warning?: string;
        error?: string;
      }>;
      appendRendererDebugLog(scope: string, payload: unknown): Promise<{ success: boolean }>;
      readAnimation(filename: string): Promise<{ success: boolean; content: string; error?: string }>;
      listAnimations(): Promise<{ success: boolean; files: string[]; error?: string }>;
      deleteAnimation(filename: string): Promise<{ success: boolean; error?: string }>;
      openInBrowser(filename: string): Promise<{ success: boolean; error?: string }>;
      setOllamaCleanupTargets(runtime: 'ollama' | 'llama_cpp', models: string[]): Promise<{ success: boolean }>;
      ttsSpeak(text: string, lang?: string): Promise<Uint8Array>;
      ttsListVoices(): Promise<{ name: string; lang: string; sampleRate: number }[]>;
      llamaCppHealthCheck(config: LlamaCppConfig): Promise<LlamaCppHealthResult>;
      llamaCppListModels(config: LlamaCppConfig): Promise<{ success: boolean; models: LlamaCppModelInfo[]; error?: string }>;
      llamaCppStartStream(
        requestId: string,
        config: LlamaCppConfig,
        request: Record<string, unknown>,
      ): Promise<{ success: boolean; error?: string }>;
      llamaCppAbortStream(requestId: string): Promise<{ success: boolean }>;
      onLlamaCppStreamEvent(listener: (event: LlamaCppStreamEvent) => void): () => void;
    };
  }
}
