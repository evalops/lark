import { contextBridge, ipcRenderer } from 'electron';

const api = {
  askOpenAI: (prompt: string) => ipcRenderer.invoke('ask-openai', prompt),
  stopComputerUse: () => ipcRenderer.invoke('stop-computer-use'),
  moveMouse: (coords: { x: number; y: number }) => ipcRenderer.invoke('control-mouse', coords),
  typeText: (text: string) => ipcRenderer.invoke('control-keyboard', text),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  setWindowHeight: (height: number) => ipcRenderer.invoke('resize-window', height),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  onStatusUpdate: (callback: (status: string) => void) => {
    ipcRenderer.on('status-update', (_event, status) => callback(status));
  },
  constants: { PILL_BASE_HEIGHT: 60 },
  getConstants: () => ipcRenderer.invoke('get-constants'),
  getConfigStatus: () => ipcRenderer.invoke('get-config-status'),
  saveApiKey: (apiKey: string) => ipcRenderer.invoke('save-api-key', apiKey),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (updates: any) => ipcRenderer.invoke('save-config', updates),
};

contextBridge.exposeInMainWorld('larkAPI', api);
