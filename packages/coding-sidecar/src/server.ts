import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  LocalExecutor,
  type BashRunOptions,
  type EditResult,
  type FindResult,
  type GrepOptions,
  type GrepResult,
  type LsResult,
  type ReadResult,
  type WriteResult,
} from '@assistant/coding-executor';

const DEFAULT_SOCKET_PATH = '/var/run/sidecar/sidecar.sock';
const DEFAULT_WORKSPACE_ROOT = '/workspace';
const HEALTH_VERSION = '1.0.0';

interface BashRequestBody {
  command: string;
  timeoutSeconds?: number;
}

interface ReadRequestBody {
  path: string;
  offset?: number;
  limit?: number;
}

interface WriteRequestBody {
  path: string;
  content: string;
}

interface EditRequestBody {
  path: string;
  oldText: string;
  newText: string;
}

interface LsRequestBody {
  path?: string;
  limit?: number;
}

interface FindRequestBody {
  pattern: string;
  path?: string;
  limit?: number;
}

interface GrepRequestBody extends GrepOptions {}

interface Envelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

type JsonBody =
  | BashRequestBody
  | ReadRequestBody
  | WriteRequestBody
  | EditRequestBody
  | LsRequestBody
  | FindRequestBody
  | GrepRequestBody;

function getSocketPath(): string | undefined {
  const raw = process.env['SOCKET_PATH'];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getWorkspaceRoot(): string {
  const raw = process.env['WORKSPACE_ROOT'];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return DEFAULT_WORKSPACE_ROOT;
}

function allowOutsideWorkspaceRoot(): boolean {
  return parseBooleanEnv(process.env['SIDECAR_ALLOW_OUTSIDE_WORKSPACE_ROOT']);
}

function getTcpHost(): string | undefined {
  const raw = process.env['TCP_HOST'];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getTcpPort(): number | undefined {
  const raw = process.env['TCP_PORT'];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function getAuthToken(): string | undefined {
  const raw = process.env['SIDECAR_AUTH_TOKEN'];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isAuthRequired(): boolean {
  return parseBooleanEnv(process.env['SIDECAR_REQUIRE_AUTH']);
}

async function readRequestBody(req: http.IncomingMessage): Promise<JsonBody | undefined> {
  const contentType = req.headers['content-type'];
  if (!contentType || !contentType.includes('application/json')) {
    return undefined;
  }

  let bodyText = '';
  const body = await new Promise<string>((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      bodyText += chunk.toString('utf-8');
    });
    req.on('end', () => resolve(bodyText));
    req.on('error', reject);
  });

  if (!body.trim()) {
    return {} as JsonBody;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  return parsed as JsonBody;
}

function sendJson<T>(res: http.ServerResponse, statusCode: number, body: Envelope<T>): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function extractBearerToken(req: http.IncomingMessage): string | undefined {
  const header = req.headers['authorization'];
  if (!header) {
    return undefined;
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return undefined;
  }
  const token = match[1]?.trim();
  return token ? token : undefined;
}

function authorizeRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  authToken: string | undefined,
  authRequired: boolean,
): boolean {
  if (!authToken) {
    return true;
  }
  const provided = extractBearerToken(req);
  if (!provided) {
    if (authRequired) {
      sendJson(res, 401, { ok: false, error: 'Unauthorized' });
      return false;
    }
    return true;
  }
  if (provided !== authToken) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

async function handleBash(
  executor: LocalExecutor,
  body: JsonBody | undefined,
  res: http.ServerResponse,
  abortSignal?: AbortSignal,
): Promise<void> {
  const { command, timeoutSeconds } = body as BashRequestBody;
  if (typeof command !== 'string' || !command.trim()) {
    sendJson(res, 400, { ok: false, error: 'Missing or invalid command' });
    return;
  }

  const timeout =
    typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds
      : undefined;

  try {
    const options: BashRunOptions = {};
    if (timeout !== undefined) {
      options.timeoutSeconds = timeout;
    }
    if (abortSignal) {
      options.abortSignal = abortSignal;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');

    options.onData = (chunk, source) => {
      if (!chunk) {
        return;
      }
      const payload: Record<string, unknown> = {
        type: 'delta',
        data: chunk,
      };
      if (source === 'stdout' || source === 'stderr') {
        payload['stream'] = source;
      }
      res.write(`${JSON.stringify(payload)}\n`);
    };

    const result = await executor.runBash(command, options);

    const donePayload: Record<string, unknown> = {
      type: 'done',
      exitCode: result.exitCode,
    };
    if (result.timedOut) {
      donePayload['timedOut'] = true;
    }

    res.write(`${JSON.stringify(donePayload)}\n`);
    res.end();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to run bash command';
    if (res.headersSent) {
      const errorPayload = {
        type: 'error',
        message,
      };
      try {
        res.write(`${JSON.stringify(errorPayload)}\n`);
      } catch {
        // ignore write errors on error path
      }
      res.end();
    } else {
      sendJson(res, 500, { ok: false, error: message });
    }
  }
}

async function handleRead(
  executor: LocalExecutor,
  body: JsonBody | undefined,
): Promise<Envelope<ReadResult>> {
  const { path: filePath, offset, limit } = body as ReadRequestBody;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'Missing or invalid path' };
  }

  const options: { offset?: number; limit?: number } = {};
  if (typeof offset === 'number' && Number.isFinite(offset)) {
    options.offset = offset;
  }
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    options.limit = limit;
  }

  try {
    const result =
      Object.keys(options).length > 0
        ? await executor.readFile(filePath, options)
        : await executor.readFile(filePath);

    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read file';
    return { ok: false, error: message };
  }
}

async function handleWrite(
  executor: LocalExecutor,
  body: JsonBody | undefined,
): Promise<Envelope<WriteResult>> {
  const { path: filePath, content } = body as WriteRequestBody;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'Missing or invalid path' };
  }
  if (typeof content !== 'string') {
    return { ok: false, error: 'Missing or invalid content' };
  }

  try {
    const result = await executor.writeFile(filePath, content);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write file';
    return { ok: false, error: message };
  }
}

