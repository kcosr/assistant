import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  shell,
} from 'electron';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';

import {
  flushPendingWsMessages,
  relayOrQueueWsMessage,
  type PendingWsMessage,
} from './wsRelay.js';

type AppSettings = {
  backendUrl: string;
  skipCertValidation: boolean;
  proxyPort: number;
  wsProxyPort: number;
};

type SettingsUpdate = {
  backendUrl?: string;
  skipCertValidation?: boolean;
};

type ProxyReadyPayload = {
  http_port: number;
  ws_port: number;
};

const HTTP_PROXY_CONNECT_TIMEOUT_MS = 10_000;
const HTTP_PROXY_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_BACKEND_URL = 'https://assistant';
const isWorkVariant = process.env['ASSISTANT_DESKTOP_VARIANT'] === 'work';
const appConfig = {
  productName: isWorkVariant ? 'Assistant Work' : 'Assistant',
  appId: isWorkVariant ? 'com.assistant.desktop.work' : 'com.assistant.desktop',
  defaultBackendUrl:
    process.env['ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL']?.trim() ||
    (isWorkVariant ? 'https://assistant/assistant-work' : DEFAULT_BACKEND_URL),
};

let mainWindow: BrowserWindow | null = null;
let settings: AppSettings = defaultSettings();
let settingsPath = '';
let httpProxyServer: http.Server | null = null;
let wsProxyServer: http.Server | null = null;

function defaultSettings(): AppSettings {
  return {
    backendUrl: appConfig.defaultBackendUrl,
    skipCertValidation: true,
    proxyPort: 0,
    wsProxyPort: 0,
  };
}

function getWebPublicDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web-client', 'public');
  }
  return path.resolve(__dirname, '..', '..', 'web-client', 'public');
}

function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icons', 'icon.png');
  }
  return path.resolve(__dirname, '..', 'icons', 'icon.png');
}

function buildBackendUrl(requestUrl: string): string {
  const upstream = new URL(settings.backendUrl);
  const basePath = upstream.pathname.replace(/\/+$/, '');
  const request = new URL(requestUrl, 'http://assistant.local');
  upstream.pathname = `${basePath}${request.pathname}`;
  upstream.search = request.search;
  upstream.hash = '';
  return upstream.toString();
}

function buildBackendWsUrl(): string {
  const upstream = new URL(settings.backendUrl);
  upstream.protocol = upstream.protocol === 'http:' ? 'ws:' : 'wss:';
  upstream.pathname = `${upstream.pathname.replace(/\/+$/, '')}/ws`;
  upstream.search = '';
  upstream.hash = '';
  return upstream.toString();
}

function normalizeHeaderValue(value: string | string[] | undefined): string | string[] | undefined {
  return value;
}

async function closeServer(server: http.Server | null): Promise<void> {
  if (!server) {
    return;
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function listenOnLoopback(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (address && typeof address === 'object') {
        resolve(address.port);
        return;
      }
      reject(new Error('Proxy did not bind to a TCP port'));
    });
  });
}

