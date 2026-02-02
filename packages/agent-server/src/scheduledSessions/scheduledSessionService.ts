import { randomUUID } from 'node:crypto';
import { spawn, type SpawnOptions } from 'node:child_process';

import type { AgentRegistry, CliWrapperConfig } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { SessionHub } from '../sessionHub';
import type { SessionIndex, SessionSummary } from '../sessionIndex';
import type { ToolHost } from '../tools';
import type { SearchService } from '../search/searchService';
import { startSessionMessage } from '../sessionMessages';
import { getDefaultModelForNewSession, getDefaultThinkingForNewSession } from '../sessionModel';
import { buildCliEnv } from '../ws/cliEnv';

import { describeCron, parseNextRun } from './cronUtils';
import type {
  LastRunInfo,
  PreCheckResult,
  ScheduleConfig,
  ScheduleInfo,
  ScheduleState,
  ScheduleStatusEvent,
  TriggerResult,
} from './types';

type CliProvider = 'claude-cli' | 'codex-cli' | 'pi-cli';

type CliChatConfig = {
  workdir?: string;
  extraArgs?: string[];
  wrapper?: CliWrapperConfig;
};

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
};

type PromptRunResult =
  | { result: 'completed' }
  | { result: 'failed'; error: string }
  | { result: 'skipped'; skipReason: string };

export interface ScheduledSessionServiceOptions {
  agentRegistry: AgentRegistry;
  logger: Logger;
  dataDir: string;
  sessionHub?: SessionHub;
  sessionIndex?: SessionIndex;
  envConfig?: EnvConfig;
  toolHost?: ToolHost;
  eventStore?: EventStore;
  searchService?: SearchService;
  defaultSessionTimeoutSeconds?: number;
  broadcast?: (event: ScheduleStatusEvent) => void;
  spawnFn?: typeof spawn;
  startSessionMessageFn?: typeof startSessionMessage;
}

export class ScheduleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleNotFoundError';
  }
}

export class ScheduledSessionService {
  private static readonly MAX_TIMEOUT_MS = 2_147_483_647;
  private readonly schedules = new Map<string, ScheduleState>();
  private initialized = false;
  private readonly spawnFn: typeof spawn;
  private readonly startSessionMessageFn: typeof startSessionMessage;

  constructor(private readonly options: ScheduledSessionServiceOptions) {
    this.spawnFn = options.spawnFn ?? spawn;
    this.startSessionMessageFn = options.startSessionMessageFn ?? startSessionMessage;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    const { agentRegistry, logger } = this.options;

    for (const agent of agentRegistry.listAgents()) {
      if (!agent.schedules?.length) {
        continue;
      }

      for (const schedule of agent.schedules) {
        const key = this.buildKey(agent.agentId, schedule.id);

        const state: ScheduleState = {
          agentId: agent.agentId,
          schedule,
          timer: null,
          runtimeEnabled: null,
          runningCount: 0,
          runningStartedAt: null,
          nextRunAt: null,
          lastRun: null,
        };

        this.schedules.set(key, state);

        if (this.isEnabled(state)) {
          this.scheduleNext(key, state);
        }

        logger.info(`[scheduled-sessions] Registered ${key}, cron: ${schedule.cron}`);
        this.broadcastStatus(state);
      }
    }
  }

  shutdown(): void {
    for (const state of this.schedules.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }
    this.schedules.clear();
    this.initialized = false;
  }

  listSchedules(): ScheduleInfo[] {
    return Array.from(this.schedules.values()).map((state) => this.buildScheduleInfo(state));
  }

