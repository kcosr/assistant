import { contextBridge, ipcRenderer } from 'electron';

type ProxyReadyPayload = {
  http_port?: number;
  ws_port?: number;
};

type SettingsUpdate = {
  backendUrl?: string;
  skipCertValidation?: boolean;
};

const api = {
  platform: 'electron',
  getBackendUrl: () => ipcRenderer.invoke('assistant-desktop:get-backend-url'),
  setBackendUrl: (url: string) => ipcRenderer.invoke('assistant-desktop:set-backend-url', url),
  getSettings: () => ipcRenderer.invoke('assistant-desktop:get-settings'),
  updateSettings: (settings: SettingsUpdate) =>
    ipcRenderer.invoke('assistant-desktop:update-settings', settings),
  getProxyUrl: () => ipcRenderer.invoke('assistant-desktop:get-proxy-url'),
  getWsProxyPort: () => ipcRenderer.invoke('assistant-desktop:get-ws-proxy-port'),
  showSaveDialog: (defaultPath: string) =>
    ipcRenderer.invoke('assistant-desktop:show-save-dialog', defaultPath),
  saveArtifactFile: (path: string, contentBase64: string) =>
    ipcRenderer.invoke('assistant-desktop:save-artifact-file', { path, contentBase64 }),
  openTempHtmlAttachmentFile: (fileName: string, contentBase64: string) =>
    ipcRenderer.invoke('assistant-desktop:open-temp-html-attachment-file', {
      fileName,
      contentBase64,
    }),
  openExternal: (url: string) => ipcRenderer.invoke('assistant-desktop:open-external', url),
  onProxyReady: (handler: (payload: ProxyReadyPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ProxyReadyPayload) => {
      handler(payload);
    };
    ipcRenderer.on('assistant-desktop:proxy-ready', listener);
    return () => ipcRenderer.removeListener('assistant-desktop:proxy-ready', listener);
  },
};

contextBridge.exposeInMainWorld('assistantDesktop', api);