async function handleEdit(
  executor: LocalExecutor,
  body: JsonBody | undefined,
): Promise<Envelope<EditResult>> {
  const { path: filePath, oldText, newText } = body as EditRequestBody;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: 'Missing or invalid path' };
  }
  if (typeof oldText !== 'string' || oldText.length === 0) {
    return { ok: false, error: 'Missing or invalid oldText' };
  }
  if (typeof newText !== 'string') {
    return { ok: false, error: 'Missing or invalid newText' };
  }

  try {
    const result = await executor.editFile(filePath, oldText, newText);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to edit file';
    return { ok: false, error: message };
  }
}

async function handleLs(
  executor: LocalExecutor,
  body: JsonBody | undefined,
): Promise<Envelope<LsResult>> {
  const { path: requestedPath, limit } = body as LsRequestBody;

  let pathArg: string | undefined;
  if (typeof requestedPath === 'string' && requestedPath.trim().length > 0) {
    pathArg = requestedPath;
  }

  let limitArg: number | undefined;
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    limitArg = limit;
  }

  const options: { limit?: number } = {};
  if (limitArg !== undefined) {
    options.limit = limitArg;
  }

  try {
    const result =
      Object.keys(options).length > 0
        ? await executor.ls(pathArg, options)
        : await executor.ls(pathArg);

    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list directory';
    return { ok: false, error: message };
  }
}

async function handleFind(
  executor: LocalExecutor,
  body: JsonBody | undefined,
): Promise<Envelope<FindResult>> {
  const { pattern, path: searchPath, limit } = body as FindRequestBody;
  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { ok: false, error: 'Missing or invalid pattern' };
  }

  const options: { pattern: string; path?: string; limit?: number } = { pattern };

  if (typeof searchPath === 'string' && searchPath.trim().length > 0) {
    options.path = searchPath;
  }

  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    options.limit = Math.floor(limit);
  }

  try {
    const result = await executor.find(options);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to find files';
    return { ok: false, error: message };
  }
}

async function handleGrep(
  executor: LocalExecutor,
  body: JsonBody | undefined,
): Promise<Envelope<GrepResult>> {
  const raw = body as GrepRequestBody;
  const { pattern } = raw;

  if (typeof pattern !== 'string' || !pattern.trim()) {
    return { ok: false, error: 'Missing or invalid pattern' };
  }

  const options: GrepOptions = { pattern: pattern.trim() };

  if (typeof raw.path === 'string' && raw.path.trim()) {
    options.path = raw.path;
  }

  if (typeof raw.glob === 'string' && raw.glob.trim()) {
    options.glob = raw.glob;
  }

  if (typeof raw.ignoreCase === 'boolean') {
    options.ignoreCase = raw.ignoreCase;
  }

  if (typeof raw.literal === 'boolean') {
    options.literal = raw.literal;
  }

  if (typeof raw.context === 'number' && Number.isFinite(raw.context) && raw.context >= 0) {
    options.context = raw.context;
  }

  if (typeof raw.limit === 'number' && Number.isFinite(raw.limit) && raw.limit > 0) {
    options.limit = raw.limit;
  }

  try {
    const result = await executor.grep(options);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to run grep';
    return { ok: false, error: message };
  }
}

