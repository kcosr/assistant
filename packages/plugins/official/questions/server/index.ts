import { randomUUID } from 'node:crypto';

import type {
  ChatEvent,
  CombinedPluginManifest,
  QuestionnaireSchema,
} from '@assistant/shared';
import {
  QuestionnaireSchema as QuestionnaireSchemaZod,
  findQuestionnaireSchemaIssue,
  mergeQuestionnaireInitialValues,
  validateQuestionnaireInput,
} from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import {
  appendAndBroadcastChatEvents,
  createChatEventBase,
} from '../../../../agent-server/src/events/chatEventUtils';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type QuestionsAskArgs = {
  prompt?: string;
  schema: QuestionnaireSchema;
  timeoutMs?: number;
  completedView?: {
    showInputs?: boolean;
    summaryTemplate?: string;
  };
  validate?: boolean;
  mode?: 'sync' | 'async';
  onTimeout?: 'error' | 'async' | 'cancel';
  autoResume?: boolean;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ToolError('invalid_arguments', `${field} must be a boolean`);
  }
  return value;
}

function parseOptionalMode(value: unknown): QuestionsAskArgs['mode'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'sync' && value !== 'async') {
    throw new ToolError('invalid_arguments', 'mode must be "sync" or "async"');
  }
  return value;
}

function parseOptionalOnTimeout(value: unknown): QuestionsAskArgs['onTimeout'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'error' && value !== 'async' && value !== 'cancel') {
    throw new ToolError('invalid_arguments', 'onTimeout must be "error", "async", or "cancel"');
  }
  return value;
}

function parseOptionalTimeout(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ToolError('invalid_arguments', 'timeoutMs must be a positive number');
  }
  return value;
}

function parseCompletedView(value: unknown): QuestionsAskArgs['completedView'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'completedView must be an object');
  }
  const obj = value as Record<string, unknown>;
  const showInputs = obj['showInputs'];
  if (showInputs !== undefined && typeof showInputs !== 'boolean') {
    throw new ToolError('invalid_arguments', 'completedView.showInputs must be a boolean');
  }
  const summaryTemplate = obj['summaryTemplate'];
  if (summaryTemplate !== undefined && typeof summaryTemplate !== 'string') {
    throw new ToolError('invalid_arguments', 'completedView.summaryTemplate must be a string');
  }
  return {
    ...(showInputs !== undefined ? { showInputs } : {}),
    ...(summaryTemplate !== undefined ? { summaryTemplate } : {}),
  };
}

function ensureSchemaValid(schema: QuestionnaireSchema): void {
  const issue = findQuestionnaireSchemaIssue(schema);
  if (issue) {
    throw new ToolError('invalid_arguments', issue);
  }
}