  triggerRun(
    agentId: string,
    scheduleId: string,
    options?: { force?: boolean },
  ): Promise<TriggerResult> {
    const state = this.requireState(agentId, scheduleId);
    const limit = state.schedule.maxConcurrent ?? 1;
    const force = options?.force === true;

    if (!force && state.runningCount >= limit) {
      return Promise.resolve({
        status: 'skipped',
        reason: 'max_concurrent',
      });
    }

    if (!state.schedule.prompt && !state.schedule.preCheck) {
      return Promise.resolve({
        status: 'skipped',
        reason: 'no_prompt',
      });
    }

    const key = this.buildKey(agentId, scheduleId);
    void this.executeSchedule(key, state, { force, manual: true });
    return Promise.resolve({ status: 'started' });
  }

  setEnabled(agentId: string, scheduleId: string, enabled: boolean): void {
    const state = this.requireState(agentId, scheduleId);
    state.runtimeEnabled = enabled;
    if (enabled) {
      this.scheduleNext(this.buildKey(agentId, scheduleId), state);
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.nextRunAt = null;
    this.broadcastStatus(state);
  }

  clearEnabledOverride(agentId: string, scheduleId: string): void {
    const state = this.requireState(agentId, scheduleId);
    state.runtimeEnabled = null;
    if (this.isEnabled(state)) {
      this.scheduleNext(this.buildKey(agentId, scheduleId), state);
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.nextRunAt = null;
    this.broadcastStatus(state);
  }

  private scheduleNext(key: string, state: ScheduleState): void {
    const { logger } = this.options;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (!this.isEnabled(state)) {
      state.nextRunAt = null;
      this.broadcastStatus(state);
      return;
    }

    try {
      const next = parseNextRun(state.schedule.cron);
      state.nextRunAt = next;

      const delayRaw = next.getTime() - Date.now();
      const delay = Math.max(0, delayRaw);

      logger.info(
        `[scheduled-sessions] ${key} next run at ${next.toISOString()} (in ${Math.round(
          delay / 1000,
        )}s)`,
      );

      const timeoutMs = Math.min(delay, ScheduledSessionService.MAX_TIMEOUT_MS);
      state.timer = setTimeout(() => {
        if (delay > ScheduledSessionService.MAX_TIMEOUT_MS) {
          this.scheduleNext(key, state);
          return;
        }
        void this.executeSchedule(key, state);
      }, timeoutMs);
    } catch (err) {
      logger.error(`[scheduled-sessions] ${key} invalid cron: ${String(err)}`);
      state.nextRunAt = null;
      this.broadcastStatus(state);
      throw err;
    }

    this.broadcastStatus(state);
  }

  private async executeSchedule(
    key: string,
    state: ScheduleState,
    options?: { force?: boolean; manual?: boolean },
  ): Promise<void> {
    const { agentId, schedule } = state;
    const { logger } = this.options;

    if (!options?.manual) {
      this.scheduleNext(key, state);
    }

    if (!options?.manual && !this.isEnabled(state)) {
      logger.info(`[scheduled-sessions] ${key} skipped: disabled`);
      this.recordLastRun(state, { result: 'skipped', skipReason: 'disabled' });
      this.broadcastStatus(state);
      return;
    }

    if (!options?.force) {
      const limit = schedule.maxConcurrent ?? 1;
      if (state.runningCount >= limit) {
        logger.warn(`[scheduled-sessions] ${key} skipped: max concurrent (${limit}) reached`);
        this.recordLastRun(state, { result: 'skipped', skipReason: 'max_concurrent' });
        this.broadcastStatus(state);
        return;
      }
    }

    state.runningCount += 1;
    if (state.runningCount === 1) {
      state.runningStartedAt = new Date();
    }

    logger.info(`[scheduled-sessions] ${key} starting run (running=${state.runningCount})`);
    this.broadcastStatus(state);

    try {
      let preCheckOutput: string | null = null;
      if (schedule.preCheck) {
        const result = await this.runPreCheck(
          schedule.preCheck,
          this.getWorkdir(agentId),
          this.getWrapper(agentId),
        );

        logger.info(`[scheduled-sessions] ${key} preCheck exited with code ${result.exitCode}`);

        if (result.exitCode !== 0) {
          logger.info(`[scheduled-sessions] ${key} skipped: preCheck returned non-zero`);
          this.recordLastRun(state, { result: 'skipped', skipReason: 'precheck_nonzero' });
          return;
        }

        preCheckOutput = result.stdout;
        if (preCheckOutput) {
          logger.debug?.(`[scheduled-sessions] ${key} preCheck output: ${preCheckOutput}`);
        }
      }

      const prompt = this.composePrompt(schedule.prompt, preCheckOutput);
      if (!prompt) {
        logger.warn(`[scheduled-sessions] ${key} skipped: no prompt`);
        this.recordLastRun(state, { result: 'skipped', skipReason: 'no_prompt' });
        return;
      }

      logger.info(`[scheduled-sessions] ${key} running with prompt (${prompt.length} chars)`);

      const outcome = await this.runPrompt(state, prompt);
      if (outcome.result === 'completed') {
        logger.info(`[scheduled-sessions] ${key} completed`);
        this.recordLastRun(state, { result: 'completed' });
      } else if (outcome.result === 'skipped') {
        logger.info(`[scheduled-sessions] ${key} skipped: ${outcome.skipReason}`);
        this.recordLastRun(state, { result: 'skipped', skipReason: outcome.skipReason });
      } else {
        logger.error(`[scheduled-sessions] ${key} failed: ${outcome.error}`);
        this.recordLastRun(state, { result: 'failed', error: outcome.error });
      }
    } catch (err) {
      logger.error(`[scheduled-sessions] ${key} failed: ${String(err)}`);
      this.recordLastRun(state, { result: 'failed', error: String(err) });
    } finally {
      state.runningCount = Math.max(0, state.runningCount - 1);
      if (state.runningCount === 0) {
        state.runningStartedAt = null;
      }
      this.broadcastStatus(state);
    }
  }

  private async runPreCheck(
    command: string,
    workdir: string | undefined,
    wrapper: CliWrapperConfig | null,
  ): Promise<PreCheckResult> {
    const { logger } = this.options;

    return new Promise((resolve) => {
      let settled = false;

      const spawnEnv = buildCliEnv();
      if (wrapper?.env) {
        for (const [key, value] of Object.entries(wrapper.env)) {
          if (key && typeof value === 'string') {
            spawnEnv[key] = value;
          }
        }
      }

      const options: SpawnOptions = {
        cwd: workdir,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      };

      const spawnCommand = wrapper?.path?.trim();
      const spawnArgs = spawnCommand ? ['sh', '-lc', command] : [];
      const child = spawnCommand
        ? this.spawnFn(spawnCommand, spawnArgs, options)
        : this.spawnFn(command, [], { ...options, shell: true });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
        logger.warn(`[scheduled-sessions] preCheck timeout after 30s: ${command}`);
        if (!settled) {
          settled = true;
          resolve({ exitCode: -1, stdout: '', stderr: 'timeout' });
        }
      }, 30_000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          exitCode: code ?? -1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          exitCode: -1,
          stdout: '',
          stderr: String(err),
        });
      });
    });
  }

  private async spawnSession(agentId: string, prompt: string): Promise<void> {
    const { command, args, env, cwd } = this.buildCliCommand(agentId, prompt);

    return new Promise((resolve, reject) => {
      const child = this.spawnFn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'ignore', 'ignore'],
        detached: false,
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CLI exited with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  private composePrompt(prompt: string | undefined, preCheckOutput: string | null): string | null {
    const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
    const trimmedPreCheck =
      typeof preCheckOutput === 'string' ? preCheckOutput.trim() : '';

    if (trimmedPrompt && trimmedPreCheck) {
      return `${trimmedPrompt}\n\n${trimmedPreCheck}`;
    }
    if (trimmedPrompt) {
      return trimmedPrompt;
    }
    if (trimmedPreCheck) {
      return trimmedPreCheck;
    }
    return null;
  }

  private hasSessionDependencies(): boolean {
    return Boolean(
      this.options.sessionHub &&
        this.options.sessionIndex &&
        this.options.envConfig &&
        this.options.toolHost,
    );
  }

  private async runPrompt(state: ScheduleState, prompt: string): Promise<PromptRunResult> {
    const { agentId, schedule } = state;
    const scheduleId = schedule.id;
    if (!this.hasSessionDependencies()) {
      try {
        await this.spawnSession(agentId, prompt);
        return { result: 'completed' };
      } catch (err) {
        return { result: 'failed', error: String(err) };
      }
    }

    const sessionIndex = this.options.sessionIndex;
    const sessionHub = this.options.sessionHub;
    const toolHost = this.options.toolHost;
    const envConfig = this.options.envConfig;
    if (!sessionIndex || !sessionHub || !toolHost || !envConfig) {
      return { result: 'failed', error: 'Scheduled session dependencies are missing' };
    }

    const { summary } = await this.resolveScheduledSession(agentId, scheduleId);
    await this.updateScheduledSessionAutoTitle(summary, agentId, schedule);
    const timeoutSeconds = this.options.defaultSessionTimeoutSeconds ?? 300;

    const { response } = await this.startSessionMessageFn({
      input: {
        sessionId: summary.sessionId,
        content: prompt,
        mode: 'sync',
        timeoutSeconds,
      },
      sessionIndex,
      sessionHub,
      agentRegistry: this.options.agentRegistry,
      toolHost,
      envConfig,
      ...(this.options.eventStore ? { eventStore: this.options.eventStore } : {}),
      ...(this.options.searchService ? { searchService: this.options.searchService } : {}),
      scheduledSessionService: this,
    });

    if (response.status === 'complete') {
      return { result: 'completed' };
    }
    if (response.status === 'busy') {
      return { result: 'skipped', skipReason: 'session_busy' };
    }
    if (response.status === 'timeout') {
      return { result: 'failed', error: response.message };
    }
    if (response.status === 'error') {
      return { result: 'failed', error: response.error };
    }

    return { result: 'failed', error: 'Unexpected session response status' };
  }

  private async resolveScheduledSession(agentId: string, scheduleId: string): Promise<{
    summary: SessionSummary;
    created: boolean;
  }> {
    const sessionIndex = this.options.sessionIndex;
    const sessionHub = this.options.sessionHub;
    if (!sessionIndex || !sessionHub) {
      throw new Error('Scheduled session dependencies are missing');
    }

    const summaries = await sessionIndex.listSessions();
    const matches = summaries.filter((summary) => {
      if (summary.agentId !== agentId) {
        return false;
      }
      const scheduled = this.getScheduledSessionMetadata(summary);
      return scheduled?.agentId === agentId && scheduled.scheduleId === scheduleId;
    });

    matches.sort((a, b) => {
      const aUpdated = Date.parse(a.updatedAt);
      const bUpdated = Date.parse(b.updatedAt);
      return bUpdated - aUpdated;
    });

    const existing = matches[0];
    if (existing) {
      return { summary: existing, created: false };
    }

    const agent = this.options.agentRegistry.getAgent(agentId);
    const model = getDefaultModelForNewSession(agent);
    const thinking = getDefaultThinkingForNewSession(agent);
    const summary = await sessionIndex.createSession(
      model || thinking
        ? { agentId, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) }
        : { agentId },
    );
    sessionHub.broadcastSessionCreated(summary);

    const metadataPatch = {
      scheduledSession: {
        agentId,
        scheduleId,
      },
    };

    const updated =
      (await sessionHub.updateSessionAttributes(summary.sessionId, metadataPatch)) ?? summary;

    return { summary: updated, created: true };
  }

  private getScheduledSessionMetadata(summary: SessionSummary): {
    agentId: string;
    scheduleId: string;
  } | null {
    const attributes = summary.attributes;
    if (!attributes || typeof attributes !== 'object') {
      return null;
    }
    const raw = (attributes as Record<string, unknown>)['scheduledSession'];
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const data = raw as Record<string, unknown>;
    const agentId = typeof data['agentId'] === 'string' ? data['agentId'].trim() : '';
    const scheduleId =
      typeof data['scheduleId'] === 'string' ? data['scheduleId'].trim() : '';
    if (!agentId || !scheduleId) {
      return null;
    }
    return { agentId, scheduleId };
  }

  private resolveScheduledSessionAutoTitle(
    agentId: string,
    schedule: ScheduleConfig,
  ): string {
    const configuredTitle = schedule.sessionTitle?.trim();
    if (configuredTitle) {
      return configuredTitle;
    }
    return this.buildScheduledSessionAutoTitle(agentId, schedule.id);
  }

  private buildScheduledSessionAutoTitle(agentId: string, scheduleId: string): string {
    const timestamp = this.formatTimestampForName(new Date());
    return `scheduled: ${agentId}/${scheduleId} @ ${timestamp}`;
  }

  private formatTimestampForName(date: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}`;
  }

  private resolveAutoTitleFromSummary(summary: SessionSummary): string {
    const attributes = summary.attributes;
    if (!attributes || typeof attributes !== 'object') {
      return '';
    }
    const core = (attributes as Record<string, unknown>)['core'];
    if (!core || typeof core !== 'object') {
      return '';
    }
    const autoTitle = (core as Record<string, unknown>)['autoTitle'];
    if (typeof autoTitle !== 'string') {
      return '';
    }
    return autoTitle.trim();
  }

  private async updateScheduledSessionAutoTitle(
    summary: SessionSummary,
    agentId: string,
    schedule: ScheduleConfig,
  ): Promise<void> {
    const sessionHub = this.options.sessionHub;
    const sessionIndex = this.options.sessionIndex;
    if (!sessionIndex) {
      return;
    }
    const autoTitle = this.resolveScheduledSessionAutoTitle(agentId, schedule);
    const existing = this.resolveAutoTitleFromSummary(summary);
    if (existing === autoTitle) {
      return;
    }
    try {
      const patch = { core: { autoTitle } };
      if (sessionHub?.updateSessionAttributes) {
        await sessionHub.updateSessionAttributes(summary.sessionId, patch);
      } else {
        await sessionIndex.updateSessionAttributes(summary.sessionId, patch);
      }
    } catch (err) {
      this.options.logger.warn(
        `[scheduled-sessions] Failed to set session autoTitle "${autoTitle}": ${String(err)}`,
      );
    }
  }

  private buildCliCommand(agentId: string, prompt: string): {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
  } {
    const { provider, config } = this.requireCliConfig(agentId);
    const wrapperPath = config?.wrapper?.path?.trim();
    const wrapperEnv = config?.wrapper?.env;
    const wrapperEnabled = Boolean(wrapperPath);

    const env = buildCliEnv();
    if (wrapperEnabled && wrapperEnv) {
      for (const [key, value] of Object.entries(wrapperEnv)) {
        if (key && typeof value === 'string') {
          env[key] = value;
        }
      }
    }

    const cwd = config?.workdir?.trim() || undefined;

    if (provider === 'claude-cli') {
      const args = [
        '-p',
        '--verbose',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
      ];
      if (config?.extraArgs?.length) {
        args.push(...config.extraArgs);
      }
      args.push('--session-id', randomUUID(), prompt);
      return {
        command: wrapperEnabled && wrapperPath ? wrapperPath : 'claude',
        args: wrapperEnabled ? ['claude', ...args] : args,
        env,
        ...(cwd ? { cwd } : {}),
      };
    }

    if (provider === 'codex-cli') {
      const args = ['exec', '--json'];
      if (config?.extraArgs?.length) {
        args.push(...config.extraArgs);
      }
      args.push(prompt);
      return {
        command: wrapperEnabled && wrapperPath ? wrapperPath : 'codex',
        args: wrapperEnabled ? ['codex', ...args] : args,
        env,
        ...(cwd ? { cwd } : {}),
      };
    }

    const args = ['--mode', 'json'];
    if (config?.extraArgs?.length) {
      args.push(...config.extraArgs);
    }
    args.push('-p', prompt);
    return {
      command: wrapperEnabled && wrapperPath ? wrapperPath : 'pi',
      args: wrapperEnabled ? ['pi', ...args] : args,
      env,
      ...(cwd ? { cwd } : {}),
    };
  }

  private buildKey(agentId: string, scheduleId: string): string {
    return `${agentId}:${scheduleId}`;
  }

  private requireState(agentId: string, scheduleId: string): ScheduleState {
    const key = this.buildKey(agentId, scheduleId);
    const state = this.schedules.get(key);
    if (!state) {
      throw new ScheduleNotFoundError(`Schedule not found: ${key}`);
    }
    return state;
  }

  private isEnabled(state: ScheduleState): boolean {
    return state.runtimeEnabled ?? state.schedule.enabled;
  }

  private getWorkdir(agentId: string): string | undefined {
    const config = this.requireCliConfig(agentId).config;
    const workdir = config?.workdir?.trim();
    return workdir && workdir.length > 0 ? workdir : undefined;
  }

  private getWrapper(agentId: string): CliWrapperConfig | null {
    const config = this.requireCliConfig(agentId).config;
    return config?.wrapper ?? null;
  }

  private requireCliConfig(agentId: string): { provider: CliProvider; config?: CliChatConfig } {
    const agent = this.options.agentRegistry.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    const provider = agent.chat?.provider ?? 'pi';
    if (provider !== 'claude-cli' && provider !== 'codex-cli' && provider !== 'pi-cli') {
      throw new Error(`Agent ${agentId} uses unsupported provider: ${provider}`);
    }
    const config = agent.chat?.config as CliChatConfig | undefined;
    return {
      provider,
      ...(config ? { config } : {}),
    };
  }

  private buildScheduleInfo(state: ScheduleState): ScheduleInfo {
    const enabled = state.schedule.enabled;
    const runtimeEnabled = this.isEnabled(state);
    const status = state.runningCount > 0 ? 'running' : runtimeEnabled ? 'idle' : 'disabled';
    const lastRun = state.lastRun
      ? {
          timestamp: state.lastRun.timestamp.toISOString(),
          result: state.lastRun.result,
          ...(state.lastRun.error ? { error: state.lastRun.error } : {}),
          ...(state.lastRun.skipReason ? { skipReason: state.lastRun.skipReason } : {}),
        }
      : null;

    return {
      agentId: state.agentId,
      scheduleId: state.schedule.id,
      cron: state.schedule.cron,
      cronDescription: describeCron(state.schedule.cron),
      ...(state.schedule.prompt ? { prompt: state.schedule.prompt } : {}),
      ...(state.schedule.preCheck ? { preCheck: state.schedule.preCheck } : {}),
      ...(state.schedule.sessionTitle ? { sessionTitle: state.schedule.sessionTitle } : {}),
      enabled,
      runtimeEnabled,
      status,
      runningCount: state.runningCount,
      runningStartedAt: state.runningStartedAt ? state.runningStartedAt.toISOString() : null,
      maxConcurrent: state.schedule.maxConcurrent,
      nextRun: state.nextRunAt ? state.nextRunAt.toISOString() : null,
      lastRun,
    };
  }

  private broadcastStatus(state: ScheduleState): void {
    this.options.broadcast?.({
      type: 'scheduled_session:status',
      payload: this.buildScheduleInfo(state),
    });
  }

  private recordLastRun(state: ScheduleState, info: Omit<LastRunInfo, 'timestamp'>): void {
    state.lastRun = {
      timestamp: new Date(),
      ...info,
    };
  }
}
