import { existsSync } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import Docker, { type ContainerCreateOptions } from 'dockerode';

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

export interface ContainerResourcesConfig {
  memory?: string;
  cpus?: number;
}

export interface ContainerExecutorOptions {
  image: string;
  socketDir: string;
  workspaceVolume?: string;
  resources?: ContainerResourcesConfig;
  runtime?: 'docker' | 'podman';
  dockerSocketPath?: string;
  docker?: Docker;
  sharedWorkspace?: boolean;
}

const DEFAULT_SOCKET_FILENAME = 'coding-sidecar.sock';
const DEFAULT_SOCKET_DIR = '/var/run/assistant';

export class ContainerExecutor implements ToolExecutor {
  private readonly docker: Docker;
  private readonly image: string;
  private readonly socketDir: string;
  private readonly socketPath: string;
  private readonly workspaceVolume: string | undefined;
  private readonly resources: ContainerResourcesConfig | undefined;
  private readonly sharedWorkspace: boolean;

  private container: Docker.Container | undefined;
  private sidecarClient: SidecarClient | undefined;

  constructor(options: ContainerExecutorOptions) {
    const runtime: 'docker' | 'podman' = options.runtime === 'podman' ? 'podman' : 'docker';
    const dockerSocketPath =
      options.dockerSocketPath && options.dockerSocketPath.trim().length > 0
        ? options.dockerSocketPath
        : getDefaultDockerSocketPath(runtime);

    this.docker = options.docker ?? new Docker({ socketPath: dockerSocketPath });
    this.image = options.image;
    this.socketDir = options.socketDir || DEFAULT_SOCKET_DIR;
    this.socketPath = path.join(this.socketDir, DEFAULT_SOCKET_FILENAME);
    this.workspaceVolume = options.workspaceVolume;
    this.resources = options.resources;
    this.sharedWorkspace = options.sharedWorkspace === true;
  }

  private async ensureSidecarReady(): Promise<void> {
    if (!this.container) {
      await this.createAndStartContainer();
    } else {
      const inspectInfo = await this.container.inspect();
      if (!inspectInfo.State || !inspectInfo.State.Running) {
        await this.container.start();
      }
    }

    if (!this.sidecarClient) {
      this.sidecarClient = new SidecarClient({ socketPath: this.socketPath });
    }
  }

  private async createAndStartContainer(): Promise<void> {
    await mkdir(this.socketDir, { recursive: true });

    // Clean up any stale socket file before starting a new sidecar container.
    try {
      const existing = await stat(this.socketPath);
      if (existing.isSocket()) {
        await unlink(this.socketPath);
      } else {
        throw new Error(`Socket path exists and is not a socket: ${this.socketPath}`);
      }
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (!anyErr || anyErr.code !== 'ENOENT') {
        throw err;
      }
    }

    const hostConfig: ContainerCreateOptions['HostConfig'] = {
      Binds: [`${this.socketDir}:${this.socketDir}`],
    };

    if (this.workspaceVolume) {
      const binds = hostConfig.Binds ?? [];
      // Mount shared workspace volume inside the container at /workspace,
      // which is the default WORKSPACE_ROOT used by the coding sidecar.
      binds.push(`${this.workspaceVolume}:/workspace`);
      hostConfig.Binds = binds;
    }

    if (this.resources?.cpus !== undefined || this.resources?.memory !== undefined) {
      if (this.resources.cpus !== undefined && this.resources.cpus > 0) {
        hostConfig.NanoCpus = Math.floor(this.resources.cpus * 1_000_000_000);
      }

      if (this.resources.memory !== undefined) {
        const parsed = parseMemoryLimit(this.resources.memory);
        if (parsed > 0) {
          hostConfig.Memory = parsed;
        }
      }
    }

    const env: string[] = [`SOCKET_PATH=${this.socketPath}`];

    if (this.workspaceVolume) {
      env.push('WORKSPACE_ROOT=/workspace');
    }

    if (this.sharedWorkspace) {
      env.push('SHARED_WORKSPACE=true');
    }

    const container = await this.docker.createContainer({
      Image: this.image,
      Env: env,
      HostConfig: hostConfig,
      name: 'assistant-coding-sidecar',
    });

    await container.start();
    this.container = container;

    await this.waitForSocketReady();
  }