function createHttpProxyServer(): http.Server {
  return http.createServer((req, res) => {
    if (!req.url || !req.method) {
      res.statusCode = 400;
      res.end('Bad request');
      return;
    }

    let upstreamUrl: URL;
    try {
      upstreamUrl = new URL(buildBackendUrl(req.url));
    } catch (err) {
      res.statusCode = 502;
      res.end(`Invalid backend URL: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const requestModule = upstreamUrl.protocol === 'http:' ? http : https;
    const headers = { ...req.headers };
    delete headers.host;

    const proxyReq = requestModule.request(
      {
        protocol: upstreamUrl.protocol,
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port,
        method: req.method,
        path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
        headers,
        timeout: HTTP_PROXY_REQUEST_TIMEOUT_MS,
        agent:
          upstreamUrl.protocol === 'https:'
            ? new https.Agent({
                rejectUnauthorized: !settings.skipCertValidation,
                timeout: HTTP_PROXY_CONNECT_TIMEOUT_MS,
              })
            : undefined,
      },
      (proxyRes) => {
        res.statusCode = proxyRes.statusCode ?? 502;
        for (const [name, value] of Object.entries(proxyRes.headers)) {
          const headerValue = normalizeHeaderValue(value);
          if (headerValue !== undefined) {
            res.setHeader(name, headerValue);
          }
        }
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Proxy request timed out'));
    });
    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.statusCode = 502;
      }
      res.end(`Proxy error: ${err.message}`);
    });

    req.pipe(proxyReq);
  });
}

function createWsProxyServer(): http.Server {
  const server = http.createServer();
  const webSocketServer = new WebSocketServer({ server });

  webSocketServer.on('connection', (client) => {
    const upstream = new WebSocket(buildBackendWsUrl(), {
      rejectUnauthorized: !settings.skipCertValidation,
    });
    const pendingMessages: PendingWsMessage[] = [];

    upstream.on('open', () => {
      flushPendingWsMessages(upstream, pendingMessages);
    });

    client.on('message', (message, isBinary) => {
      relayOrQueueWsMessage(upstream, WebSocket.OPEN, pendingMessages, message, isBinary);
    });

    upstream.on('message', (message, isBinary) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message, { binary: isBinary });
      }
    });

    const closeBoth = () => {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    };

    client.on('close', closeBoth);
    client.on('error', closeBoth);
    upstream.on('close', closeBoth);
    upstream.on('error', closeBoth);
  });

  return server;
}

async function restartProxies(): Promise<void> {
  await Promise.all([closeServer(httpProxyServer), closeServer(wsProxyServer)]);

  httpProxyServer = createHttpProxyServer();
  wsProxyServer = createWsProxyServer();
  const [proxyPort, wsProxyPort] = await Promise.all([
    listenOnLoopback(httpProxyServer),
    listenOnLoopback(wsProxyServer),
  ]);
  settings.proxyPort = proxyPort;
  settings.wsProxyPort = wsProxyPort;
  await saveSettings();
  emitProxyReady();
}

async function loadSettings(): Promise<void> {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const contents = await fs.readFile(settingsPath, 'utf8');
    settings = {
      ...defaultSettings(),
      ...(JSON.parse(contents) as Partial<AppSettings>),
    };
  } catch {
    settings = defaultSettings();
  }
}

async function saveSettings(): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function emitProxyReady(): void {
  const payload: ProxyReadyPayload = {
    http_port: settings.proxyPort,
    ws_port: settings.wsProxyPort,
  };
  mainWindow?.webContents.send('assistant-desktop:proxy-ready', payload);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: appConfig.productName,
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    center: true,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.loadFile(path.join(getWebPublicDir(), 'index.html'));
  window.webContents.on('did-finish-load', () => emitProxyReady());
  if (!app.isPackaged) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
  return window;
}

function sanitizeFileName(fileName: string): string {
  const baseName = path.basename(fileName.trim() || 'attachment.html');
  const safeName = baseName.replace(/[/:\\]/g, '_') || 'attachment.html';
  return safeName.endsWith('.html') || safeName.endsWith('.htm') ? safeName : `${safeName}.html`;
}

function registerIpcHandlers(): void {
  ipcMain.handle('assistant-desktop:get-backend-url', () => settings.backendUrl);
  ipcMain.handle('assistant-desktop:set-backend-url', async (_event, url: string) => {
    settings.backendUrl = url;
    await saveSettings();
  });
  ipcMain.handle('assistant-desktop:get-settings', () => ({ ...settings }));
  ipcMain.handle('assistant-desktop:update-settings', async (_event, update: SettingsUpdate) => {
    let shouldRestartProxy = false;
    if (typeof update.backendUrl === 'string' && update.backendUrl !== settings.backendUrl) {
      settings.backendUrl = update.backendUrl;
      shouldRestartProxy = true;
    }
    if (
      typeof update.skipCertValidation === 'boolean' &&
      update.skipCertValidation !== settings.skipCertValidation
    ) {
      settings.skipCertValidation = update.skipCertValidation;
      shouldRestartProxy = true;
    }
    await saveSettings();
    if (shouldRestartProxy) {
      await restartProxies();
    }
    return { ...settings };
  });
  ipcMain.handle('assistant-desktop:get-proxy-url', () => {
    if (settings.proxyPort <= 0) {
      throw new Error('Proxy not running');
    }
    return `localhost:${settings.proxyPort}`;
  });
  ipcMain.handle('assistant-desktop:get-ws-proxy-port', () => {
    if (settings.wsProxyPort <= 0) {
      throw new Error('WebSocket proxy not running');
    }
    return settings.wsProxyPort;
  });
  ipcMain.handle('assistant-desktop:show-save-dialog', async (_event, defaultPath: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath,
    });
    return result.canceled ? null : result.filePath;
  });
  ipcMain.handle(
    'assistant-desktop:save-artifact-file',
    async (_event, args: { path: string; contentBase64: string }) => {
      const decoded = Buffer.from(args.contentBase64, 'base64');
      await fs.mkdir(path.dirname(args.path), { recursive: true });
      await fs.writeFile(args.path, decoded);
    },
  );
  ipcMain.handle(
    'assistant-desktop:open-temp-html-attachment-file',
    async (_event, args: { fileName: string; contentBase64: string }) => {
      const tempDir = path.join(os.tmpdir(), 'assistant-html-attachments');
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, `${Date.now()}-${sanitizeFileName(args.fileName)}`);
      await fs.writeFile(filePath, Buffer.from(args.contentBase64, 'base64'));
      const openError = await shell.openPath(filePath);
      if (openError) {
        throw new Error(openError);
      }
    },
  );
  ipcMain.handle('assistant-desktop:open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });
}

app.setName(appConfig.productName);
app.setPath('userData', path.join(app.getPath('appData'), appConfig.appId));
registerIpcHandlers();

app.whenReady().then(async () => {
  await loadSettings();
  await restartProxies();
  mainWindow = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void closeServer(httpProxyServer);
  void closeServer(wsProxyServer);
});