export function createServer(): http.Server {
  const executor = new LocalExecutor({
    workspaceRoot: getWorkspaceRoot(),
    allowOutsideWorkspaceRoot: allowOutsideWorkspaceRoot(),
  });
  const authToken = getAuthToken();
  const authRequired = isAuthRequired();

  if (authRequired && !authToken) {
    throw new Error('SIDECAR_REQUIRE_AUTH is true but SIDECAR_AUTH_TOKEN is not set');
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) {
        sendJson(res, 400, { ok: false, error: 'Bad request' });
        return;
      }

      const url = new URL(req.url, 'http://localhost');

      if (!authorizeRequest(req, res, authToken, authRequired)) {
        return;
      }

      if (req.method === 'GET' && url.pathname === '/health') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true, version: HEALTH_VERSION }));
        return;
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
      }

      const body = await readRequestBody(req);
      if (!body) {
        sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
        return;
      }

      if (url.pathname === '/bash') {
        const abortController = new AbortController();

        req.on('close', () => {
          if (!res.writableEnded) {
            abortController.abort();
          }
        });

        await handleBash(executor, body, res, abortController.signal);
        return;
      } else if (url.pathname === '/read') {
        const response = await handleRead(executor, body);
        const statusCode = response.ok ? 200 : 400;
        sendJson(res, statusCode, response);
      } else if (url.pathname === '/write') {
        const response = await handleWrite(executor, body);
        const statusCode = response.ok ? 200 : 400;
        sendJson(res, statusCode, response);
      } else if (url.pathname === '/edit') {
        const response = await handleEdit(executor, body);
        const statusCode = response.ok ? 200 : 400;
        sendJson(res, statusCode, response);
      } else if (url.pathname === '/ls') {
        const response = await handleLs(executor, body);
        const statusCode = response.ok ? 200 : 400;
        sendJson(res, statusCode, response);
      } else if (url.pathname === '/find') {
        const response = await handleFind(executor, body);
        const statusCode = response.ok ? 200 : 400;
        sendJson(res, statusCode, response);
      } else if (url.pathname === '/grep') {
        const response = await handleGrep(executor, body);
        const statusCode = response.ok ? 200 : 400;
        sendJson(res, statusCode, response);
      } else {
        sendJson(res, 404, { ok: false, error: 'Not found' });
        return;
      }
    } catch (err) {
      console.error('Error handling request', err);
      sendJson(res, 500, { ok: false, error: 'Internal server error' });
    }
  });

  return server;
}

function ensureSocketDirectory(socketPath: string): void {
  const dir = path.dirname(socketPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function start(): void {
  const tcpHost = getTcpHost();
  const tcpPort = getTcpPort();
  const tcpEnabled = !!tcpHost || !!tcpPort;

  if ((tcpHost && !tcpPort) || (!tcpHost && tcpPort)) {
    console.error('Both TCP_HOST and TCP_PORT must be set to enable TCP');
    process.exit(1);
  }

  const rawSocketPath = getSocketPath();
  const socketPath = rawSocketPath ?? (tcpEnabled ? undefined : DEFAULT_SOCKET_PATH);

  if (!socketPath && !tcpEnabled) {
    console.error('Neither SOCKET_PATH nor TCP_HOST/TCP_PORT are configured');
    process.exit(1);
  }

  const servers: http.Server[] = [];

  if (socketPath) {
    ensureSocketDirectory(socketPath);

    if (fs.existsSync(socketPath)) {
      try {
        const stats = fs.statSync(socketPath);
        if (stats.isSocket()) {
          fs.unlinkSync(socketPath);
        } else {
          throw new Error(`Socket path exists and is not a socket: ${socketPath}`);
        }
      } catch (err) {
        console.error('Failed to clean up existing socket file', err);
        process.exit(1);
      }
    }

    const server = createServer();
    servers.push(server);
    server.listen(socketPath, () => {
      console.log(`Coding sidecar listening on socket ${socketPath}`);
    });
  }

  if (tcpHost && tcpPort) {
    const server = createServer();
    servers.push(server);
    server.listen(tcpPort, tcpHost, () => {
      console.log(`Coding sidecar listening on http://${tcpHost}:${tcpPort}`);
    });
  }

  const closeServer = () => {
    if (servers.length === 0) {
      process.exit(0);
      return;
    }

    let remaining = servers.length;
    const onClosed = () => {
      remaining -= 1;
      if (remaining > 0) {
        return;
      }
      try {
        if (socketPath && fs.existsSync(socketPath)) {
          fs.unlinkSync(socketPath);
        }
      } catch (cleanupErr) {
        console.error('Error cleaning up socket file', cleanupErr);
      }
      process.exit(0);
    };

    servers.forEach((server) => {
      server.close((err) => {
        if (err) {
          console.error('Error closing server', err);
        }
        onClosed();
      });
    });
  };

  process.on('SIGTERM', closeServer);
  process.on('SIGINT', closeServer);
}

if (require.main === module) {
  start();
}
