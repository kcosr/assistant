import http from 'node:http';

import type {
  BashResult,
  BashRunOptions,
  EditResult,
  FindOptions,
  FindResult,
  GrepOptions,
  GrepResult,
  LsResult,
  ReadResult,
  ToolExecutor,
  WriteResult,
} from '@assistant/coding-executor';

export interface SidecarClientOptions {
  socketPath?: string;
  tcp?: {
    host: string;
    port: number;
  };
  authToken?: string;
}

interface SidecarResponseEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: { message?: string } | string;
}

export class SidecarClient implements ToolExecutor {
  private readonly socketPath: string | undefined;
  private readonly tcpHost: string | undefined;
  private readonly tcpPort: number | undefined;
  private readonly authToken: string | undefined;

  constructor(options: SidecarClientOptions) {
    if (options.socketPath && options.tcp) {
      throw new Error('SidecarClient must be configured with either socketPath or tcp, not both');
    }
    if (!options.socketPath && !options.tcp) {
      throw new Error('SidecarClient requires socketPath or tcp configuration');
    }
    if (options.tcp && (!options.tcp.host || !options.tcp.port)) {
      throw new Error('SidecarClient tcp configuration requires host and port');
    }

    this.socketPath = options.socketPath;
    this.tcpHost = options.tcp?.host;
    this.tcpPort = options.tcp?.port;
    this.authToken = options.authToken;
  }

