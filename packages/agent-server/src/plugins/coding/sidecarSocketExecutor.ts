import { stat } from 'node:fs/promises';

import type {
  BashResult,
  BashRunOptions,
  EditResult,
  FindOptions,
  FindResult,
  GrepOptions,
  GrepResult,
  LsOptions,
  LsResult,
  ReadResult,
  ToolExecutor,
  WriteResult,
} from '@assistant/coding-executor';

import { SidecarClient } from './sidecarClient';

export interface SidecarSocketExecutorOptions {
  socketPath?: string;
  tcp?: {
    host: string;
    port: number;
  };
  waitForReadyMs?: number;
  authToken?: string;
}

const DEFAULT_WAIT_FOR_READY_MS = 10_000;
const POLL_INTERVAL_MS = 100;

export class SidecarSocketExecutor implements ToolExecutor {
  private readonly socketPath: string | undefined;
  private readonly tcpHost: string | undefined;
  private readonly tcpPort: number | undefined;
  private readonly waitForReadyMs: number;
  private readonly sidecarClient: SidecarClient;
  private ready = false;

  constructor(options: SidecarSocketExecutorOptions) {
    this.socketPath = options.socketPath;
    this.tcpHost = options.tcp?.host;
    this.tcpPort = options.tcp?.port;
    this.waitForReadyMs =
      typeof options.waitForReadyMs === 'number' && options.waitForReadyMs > 0
        ? Math.floor(options.waitForReadyMs)
        : DEFAULT_WAIT_FOR_READY_MS;
    this.sidecarClient = new SidecarClient({
      ...(options.socketPath ? { socketPath: options.socketPath } : {}),
      ...(options.tcp ? { tcp: options.tcp } : {}),
      ...(options.authToken ? { authToken: options.authToken } : {}),
    });
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private endpointLabel(): string {
    if (this.socketPath) {
      return `unix:${this.socketPath}`;
    }
    if (this.tcpHost && this.tcpPort) {
      return `tcp://${this.tcpHost}:${this.tcpPort}`;
    }
    return 'tcp endpoint';
  }

  private async waitForSocket(): Promise<void> {
    if (!this.socketPath) {
      return;
    }
    const start = Date.now();
    while (true) {
      try {
        const info = await stat(this.socketPath);
        if (info.isSocket()) {
          return;
        }
        throw new Error(`Socket path exists and is not a socket: ${this.socketPath}`);
      } catch (err) {
        const anyErr = err as NodeJS.ErrnoException;
        if (anyErr && anyErr.code !== 'ENOENT') {
          throw err;
        }
      }

      if (Date.now() - start >= this.waitForReadyMs) {
        throw new Error(`Timed out waiting for coding sidecar at ${this.endpointLabel()}`);
      }

      await this.delay(POLL_INTERVAL_MS);
    }
  }

  private async waitForHealth(): Promise<void> {
    const start = Date.now();
    while (true) {
      try {
        const result = await this.sidecarClient.health();
        if (result && result.ok) {
          return;
        }
      } catch {
        // ignore and retry until timeout
      }

      if (Date.now() - start >= this.waitForReadyMs) {
        throw new Error(`Timed out waiting for coding sidecar at ${this.endpointLabel()}`);
      }

      await this.delay(POLL_INTERVAL_MS);
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) {
      return;
    }

    if (this.socketPath) {
      await this.waitForSocket();
    }

    await this.waitForHealth();
    this.ready = true;
  }

  async shutdown(): Promise<void> {
    this.ready = false;
  }

  async runBash(command: string, options?: BashRunOptions): Promise<BashResult> {
    await this.ensureReady();
    return this.sidecarClient.runBash(command, options);
  }

  async readFile(path: string, options?: { offset?: number; limit?: number }): Promise<ReadResult> {
    await this.ensureReady();
    return this.sidecarClient.readFile(path, options);
  }

  async writeFile(path: string, content: string): Promise<WriteResult> {
    await this.ensureReady();
    return this.sidecarClient.writeFile(path, content);
  }

  async editFile(path: string, oldText: string, newText: string): Promise<EditResult> {
    await this.ensureReady();
    return this.sidecarClient.editFile(path, oldText, newText);
  }

  async ls(path?: string, options?: LsOptions): Promise<LsResult> {
    await this.ensureReady();
    return this.sidecarClient.ls(path, options);
  }

  async find(options: FindOptions, abortSignal?: AbortSignal): Promise<FindResult> {
    await this.ensureReady();
    return this.sidecarClient.find(options, abortSignal);
  }

  async grep(options: GrepOptions, abortSignal?: AbortSignal): Promise<GrepResult> {
    await this.ensureReady();
    return this.sidecarClient.grep(options, abortSignal);
  }
}
