import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveAnimation: (filename: string, html_content: string, source?: 'gemma' | 'kid') =>
    ipcRenderer.invoke('save-animation', { filename, html_content, source }),
  readAnimation: (filename: string) =>
    ipcRenderer.invoke('read-animation', { filename }),
  listAnimations: () =>
    ipcRenderer.invoke('list-animations'),
  deleteAnimation: (filename: string) =>
    ipcRenderer.invoke('delete-animation', { filename }),
  openInBrowser: (filename: string) =>
    ipcRenderer.invoke('open-in-browser', { filename }),
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
  onLlamaCppStreamEvent: (listener: (event: LlamaCppStreamEvent) => void) => {
    const wrapped = (_event: unknown, payload: LlamaCppStreamEvent) => listener(payload);
    ipcRenderer.on('llama-cpp-stream-event', wrapped);
    return () => {
      ipcRenderer.removeListener('llama-cpp-stream-event', wrapped);
    };
  },
});