function parseQuestionnaireArgs(raw: unknown): QuestionsAskArgs {
  const obj = asObject(raw);
  const schemaRaw = obj['schema'];
  if (!schemaRaw || typeof schemaRaw !== 'object' || Array.isArray(schemaRaw)) {
    throw new ToolError('invalid_arguments', 'schema is required and must be an object');
  }
  const parsedSchema = QuestionnaireSchemaZod.safeParse(schemaRaw);
  if (!parsedSchema.success) {
    const issues = parsedSchema.error.errors
      .map((issue) => issue.message)
      .slice(0, 3)
      .join('; ');
    throw new ToolError('invalid_arguments', `schema is invalid: ${issues}`);
  }
  ensureSchemaValid(parsedSchema.data);

  const prompt = parseOptionalString(obj['prompt'], 'prompt');
  const timeoutMs = parseOptionalTimeout(obj['timeoutMs']);
  const completedView = parseCompletedView(obj['completedView']);
  const validate = parseOptionalBoolean(obj['validate'], 'validate');
  const mode = parseOptionalMode(obj['mode']);
  const onTimeout = parseOptionalOnTimeout(obj['onTimeout']);
  const autoResume = parseOptionalBoolean(obj['autoResume'], 'autoResume');

  return {
    schema: parsedSchema.data,
    ...(prompt ? { prompt } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(completedView ? { completedView } : {}),
    ...(validate !== undefined ? { validate } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(onTimeout !== undefined ? { onTimeout } : {}),
    ...(autoResume !== undefined ? { autoResume } : {}),
  };
}

function requireInteraction(ctx: ToolContext) {
  const requestInteraction = ctx.requestInteraction;
  if (!requestInteraction) {
    throw new ToolError(
      'interaction_unavailable',
      'Interactive tools are not available in this environment.',
    );
  }
  return requestInteraction;
}

function requireDurableQuestionnaireContext(ctx: ToolContext): {
  eventStore: NonNullable<ToolContext['eventStore']>;
  sessionHub: NonNullable<ToolContext['sessionHub']>;
} {
  if (!ctx.eventStore || !ctx.sessionHub) {
    throw new ToolError(
      'interaction_unavailable',
      'Async questionnaires require session event persistence and an active session.',
    );
  }
  return {
    eventStore: ctx.eventStore,
    sessionHub: ctx.sessionHub,
  };
}

function resolveToolCallId(ctx: ToolContext): string {
  return typeof ctx.toolCallId === 'string' && ctx.toolCallId.trim().length > 0
    ? ctx.toolCallId.trim()
    : randomUUID();
}

async function emitQuestionnaireRequest(options: {
  ctx: ToolContext;
  toolCallId: string;
  questionnaireRequestId: string;
  prompt?: string;
  schema: QuestionnaireSchema;
  mode: 'sync' | 'async';
  validate?: boolean;
  autoResume?: boolean;
  completedView?: QuestionsAskArgs['completedView'];
  sourceInteractionId?: string;
}): Promise<void> {
  const {
    ctx,
    toolCallId,
    questionnaireRequestId,
    prompt,
    schema,
    mode,
    validate,
    autoResume,
    completedView,
    sourceInteractionId,
  } = options;
  const { eventStore, sessionHub } = requireDurableQuestionnaireContext(ctx);
  const event: ChatEvent = {
    ...createChatEventBase({
      sessionId: ctx.sessionId,
      ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
      ...(ctx.responseId ? { responseId: ctx.responseId } : {}),
    }),
    type: 'questionnaire_request',
    payload: {
      questionnaireRequestId,
      toolCallId,
      toolName: 'questions_ask',
      mode,
      ...(prompt ? { prompt } : {}),
      schema,
      ...(validate !== undefined ? { validate } : {}),
      ...(autoResume !== undefined ? { autoResume } : {}),
      status: 'pending',
      createdAt: new Date().toISOString(),
      ...(sourceInteractionId ? { sourceInteractionId } : {}),
      ...(completedView ? { completedView } : {}),
    },
  };
  await appendAndBroadcastChatEvents({ eventStore, sessionHub, sessionId: ctx.sessionId }, [event]);
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      ask: async (args, ctx) => {
        const parsed = parseQuestionnaireArgs(args);
        const mode = parsed.mode ?? 'sync';
        const schemaWithDefaults = mergeQuestionnaireInitialValues(parsed.schema);

        if (mode === 'async') {
          const questionnaireRequestId = randomUUID();
          const toolCallId = resolveToolCallId(ctx);
          await emitQuestionnaireRequest({
            ctx,
            questionnaireRequestId,
            toolCallId,
            ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
            schema: schemaWithDefaults,
            mode,
            ...(parsed.validate !== undefined ? { validate: parsed.validate } : {}),
            ...(parsed.autoResume !== undefined ? { autoResume: parsed.autoResume } : {}),
            ...(parsed.completedView ? { completedView: parsed.completedView } : {}),
          });
          return {
            ok: true,
            pending: true,
            mode: 'async',
            questionnaireRequestId,
            toolCallId,
            message: 'Questionnaire remains open for a later response.',
            ...(parsed.autoResume === false ? { autoResume: false } : {}),
          };
        }

        const requestInteraction = requireInteraction(ctx);
        return requestInteraction({
          type: 'input',
          presentation: 'questionnaire',
          ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
          ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
          ...(parsed.completedView ? { completedView: parsed.completedView } : {}),
          inputSchema: schemaWithDefaults,
          onTimeout: async () => {
            if (parsed.onTimeout === 'cancel') {
              return {
                complete: {
                  ok: false,
                  cancelled: true,
                },
              };
            }
            if (parsed.onTimeout === 'async') {
              const questionnaireRequestId = randomUUID();
              const toolCallId = resolveToolCallId(ctx);
              await emitQuestionnaireRequest({
                ctx,
                questionnaireRequestId,
                toolCallId,
                ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
                schema: schemaWithDefaults,
                mode: 'async',
                ...(parsed.validate !== undefined ? { validate: parsed.validate } : {}),
                ...(parsed.autoResume !== undefined ? { autoResume: parsed.autoResume } : {}),
                ...(parsed.completedView ? { completedView: parsed.completedView } : {}),
              });
              return {
                complete: {
                  ok: true,
                  pending: true,
                  mode: 'async',
                  questionnaireRequestId,
                  toolCallId,
                  message: 'Questionnaire timed out and remains open for a later response.',
                  convertedFromSync: true,
                  ...(parsed.autoResume === false ? { autoResume: false } : {}),
                },
              };
            }
            return { complete: { ok: false, error: 'Interaction timed out' } };
          },
          onResponse: (response) => {
            if (response.action === 'cancel') {
              return { complete: { ok: false, cancelled: true } };
            }
            if (response.action !== 'submit') {
              return { complete: { ok: false, error: 'Unexpected response action' } };
            }

            const input = response.input ?? {};
            if (parsed.validate !== false) {
              const fieldErrors = validateQuestionnaireInput(parsed.schema, input);
              if (Object.keys(fieldErrors).length > 0) {
                return {
                  reprompt: {
                    type: 'input',
                    presentation: 'questionnaire',
                    ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
                    ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
                    ...(parsed.completedView ? { completedView: parsed.completedView } : {}),
                    inputSchema: {
                      ...parsed.schema,
                      initialValues: input,
                    },
                    errorSummary: 'Please correct the highlighted fields.',
                    fieldErrors,
                  },
                };
              }
            }

            return {
              complete: {
                ok: true,
                answers: input,
              },
            };
          },
        });
      },
    },
  };
}