  private async waitForSocketReady(): Promise<void> {
    const timeoutMs = 10_000;
    const pollIntervalMs = 100;
    const start = Date.now();

    // Simple delay helper to avoid pulling in additional dependencies.
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    while (true) {
      try {
        const info = await stat(this.socketPath);
        if (info.isSocket()) {
          return;
        }
      } catch (err) {
        const anyErr = err as NodeJS.ErrnoException;
        if (!anyErr || anyErr.code !== 'ENOENT') {
          throw err;
        }
      }

      if (Date.now() - start >= timeoutMs) {
        throw new Error(`Timed out waiting for coding sidecar socket at ${this.socketPath}`);
      }

      await delay(pollIntervalMs);
    }
  }

  async shutdown(): Promise<void> {
    const current = this.container;
    if (!current) {
      return;
    }

    try {
      const inspectInfo = await current.inspect();
      if (inspectInfo.State && inspectInfo.State.Running) {
        await current.stop();
      }
    } catch {
      // Best-effort shutdown; ignore errors from stopping the container.
    }

    try {
      await current.remove({ force: true });
    } catch {
      // Ignore errors when removing container; nothing more we can do here.
    }

    this.container = undefined;
    this.sidecarClient = undefined;

    // Best-effort cleanup of the Unix domain socket on shutdown.
    try {
      await unlink(this.socketPath);
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code !== 'ENOENT') {
        // Ignore other errors; there is nothing meaningful we can do here.
      }
    }
  }

  async runBash(sessionId: string, command: string, options?: BashRunOptions): Promise<BashResult> {
    await this.ensureSidecarReady();
    if (!this.sidecarClient) {
      throw new Error('Coding sidecar client is not initialized');
    }
    return this.sidecarClient.runBash(sessionId, command, options);
  }

  async readFile(
    sessionId: string,
    filePath: string,
    options?: { offset?: number; limit?: number },
  ): Promise<ReadResult> {
    await this.ensureSidecarReady();
    if (!this.sidecarClient) {
      throw new Error('Coding sidecar client is not initialized');
    }
    return this.sidecarClient.readFile(sessionId, filePath, options);
  }

  async writeFile(sessionId: string, filePath: string, content: string): Promise<WriteResult> {
    await this.ensureSidecarReady();
    if (!this.sidecarClient) {
      throw new Error('Coding sidecar client is not initialized');
    }
    return this.sidecarClient.writeFile(sessionId, filePath, content);
  }

  async editFile(
    sessionId: string,
    filePath: string,
    oldText: string,
    newText: string,
  ): Promise<EditResult> {
    await this.ensureSidecarReady();
    if (!this.sidecarClient) {
      throw new Error('Coding sidecar client is not initialized');
    }
    return this.sidecarClient.editFile(sessionId, filePath, oldText, newText);
  }

  async ls(sessionId: string, path?: string, options?: LsOptions): Promise<LsResult> {
    await this.ensureSidecarReady();
    if (!this.sidecarClient) {
      throw new Error('Coding sidecar client is not initialized');
    }
    return this.sidecarClient.ls(sessionId, path, options);
  }

  async find(
    sessionId: string,
    options: FindOptions,
    _abortSignal?: AbortSignal,
  ): Promise<FindResult> {
    await this.ensureSidecarReady();
    if (!this.sidecarClient) {
      throw new Error('Coding sidecar client is not initialized');
    }
    return this.sidecarClient.find(sessionId, options);
  }

  async grep(
    sessionId: string,
    options: GrepOptions,
    _abortSignal?: AbortSignal,
  ): Promise<GrepResult> {
    await this.ensureSidecarReady();
    if (!this.sidecarClient) {
      throw new Error('Coding sidecar client is not initialized');
    }
    return this.sidecarClient.grep(sessionId, options);
  }
}

function parseMemoryLimit(value: string): number {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return 0;
  }

  const match = /^(\d+(?:\.\d+)?)([kmgt]?)b?$/.exec(trimmed);
  if (!match) {
    return 0;
  }

  const [, numStr, unit] = match;
  const num = Number(numStr);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }

  const multipliers: Record<string, number> = {
    '': 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
  };

  const unitKey = (unit ?? '') as keyof typeof multipliers;
  const multiplier = multipliers[unitKey] ?? 1;
  return Math.floor(num * multiplier);
}

function getDefaultDockerSocketPath(runtime: 'docker' | 'podman'): string {
  if (runtime === 'podman') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    const rootless = `/run/user/${uid}/podman/podman.sock`;
    if (existsSync(rootless)) {
      return rootless;
    }
    return '/run/podman/podman.sock';
  }
  return '/var/run/docker.sock';
}
