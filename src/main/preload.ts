import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveAnimation: (filename: string, html_content: string, source?: 'gemma' | 'kid' | 'draft') =>
    ipcRenderer.invoke('save-animation', { filename, html_content, source }),
  saveVideoFrame: (filename: string, jpeg_base64: string, source?: 'gemma' | 'kid') =>
    ipcRenderer.invoke('save-video-frame', { filename, jpeg_base64, source }),
  inspectVideoAttachment: (videoPath: string) =>
    ipcRenderer.invoke('inspect-video-attachment', { videoPath }),
  preprocessVideoAttachment: (videoPath: string, durationSeconds: number) =>
    ipcRenderer.invoke('preprocess-video-attachment', { videoPath, durationSeconds }),
  appendRendererDebugLog: (scope: string, payload: unknown) =>
    ipcRenderer.invoke('append-renderer-debug-log', { scope, payload }),
  readAnimation: (filename: string) =>
    ipcRenderer.invoke('read-animation', { filename }),
  listAnimations: () =>
    ipcRenderer.invoke('list-animations'),
  deleteAnimation: (filename: string) =>
    ipcRenderer.invoke('delete-animation', { filename }),
  openInBrowser: (filename: string) =>
    ipcRenderer.invoke('open-in-browser', { filename }),
  setOllamaCleanupTargets: (runtime: 'ollama' | 'llama_cpp', models: string[]) =>
    ipcRenderer.invoke('set-ollama-cleanup-targets', { runtime, models }),
  checkPathExists: (filePath: string) =>
    ipcRenderer.invoke('check-path-exists', filePath),
  ttsSpeak: (text: string, lang?: string) =>
    ipcRenderer.invoke('tts-speak', text, lang),
  ttsListVoices: () =>
    ipcRenderer.invoke('tts-list-voices'),
  llamaCppHealthCheck: (config: LlamaCppConfig) =>
    ipcRenderer.invoke('llama-cpp-health-check', config),
  llamaCppListModels: (config: LlamaCppConfig) =>
    ipcRenderer.invoke('llama-cpp-list-models', config),
  llamaCppStartStream: (requestId: string, config: LlamaCppConfig, request: Record<string, unknown>) =>
    ipcRenderer.invoke('llama-cpp-start-stream', { requestId, config, request }),
  llamaCppAbortStream: (requestId: string) =>
    ipcRenderer.invoke('llama-cpp-abort-stream', { requestId }),
  llamaCppSttHealthCheck: (sttConfig: LlamaCppSttConfig) =>
    ipcRenderer.invoke('llama-cpp-stt-health-check', sttConfig),
  llamaCppTranscribe: (sttConfig: LlamaCppSttConfig, audioBase64: string, languageHint?: string) =>
    ipcRenderer.invoke('llama-cpp-transcribe', { sttConfig, audioBase64, languageHint }),
  onLlamaCppStreamEvent: (listener: (event: LlamaCppStreamEvent) => void) => {
    const wrapped = (_event: unknown, payload: LlamaCppStreamEvent) => listener(payload);
    ipcRenderer.on('llama-cpp-stream-event', wrapped);
    return () => {
      ipcRenderer.removeListener('llama-cpp-stream-event', wrapped);
    };
  },
});
