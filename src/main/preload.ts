import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveAnimation: (filename: string, html_content: string) =>
    ipcRenderer.invoke('save-animation', { filename, html_content }),
  readAnimation: (filename: string) =>
    ipcRenderer.invoke('read-animation', { filename }),
  listAnimations: () =>
    ipcRenderer.invoke('list-animations'),
  openInBrowser: (filename: string) =>
    ipcRenderer.invoke('open-in-browser', { filename }),
});
