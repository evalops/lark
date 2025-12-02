import { contextBridge, ipcRenderer } from 'electron';
import { Config, DeepPartial, ToolActivity } from '../common/types';

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
    const handler = (_event: unknown, status: string) => callback(status);
    ipcRenderer.on('status-update', handler);
    return () => ipcRenderer.removeListener('status-update', handler);
  },
  onToolActivity: (callback: (activity: ToolActivity) => void) => {
    const handler = (_event: unknown, activity: ToolActivity) => callback(activity);
    ipcRenderer.on('tool-activity', handler);
    return () => ipcRenderer.removeListener('tool-activity', handler);
  },
  constants: { PILL_BASE_HEIGHT: 60 },
  getConstants: () => ipcRenderer.invoke('get-constants'),
  getConfigStatus: () => ipcRenderer.invoke('get-config-status'),
  saveApiKey: (apiKey: string) => ipcRenderer.invoke('save-api-key', apiKey),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (updates: DeepPartial<Config>) => ipcRenderer.invoke('save-config', updates),
  onConfirmationRequest: (callback: (request: string) => void) => {
    const handler = (_event: unknown, request: string) => callback(request);
    ipcRenderer.on('confirmation-request', handler);
    return () => ipcRenderer.removeListener('confirmation-request', handler);
  },
  respondToConfirmation: (allowed: boolean) => ipcRenderer.invoke('respond-to-confirmation', allowed),
};

contextBridge.exposeInMainWorld('larkAPI', api);
