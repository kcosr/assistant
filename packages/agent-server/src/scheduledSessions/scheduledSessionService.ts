import { randomUUID } from 'node:crypto';
import { spawn, type SpawnOptions } from 'node:child_process';

import type { AgentRegistry, CliWrapperConfig } from '../agents';
import type { SessionAttributes, SessionConfig } from '@assistant/shared';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { SessionHub } from '../sessionHub';
import type { SessionIndex, SessionSummary } from '../sessionIndex';
import type { ToolHost } from '../tools';
import type { SearchService } from '../search/searchService';
import { startSessionMessage } from '../sessionMessages';
import { getDefaultModelForNewSession, getDefaultThinkingForNewSession } from '../sessionModel';
import {
  buildSessionAttributesPatchFromConfig,
  getSelectedSessionSkillIds,
  resolveSessionConfigForAgent,
  type ResolvedSessionConfig,
} from '../sessionConfig';
import { buildCliEnv } from '../ws/cliEnv';

import { describeCron, parseNextRun } from './cronUtils';
import { ScheduledSessionStore } from './scheduledSessionStore';
import type {
  LastRunInfo,
  PersistedScheduleRecord,
  ScheduleCreateInput,
  ScheduleDeletedEvent,
  PreCheckResult,
  ScheduleConfig,
  ScheduleInfo,
  ScheduleState,
  ScheduleStatusEvent,
  TriggerResult,
  ScheduleUpdateInput,
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
  store: ScheduledSessionStore;
  sessionHub?: SessionHub;
  sessionIndex?: SessionIndex;
  envConfig?: EnvConfig;
  toolHost?: ToolHost;
  eventStore?: EventStore;
  searchService?: SearchService;
  defaultSessionTimeoutSeconds?: number;
  broadcast?: (event: ScheduleStatusEvent | ScheduleDeletedEvent) => void;
  spawnFn?: typeof spawn;
  startSessionMessageFn?: typeof startSessionMessage;
}

