export {};

declare global {
  interface LlamaCppConfig {
    serverPath: string;
    modelPath: string;
    port: number;
    gpuLayers: number;
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
      readAnimation(filename: string): Promise<{ success: boolean; content: string; error?: string }>;
      listAnimations(): Promise<{ success: boolean; files: string[]; error?: string }>;
      deleteAnimation(filename: string): Promise<{ success: boolean; error?: string }>;
      openInBrowser(filename: string): Promise<{ success: boolean; error?: string }>;
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