  private buildHeaders(payload?: string): Record<string, string> | undefined {
    const headers: Record<string, string> = {};
    if (payload !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload, 'utf8').toString();
    }
    if (this.authToken) {
      headers['authorization'] = `Bearer ${this.authToken}`;
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  private buildRequestOptions(
    method: 'GET' | 'POST',
    path: string,
    headers?: Record<string, string>,
  ): http.RequestOptions {
    const baseOptions = this.socketPath
      ? { socketPath: this.socketPath }
      : { hostname: this.tcpHost, port: this.tcpPort };

    return {
      ...baseOptions,
      method,
      path,
      headers,
    };
  }

  private async request<TResponse>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    abortSignal?: AbortSignal,
  ): Promise<TResponse> {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = this.buildHeaders(payload);

    return new Promise<TResponse>((resolve, reject) => {
      const req = http.request(
        this.buildRequestOptions(method, path, headers),
        (res) => {
          const { statusCode } = res;
          if (!statusCode) {
            reject(new Error('Sidecar response did not include a status code'));
            return;
          }

          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            raw += chunk;
          });
          res.on('end', () => {
            if (statusCode < 200 || statusCode >= 300) {
              const message =
                raw && raw.length > 0
                  ? `Sidecar error ${statusCode}: ${raw}`
                  : `Sidecar error ${statusCode}`;
              reject(new Error(message));
              return;
            }

            if (!raw) {
              reject(new Error('Sidecar response body was empty'));
              return;
            }

            let parsed: unknown;
            try {
              parsed = JSON.parse(raw) as unknown;
            } catch (err) {
              reject(
                new Error(
                  `Sidecar response was not valid JSON: ${(err as Error).message ?? String(err)}`,
                ),
              );
              return;
            }

            const envelope = parsed as SidecarResponseEnvelope<TResponse> | TResponse;
            if (typeof (envelope as SidecarResponseEnvelope<TResponse>).ok === 'boolean') {
              const env = envelope as SidecarResponseEnvelope<TResponse>;
              if (!env.ok) {
                const errorPayload = env.error;
                const message =
                  typeof errorPayload === 'string'
                    ? errorPayload
                    : (errorPayload?.message ?? 'Unknown error from sidecar');
                reject(new Error(message));
                return;
              }
              if (env.result === undefined) {
                reject(new Error('Sidecar response missing result payload'));
                return;
              }
              resolve(env.result);
              return;
            }

            resolve(envelope as TResponse);
          });
        },
      );

      const onError = (err: Error) => {
        if (abortSignal?.aborted) {
          reject(new Error('Coding sidecar request aborted'));
          return;
        }
        reject(new Error(`Failed to connect to coding sidecar: ${String(err)}`));
      };

      req.on('error', onError);

      if (abortSignal) {
        if (abortSignal.aborted) {
          req.destroy(new Error('Request aborted by signal'));
        } else {
          abortSignal.addEventListener(
            'abort',
            () => {
              req.destroy(new Error('Request aborted by signal'));
            },
            { once: true },
          );
        }
      }

      if (payload !== undefined) {
        req.write(payload, 'utf8');
      }
      req.end();
    });
  }

  async health(): Promise<{ ok: boolean; version?: string }> {
    const headers = this.buildHeaders();

    return new Promise((resolve, reject) => {
      const req = http.request(this.buildRequestOptions('GET', '/health', headers), (res) => {
        const { statusCode } = res;
        if (!statusCode) {
          reject(new Error('Sidecar response did not include a status code'));
          return;
        }

        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          raw += chunk;
        });
        res.on('end', () => {
          if (statusCode < 200 || statusCode >= 300) {
            const message =
              raw && raw.length > 0
                ? `Sidecar error ${statusCode}: ${raw}`
                : `Sidecar error ${statusCode}`;
            reject(new Error(message));
            return;
          }

          if (!raw) {
            reject(new Error('Sidecar response body was empty'));
            return;
          }

          try {
            const parsed = JSON.parse(raw) as { ok?: boolean; version?: string };
            if (typeof parsed.ok !== 'boolean') {
              reject(new Error('Sidecar health response missing ok field'));
              return;
            }
            resolve({
              ok: parsed.ok,
              ...(parsed.version ? { version: parsed.version } : {}),
            });
          } catch (err) {
            reject(
              new Error(
                `Sidecar response was not valid JSON: ${(err as Error).message ?? String(err)}`,
              ),
            );
          }
        });
      });

      req.on('error', (err: Error) => {
        reject(new Error(`Failed to connect to coding sidecar: ${String(err)}`));
      });

      req.end();
    });
  }

  async runBash(command: string, options?: BashRunOptions): Promise<BashResult> {
    const payload = {
      command,
      ...(options?.timeoutSeconds !== undefined ? { timeoutSeconds: options.timeoutSeconds } : {}),
    };
    const body = JSON.stringify(payload);
    const headers = this.buildHeaders(body);
    const abortSignal = options?.abortSignal;

    return new Promise<BashResult>((resolve, reject) => {
      const req = http.request(
        this.buildRequestOptions('POST', '/bash', headers),
        (res) => {
          const { statusCode } = res;
          if (!statusCode) {
            reject(new Error('Sidecar response did not include a status code'));
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              raw += chunk;
            });
            res.on('end', () => {
              if (!raw) {
                reject(new Error(`Sidecar error ${statusCode}`));
                return;
              }
              try {
                const parsed = JSON.parse(raw) as SidecarResponseEnvelope<BashResult> | BashResult;
                if (typeof (parsed as SidecarResponseEnvelope<BashResult>).ok === 'boolean') {
                  const env = parsed as SidecarResponseEnvelope<BashResult>;
                  if (!env.ok) {
                    const errorPayload = env.error;
                    const message =
                      typeof errorPayload === 'string'
                        ? errorPayload
                        : (errorPayload?.message ?? `Sidecar error ${statusCode}`);
                    reject(new Error(message));
                    return;
                  }
                  if (env.result === undefined) {
                    reject(new Error('Sidecar response missing result payload'));
                    return;
                  }
                  resolve(env.result);
                  return;
                }
              } catch {
                // fall through to generic error
              }
              reject(new Error(`Sidecar error ${statusCode}: ${raw}`));
            });
            return;
          }

          res.setEncoding('utf8');
          let buffer = '';
          let output = '';
          let exitCode: number | undefined;
          let timedOut = false;
          let streamError: Error | undefined;
          let completed = false;

          res.on('data', (chunk: string) => {
            buffer += chunk;
            while (true) {
              const newlineIndex = buffer.indexOf('\n');
              if (newlineIndex === -1) {
                break;
              }
              const line = buffer.slice(0, newlineIndex).trimEnd();
              buffer = buffer.slice(newlineIndex + 1);
              if (!line) {
                continue;
              }
              let parsedLine: unknown;
              try {
                parsedLine = JSON.parse(line) as unknown;
              } catch {
                // Ignore malformed lines but record an error
                streamError = new Error('Received malformed NDJSON chunk from sidecar');
                continue;
              }
              if (!parsedLine || typeof parsedLine !== 'object') {
                continue;
              }
              const anyLine = parsedLine as {
                type?: unknown;
                data?: unknown;
                exitCode?: unknown;
                timedOut?: unknown;
                stream?: unknown;
                message?: unknown;
              };
              const type = typeof anyLine.type === 'string' ? anyLine.type : undefined;
              if (type === 'delta') {
                const data = typeof anyLine.data === 'string' ? anyLine.data : '';
                if (!data) {
                  continue;
                }
                output += data;
                if (options?.onData) {
                  const sourceRaw = anyLine.stream;
                  const source =
                    sourceRaw === 'stdout' || sourceRaw === 'stderr'
                      ? (sourceRaw as 'stdout' | 'stderr')
                      : undefined;
                  options.onData(data, source);
                }
              } else if (type === 'done') {
                if (typeof anyLine.exitCode === 'number') {
                  exitCode = anyLine.exitCode;
                }
                if (typeof anyLine.timedOut === 'boolean') {
                  timedOut = anyLine.timedOut;
                }
              } else if (type === 'error') {
                const message =
                  typeof anyLine.message === 'string' ? anyLine.message : 'Sidecar bash error';
                streamError = new Error(message);
              }
            }
          });

          res.on('end', () => {
            if (completed) {
              return;
            }
            if (streamError) {
              completed = true;
              reject(streamError);
              return;
            }
            if (exitCode === undefined) {
              completed = true;
              reject(new Error('Sidecar bash stream ended without done event'));
              return;
            }
            const result: BashResult = {
              ok: exitCode === 0,
              output,
              exitCode,
              ...(timedOut ? { timedOut: true } : {}),
            };
            completed = true;
            resolve(result);
          });
        },
      );

      const onError = (err: Error) => {
        if (abortSignal?.aborted) {
          reject(new Error('Coding sidecar request aborted'));
          return;
        }
        reject(new Error(`Failed to connect to coding sidecar: ${String(err)}`));
      };

      req.on('error', onError);

      if (abortSignal) {
        if (abortSignal.aborted) {
          req.destroy(new Error('Request aborted by signal'));
        } else {
          abortSignal.addEventListener(
            'abort',
            () => {
              req.destroy(new Error('Request aborted by signal'));
            },
            { once: true },
          );
        }
      }

      req.write(body, 'utf8');
      req.end();
    });
  }

  async readFile(path: string, options?: { offset?: number; limit?: number }): Promise<ReadResult> {
    return this.request<ReadResult>('POST', '/read', {
      path,
      ...(options?.offset !== undefined ? { offset: options.offset } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    });
  }

  async writeFile(path: string, content: string): Promise<WriteResult> {
    return this.request<WriteResult>('POST', '/write', {
      path,
      content,
    });
  }

  async editFile(path: string, oldText: string, newText: string): Promise<EditResult> {
    return this.request<EditResult>('POST', '/edit', {
      path,
      oldText,
      newText,
    });
  }
  async ls(path?: string, options?: { limit?: number }): Promise<LsResult> {
    return this.request<LsResult>('POST', '/ls', {
      ...(typeof path === 'string' && path.trim().length > 0 ? { path } : {}),
      ...(options?.limit !== undefined && Number.isFinite(options.limit) && options.limit > 0
        ? { limit: options.limit }
        : {}),
    });
  }

  async find(options: FindOptions, abortSignal?: AbortSignal): Promise<FindResult> {
    const payload: {
      pattern: string;
      path?: string;
      limit?: number;
    } = {
      pattern: options.pattern,
    };
    if (typeof options.path === 'string' && options.path.trim().length > 0) {
      payload.path = options.path;
    }
    if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
      payload.limit = Math.floor(options.limit);
    }

    return this.request<FindResult>('POST', '/find', payload, abortSignal);
  }

  async grep(options: GrepOptions, abortSignal?: AbortSignal): Promise<GrepResult> {
    return this.request<GrepResult>('POST', '/grep', options, abortSignal);
  }
}