export class ScheduleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleNotFoundError';
  }
}

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleValidationError';
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

    const { logger, store } = this.options;
    const persisted = await store.load();
    this.schedules.clear();

    for (const record of persisted) {
      this.requireAgent(record.agentId);
      const schedule = await this.normalizePersistedSchedule(record);
      const key = this.buildKey(record.agentId, schedule.id);
      if (this.schedules.has(key)) {
        throw new ScheduleValidationError(`Duplicate schedule id "${schedule.id}" for agent "${record.agentId}"`);
      }

      const state: ScheduleState = {
        agentId: record.agentId,
        schedule,
        timer: null,
        deleted: false,
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

    this.initialized = true;
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

  async createSchedule(agentId: string, input: ScheduleCreateInput): Promise<ScheduleInfo> {
    this.requireAgent(agentId);
    const scheduleId = this.generateScheduleId(agentId);
    const schedule = await this.normalizeScheduleConfigForCreate(agentId, scheduleId, input);
    const state: ScheduleState = {
      agentId,
      schedule,
      timer: null,
      deleted: false,
      runningCount: 0,
      runningStartedAt: null,
      nextRunAt: null,
      lastRun: null,
    };

    const key = this.buildKey(agentId, scheduleId);
    this.schedules.set(key, state);
    try {
      await this.persistSchedules();
    } catch (error) {
      this.schedules.delete(key);
      throw error;
    }
    try {
      if (schedule.reuseSession && this.hasSessionDependencies()) {
        await this.resolveScheduledSession(agentId, scheduleId, schedule);
      }
    } catch (error) {
      this.schedules.delete(key);
      await this.persistSchedules();
      throw error;
    }
    if (this.initialized) {
      if (this.isEnabled(state)) {
        this.scheduleNext(key, state);
      } else {
        this.broadcastStatus(state);
      }
    }
    return this.buildScheduleInfo(state);
  }

  async updateSchedule(
    agentId: string,
    scheduleId: string,
    patch: ScheduleUpdateInput,
  ): Promise<ScheduleInfo> {
    const key = this.buildKey(agentId, scheduleId);
    const state = this.requireState(agentId, scheduleId);
    const previousSchedule = state.schedule;
    state.schedule = await this.normalizeScheduleConfigForUpdate(
      agentId,
      scheduleId,
      state.schedule,
      patch,
    );
    try {
      await this.persistSchedules();
    } catch (error) {
      state.schedule = previousSchedule;
      throw error;
    }
    if (this.initialized) {
      if (this.isEnabled(state)) {
        this.scheduleNext(key, state);
      } else {
        if (state.timer) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        state.nextRunAt = null;
        this.broadcastStatus(state);
      }
    }
    return this.buildScheduleInfo(state);
  }

  async deleteSchedule(
    agentId: string,
    scheduleId: string,
  ): Promise<{ agentId: string; scheduleId: string; deleted: true }> {
    const key = this.buildKey(agentId, scheduleId);
    const state = this.requireState(agentId, scheduleId);
    const previousDeleted = state.deleted;
    state.deleted = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.nextRunAt = null;
    this.schedules.delete(key);
    try {
      await this.persistSchedules();
    } catch (error) {
      state.deleted = previousDeleted;
      state.timer = null;
      state.nextRunAt = null;
      this.schedules.set(key, state);
      if (this.initialized && this.isEnabled(state)) {
        this.scheduleNext(key, state);
      }
      throw error;
    }
    this.options.broadcast?.({
      type: 'scheduled_session:deleted',
      payload: { agentId, scheduleId },
    });
    return { agentId, scheduleId, deleted: true };
  }

  triggerRun(
    agentId: string,
    scheduleId: string,
    options?: { force?: boolean },
  ): Promise<TriggerResult> {
    const state = this.requireState(agentId, scheduleId);
    const limit = this.getEffectiveMaxConcurrent(state.schedule);
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

  async setEnabled(agentId: string, scheduleId: string, enabled: boolean): Promise<void> {
    const state = this.requireState(agentId, scheduleId);
    const previousSchedule = state.schedule;
    state.schedule = { ...state.schedule, enabled };
    try {
      await this.persistSchedules();
    } catch (error) {
      state.schedule = previousSchedule;
      throw error;
    }
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

  private scheduleNext(key: string, state: ScheduleState): void {
    const { logger } = this.options;

    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    if (state.deleted) {
      state.nextRunAt = null;
      return;
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
      const effectiveLimit = this.getEffectiveMaxConcurrent(schedule);
      if (state.runningCount >= effectiveLimit) {
        logger.warn(
          `[scheduled-sessions] ${key} skipped: max concurrent (${effectiveLimit}) reached`,
        );
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
        detached: process.platform !== 'win32',
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
        this.killPreCheckProcessTree(child, 'SIGTERM');
        setTimeout(() => this.killPreCheckProcessTree(child, 'SIGKILL'), 2_000).unref();
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

  private killPreCheckProcessTree(
    child: Pick<ReturnType<typeof spawn>, 'pid' | 'kill'>,
    signal: NodeJS.Signals,
  ): void {
    if (process.platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // Fall through to direct child kill when the process group no longer exists.
      }
    }
    child.kill(signal);
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

    const { summary } = await this.resolveScheduledSession(agentId, scheduleId, schedule);
    const reconciledSummary = schedule.reuseSession
      ? await this.reconcileScheduledSession(summary, agentId, schedule)
      : summary;
    const timeoutSeconds = this.options.defaultSessionTimeoutSeconds ?? 300;

    const { response } = await this.startSessionMessageFn({
      input: {
        sessionId: reconciledSummary.sessionId,
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

  private async resolveScheduledSession(
    agentId: string,
    scheduleId: string,
    schedule: ScheduleConfig,
  ): Promise<{
    summary: SessionSummary;
    created: boolean;
  }> {
    const sessionIndex = this.options.sessionIndex;
    const sessionHub = this.options.sessionHub;
    if (!sessionIndex || !sessionHub) {
      throw new Error('Scheduled session dependencies are missing');
    }

    if (!schedule.reuseSession) {
      return this.createScheduledSession(agentId, scheduleId, schedule);
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

    return this.createScheduledSession(agentId, scheduleId, schedule);
  }

  private async createScheduledSession(
    agentId: string,
    scheduleId: string,
    schedule: ScheduleConfig,
  ): Promise<{
    summary: SessionSummary;
    created: boolean;
  }> {
    const sessionIndex = this.options.sessionIndex;
    const sessionHub = this.options.sessionHub;
    if (!sessionIndex || !sessionHub) {
      throw new Error('Scheduled session dependencies are missing');
    }

    const agent = this.options.agentRegistry.getAgent(agentId);
    const resolvedConfig = await this.resolveRuntimeSessionConfig(agentId, schedule);
    const model = resolvedConfig.model ?? getDefaultModelForNewSession(agent);
    const thinking = resolvedConfig.thinking ?? getDefaultThinkingForNewSession(agent);
    const configAttributes = buildSessionAttributesPatchFromConfig(resolvedConfig);
    const attributes = {
      ...(configAttributes ?? {}),
      scheduledSession: {
        agentId,
        scheduleId,
      },
    } satisfies SessionAttributes;
    const summary = await sessionIndex.createSession({
      agentId,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(schedule.sessionTitle ? { name: schedule.sessionTitle } : {}),
      attributes,
    });
    sessionHub.broadcastSessionCreated(summary);
    const updated = await this.syncScheduledSessionTitle(summary, agentId, schedule);
    return { summary: updated, created: true };
  }

  private requireAgent(agentId: string): void {
    const agent = this.options.agentRegistry.getAgent(agentId);
    if (!agent) {
      throw new ScheduleNotFoundError(`Agent not found: ${agentId}`);
    }
  }

  private generateScheduleId(agentId: string): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const id = `schedule-${randomUUID().slice(0, 8)}`;
      if (!this.schedules.has(this.buildKey(agentId, id))) {
        return id;
      }
    }
    return `schedule-${randomUUID()}`;
  }

  private async normalizeScheduleConfigForCreate(
    agentId: string,
    scheduleId: string,
    input: ScheduleCreateInput,
  ): Promise<ScheduleConfig> {
    const cron = this.normalizeRequiredString(input.cron, 'cron');
    const prompt = this.normalizeOptionalString(input.prompt);
    const preCheck = this.normalizeOptionalString(input.preCheck);
    const sessionTitle = this.normalizeOptionalString(input.sessionTitle);
    const sessionConfig = await this.normalizeSessionConfig(agentId, input.sessionConfig);
    const enabled = input.enabled ?? true;
    const reuseSession = input.reuseSession ?? true;
    const maxConcurrent = input.maxConcurrent ?? 1;

    const schedule: ScheduleConfig = {
      id: scheduleId,
      cron,
      enabled,
      reuseSession,
      maxConcurrent,
      ...(prompt ? { prompt } : {}),
      ...(preCheck ? { preCheck } : {}),
      ...(sessionTitle ? { sessionTitle } : {}),
      ...(sessionConfig ? { sessionConfig } : {}),
    };

    this.validateScheduleConfig(agentId, schedule);
    return schedule;
  }

  private async normalizePersistedSchedule(record: PersistedScheduleRecord): Promise<ScheduleConfig> {
    const schedule: ScheduleConfig = {
      id: record.scheduleId,
      cron: record.cron,
      enabled: record.enabled,
      reuseSession: record.reuseSession,
      maxConcurrent: record.maxConcurrent,
      ...(record.prompt !== undefined ? { prompt: record.prompt } : {}),
      ...(record.preCheck !== undefined ? { preCheck: record.preCheck } : {}),
      ...(record.sessionTitle !== undefined ? { sessionTitle: record.sessionTitle } : {}),
      ...(record.sessionConfig !== undefined ? { sessionConfig: record.sessionConfig } : {}),
    };
    this.validateScheduleConfig(record.agentId, schedule);
    return schedule;
  }

  private async normalizeScheduleConfigForUpdate(
    agentId: string,
    scheduleId: string,
    existing: ScheduleConfig,
    patch: ScheduleUpdateInput,
  ): Promise<ScheduleConfig> {
    const next: ScheduleConfig = {
      ...existing,
      ...(patch.cron !== undefined
        ? { cron: this.normalizeRequiredString(patch.cron, 'cron') }
        : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.reuseSession !== undefined ? { reuseSession: patch.reuseSession } : {}),
      ...(patch.maxConcurrent !== undefined ? { maxConcurrent: patch.maxConcurrent } : {}),
    };

    const prompt = this.normalizePatchString(patch.prompt, existing.prompt);
    const preCheck = this.normalizePatchString(patch.preCheck, existing.preCheck);
    const sessionTitle = this.normalizePatchString(patch.sessionTitle, existing.sessionTitle);
    const sessionConfig = await this.normalizeSessionConfigPatch(
      agentId,
      patch.sessionConfig,
      existing.sessionConfig,
    );

    if (prompt !== undefined) {
      next.prompt = prompt;
    } else {
      delete next.prompt;
    }
    if (preCheck !== undefined) {
      next.preCheck = preCheck;
    } else {
      delete next.preCheck;
    }
    if (sessionTitle !== undefined) {
      next.sessionTitle = sessionTitle;
    } else {
      delete next.sessionTitle;
    }
    if (sessionConfig !== undefined) {
      next.sessionConfig = sessionConfig;
    } else {
      delete next.sessionConfig;
    }

    next.id = scheduleId;
    this.validateScheduleConfig(agentId, next);
    return next;
  }

  private normalizeRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ScheduleValidationError(`${field} must be a non-empty string`);
    }
    return value.trim();
  }

  private normalizeOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ScheduleValidationError('optional string fields must be non-empty strings');
    }
    return value.trim();
  }

  private normalizePatchString(
    value: string | null | undefined,
    current: string | undefined,
  ): string | undefined {
    if (value === undefined) {
      return current;
    }
    if (value === null) {
      return undefined;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ScheduleValidationError('optional string fields must be non-empty strings');
    }
    return value.trim();
  }

  private async normalizeSessionConfig(
    agentId: string,
    sessionConfig: SessionConfig | undefined,
  ): Promise<SessionConfig | undefined> {
    if (!sessionConfig) {
      return undefined;
    }
    if (typeof sessionConfig.sessionTitle === 'string' && sessionConfig.sessionTitle.trim().length > 0) {
      throw new ScheduleValidationError(
        'sessionConfig.sessionTitle is not supported here; use sessionTitle instead',
      );
    }
    const agent = this.options.agentRegistry.getAgent(agentId);
    const resolved = await resolveSessionConfigForAgent({
      agent,
      sessionConfig,
      ...(this.options.sessionHub ? { sessionHub: this.options.sessionHub } : {}),
      ...(this.options.toolHost ? { baseToolHost: this.options.toolHost } : {}),
    });
    const model = resolved.model;
    const thinking = resolved.thinking;
    const workingDir = resolved.workingDir;
    const skills = resolved.skills;
    return {
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(workingDir ? { workingDir } : {}),
      ...(skills ? { skills } : {}),
    };
  }

  private async normalizeSessionConfigPatch(
    agentId: string,
    patch: SessionConfig | null | undefined,
    current: SessionConfig | undefined,
  ): Promise<SessionConfig | undefined> {
    if (patch === undefined) {
      return current;
    }
    if (patch === null) {
      return undefined;
    }
    return this.normalizeSessionConfig(agentId, patch);
  }

  private async resolveRuntimeSessionConfig(
    agentId: string,
    schedule: ScheduleConfig,
  ): Promise<ResolvedSessionConfig> {
    const agent = this.options.agentRegistry.getAgent(agentId);
    return resolveSessionConfigForAgent({
      agent,
      ...(schedule.sessionConfig ? { sessionConfig: schedule.sessionConfig } : {}),
      ...(this.options.sessionHub ? { sessionHub: this.options.sessionHub } : {}),
      ...(this.options.toolHost ? { baseToolHost: this.options.toolHost } : {}),
    });
  }

  private validateScheduleConfig(agentId: string, schedule: ScheduleConfig): void {
    this.requireAgent(agentId);
    if (!schedule.id.trim()) {
      throw new ScheduleValidationError('schedule id must be a non-empty string');
    }
    if (
      !isFinite(schedule.maxConcurrent) ||
      !Number.isInteger(schedule.maxConcurrent) ||
      schedule.maxConcurrent < 1
    ) {
      throw new ScheduleValidationError('maxConcurrent must be an integer >= 1');
    }
    if (!schedule.cron.trim()) {
      throw new ScheduleValidationError('cron must be a non-empty string');
    }
    try {
      parseNextRun(schedule.cron);
    } catch {
      throw new ScheduleValidationError(`Invalid 5-field cron expression: "${schedule.cron}"`);
    }
    if (!schedule.prompt && !schedule.preCheck) {
      throw new ScheduleValidationError('schedule must define "prompt", "preCheck", or both');
    }
  }

  private getEffectiveMaxConcurrent(schedule: ScheduleConfig): number {
    return schedule.reuseSession ? 1 : schedule.maxConcurrent ?? 1;
  }

  private buildPersistedRecords(): PersistedScheduleRecord[] {
    return Array.from(this.schedules.values())
      .filter((state) => !state.deleted)
      .map((state) => ({
        agentId: state.agentId,
        scheduleId: state.schedule.id,
        cron: state.schedule.cron,
        enabled: state.schedule.enabled,
        reuseSession: state.schedule.reuseSession,
        maxConcurrent: state.schedule.maxConcurrent,
        ...(state.schedule.prompt !== undefined ? { prompt: state.schedule.prompt } : {}),
        ...(state.schedule.preCheck !== undefined ? { preCheck: state.schedule.preCheck } : {}),
        ...(state.schedule.sessionTitle !== undefined
          ? { sessionTitle: state.schedule.sessionTitle }
          : {}),
        ...(state.schedule.sessionConfig !== undefined
          ? { sessionConfig: state.schedule.sessionConfig }
          : {}),
      }));
  }

  private async persistSchedules(): Promise<void> {
    await this.options.store.save(this.buildPersistedRecords());
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

  private async reconcileScheduledSession(
    summary: SessionSummary,
    agentId: string,
    schedule: ScheduleConfig,
  ): Promise<SessionSummary> {
    const sessionHub = this.options.sessionHub;
    const sessionIndex = this.options.sessionIndex;
    if (!sessionIndex) {
      return summary;
    }
    const agent = this.options.agentRegistry.getAgent(agentId);
    const resolvedConfig = await this.resolveRuntimeSessionConfig(agentId, schedule);
    const targetModel = resolvedConfig.model ?? getDefaultModelForNewSession(agent) ?? null;
    const targetThinking = resolvedConfig.thinking ?? getDefaultThinkingForNewSession(agent) ?? null;
    let current = summary;

    if ((current.model ?? null) !== targetModel) {
      const updated = await sessionIndex.setSessionModel(current.sessionId, targetModel);
      if (updated) {
        current = updated;
      }
    }
    if ((current.thinking ?? null) !== targetThinking) {
      const updated = await sessionIndex.setSessionThinking(current.sessionId, targetThinking);
      if (updated) {
        current = updated;
      }
    }

    const nextAttributes = this.buildScheduledSessionAttributes(
      current.attributes,
      agentId,
      schedule,
      resolvedConfig,
    );
    if (JSON.stringify(current.attributes ?? {}) !== JSON.stringify(nextAttributes)) {
      current =
        (await sessionHub?.updateSessionAttributes(current.sessionId, nextAttributes)) ??
        (await sessionIndex.updateSessionAttributes(current.sessionId, nextAttributes)) ??
        current;
    }

    current = await this.syncScheduledSessionTitle(current, agentId, schedule);
    if (!sessionHub) {
      return current;
    }
    const state = await sessionHub.ensureSessionState(current.sessionId, current, true);
    return state.summary;
  }

  private buildScheduledSessionAttributes(
    currentAttributes: SessionAttributes | undefined,
    agentId: string,
    schedule: ScheduleConfig,
    resolvedConfig: ResolvedSessionConfig,
  ): SessionAttributes {
    const nextAttributes: SessionAttributes = {
      ...(currentAttributes ?? {}),
      scheduledSession: {
        agentId,
        scheduleId: schedule.id,
      },
    };
    const workingDir = resolvedConfig.workingDir;
    const skills = resolvedConfig.skills;
    const existingCore =
      currentAttributes?.core && typeof currentAttributes.core === 'object'
        ? ({ ...(currentAttributes.core as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    if (workingDir) {
      existingCore['workingDir'] = workingDir;
    } else {
      delete existingCore['workingDir'];
    }
    if (Object.keys(existingCore).length > 0) {
      nextAttributes.core = existingCore as NonNullable<SessionAttributes['core']>;
    } else {
      delete nextAttributes.core;
    }

    const existingAgent =
      currentAttributes?.agent && typeof currentAttributes.agent === 'object'
        ? ({ ...(currentAttributes.agent as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    if (skills && skills.length > 0) {
      existingAgent['skills'] = skills;
    } else {
      delete existingAgent['skills'];
    }
    if (Object.keys(existingAgent).length > 0) {
      nextAttributes.agent = existingAgent as NonNullable<SessionAttributes['agent']>;
    } else {
      delete nextAttributes.agent;
    }

    return nextAttributes;
  }

  private async syncScheduledSessionTitle(
    summary: SessionSummary,
    agentId: string,
    schedule: ScheduleConfig,
  ): Promise<SessionSummary> {
    const sessionHub = this.options.sessionHub;
    const sessionIndex = this.options.sessionIndex;
    if (!sessionIndex) {
      return summary;
    }
    let current = summary;
    try {
      const explicitTitle = schedule.sessionTitle?.trim() || '';
      if (explicitTitle) {
        if (current.name !== explicitTitle) {
          current = await sessionIndex.renameSession(current.sessionId, explicitTitle);
        }
        if (this.resolveAutoTitleFromSummary(current)) {
          current =
            (await sessionHub?.updateSessionAttributes(current.sessionId, {
              core: { autoTitle: null },
            })) ??
            (await sessionIndex.updateSessionAttributes(current.sessionId, {
              core: { autoTitle: null },
            })) ??
            current;
        }
      } else {
        if (current.name) {
          current = await sessionIndex.renameSession(current.sessionId, null);
        }
        const autoTitle = this.resolveScheduledSessionAutoTitle(agentId, schedule);
        const existing = this.resolveAutoTitleFromSummary(current);
        if (existing !== autoTitle) {
          current =
            (await sessionHub?.updateSessionAttributes(current.sessionId, {
              core: { autoTitle },
            })) ??
            (await sessionIndex.updateSessionAttributes(current.sessionId, {
              core: { autoTitle },
            })) ??
            current;
        }
      }
    } catch (err) {
      this.options.logger.warn(
        `[scheduled-sessions] Failed to sync session title "${summary.sessionId}": ${String(err)}`,
      );
    }
    return current;
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
    return state.schedule.enabled;
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
    const status = state.runningCount > 0 ? 'running' : enabled ? 'idle' : 'disabled';
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
      ...(state.schedule.sessionConfig ? { sessionConfig: state.schedule.sessionConfig } : {}),
      enabled,
      reuseSession: state.schedule.reuseSession,
      status,
      runningCount: state.runningCount,
      runningStartedAt: state.runningStartedAt ? state.runningStartedAt.toISOString() : null,
      maxConcurrent: state.schedule.maxConcurrent,
      nextRun: state.nextRunAt ? state.nextRunAt.toISOString() : null,
      lastRun,
    };
  }

  private broadcastStatus(state: ScheduleState): void {
    if (state.deleted) {
      return;
    }
    this.options.broadcast?.({
      type: 'scheduled_session:status',
      payload: this.buildScheduleInfo(state),
    });
  }

  private recordLastRun(state: ScheduleState, info: Omit<LastRunInfo, 'timestamp'>): void {
    if (state.deleted) {
      return;
    }
    state.lastRun = {
      timestamp: new Date(),
      ...info,
    };
  }
}
