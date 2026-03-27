export interface ScheduleConfig {
  id: string;
  cron: string;
  prompt?: string;
  preCheck?: string;
  sessionTitle?: string;
  enabled: boolean;
  reuseSession: boolean;
  maxConcurrent: number;
}

export interface ScheduleCreateInput {
  cron: string;
  prompt?: string;
  preCheck?: string;
  sessionTitle?: string;
  enabled?: boolean;
  reuseSession?: boolean;
  maxConcurrent?: number;
}

export interface ScheduleUpdateInput {
  cron?: string;
  prompt?: string | null;
  preCheck?: string | null;
  sessionTitle?: string | null;
  enabled?: boolean;
  reuseSession?: boolean;
  maxConcurrent?: number;
}

export interface LastRunInfo {
  timestamp: Date;
  result: 'completed' | 'failed' | 'skipped';
  error?: string;
  skipReason?: 'disabled' | 'no_prompt' | 'max_concurrent' | 'precheck_nonzero' | string;
}

export interface ScheduleState {
  agentId: string;
  schedule: ScheduleConfig;
  timer: NodeJS.Timeout | null;
  runtimeEnabled: boolean | null;
  deleted: boolean;
  runningCount: number;
  runningStartedAt: Date | null;
  nextRunAt: Date | null;
  lastRun: LastRunInfo | null;
}

export interface PreCheckResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ScheduleInfo {
  agentId: string;
  scheduleId: string;
  cron: string;
  cronDescription: string;
  prompt?: string;
  preCheck?: string;
  sessionTitle?: string;
  enabled: boolean;
  runtimeEnabled: boolean;
  reuseSession: boolean;
  status: 'idle' | 'running' | 'disabled';
  runningCount: number;
  runningStartedAt: string | null;
  maxConcurrent: number;
  nextRun: string | null;
  lastRun: {
    timestamp: string;
    result: 'completed' | 'failed' | 'skipped';
    error?: string;
    skipReason?: string;
  } | null;
}

export interface TriggerResult {
  status: 'started' | 'skipped';
  reason?: 'disabled' | 'no_prompt' | 'max_concurrent' | 'precheck_nonzero' | null;
}

export interface ScheduleStatusEvent {
  type: 'scheduled_session:status';
  payload: ScheduleInfo;
}

export interface ScheduleDeletedEvent {
  type: 'scheduled_session:deleted';
  payload: {
    agentId: string;
    scheduleId: string;
  };
}
