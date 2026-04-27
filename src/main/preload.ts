import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveAnimation: (filename: string, html_content: string) =>
    ipcRenderer.invoke('save-animation', { filename, html_content }),
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
});
