import { describe, expect, it } from 'vitest';

import type {
  CombinedPluginManifest,
  QuestionnaireSchema,
} from '@assistant/shared';
import manifestJson from '../manifest.json';
import type { ToolContext } from '../../../../agent-server/src/tools';
import { createPlugin } from './index';
import type { EventStore } from '../../../../agent-server/src/events';
import type { SessionHub } from '../../../../agent-server/src/sessionHub';

function createTestContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionId: 'test-session',
    signal: new AbortController().signal,
    ...overrides,
  };
}

function createTestPlugin() {
  return createPlugin({ manifest: manifestJson as CombinedPluginManifest });
}

describe('questions plugin', () => {
  it('submits questionnaire answers and applies default values', async () => {
    let capturedSchema: QuestionnaireSchema | undefined;
    const ctx = createTestContext({
      requestInteraction: async (request) => {
        capturedSchema = request.inputSchema as QuestionnaireSchema;
        const outcome = await request.onResponse({
          action: 'submit',
          input: { name: 'Ada', roles: ['dev'] },
        });
        return 'complete' in outcome ? outcome.complete : outcome;
      },
    });

    const plugin = createTestPlugin();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const result = (await ops.ask(
      {
        schema: {
          title: 'Team info',
          fields: [
            {
              id: 'name',
              type: 'text',
              label: 'Name',
              required: true,
              defaultValue: 'Grace',
            },
            {
              id: 'roles',
              type: 'multiselect',
              label: 'Roles',
              options: [
                { label: 'Developer', value: 'dev' },
                { label: 'Designer', value: 'design' },
              ],
            },
          ],
        },
      },
      ctx,
    )) as { ok?: boolean; answers?: Record<string, unknown> };

    expect(capturedSchema?.initialValues).toEqual({ name: 'Grace' });
    expect(result).toEqual({ ok: true, answers: { name: 'Ada', roles: ['dev'] } });
  });

  it('reprompts on validation errors', async () => {
    const ctx = createTestContext({
      requestInteraction: async (request) => {
        const outcome = await request.onResponse({
          action: 'submit',
          input: { email: '', roles: ['ops'] },
        });
        return 'complete' in outcome ? outcome.complete : outcome;
      },
    });

    const plugin = createTestPlugin();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const result = (await ops.ask(
      {
        schema: {
          title: 'Contact',
          fields: [
            { id: 'email', type: 'text', label: 'Email', required: true },
            {
              id: 'roles',
              type: 'multiselect',
              label: 'Roles',
              required: true,
              options: [
                { label: 'Developer', value: 'dev' },
                { label: 'Designer', value: 'design' },
              ],
            },
          ],
        },
      },
      ctx,
    )) as { reprompt?: { fieldErrors?: Record<string, string>; errorSummary?: string } };

    expect(result.reprompt?.errorSummary).toBe('Please correct the highlighted fields.');
    expect(result.reprompt?.fieldErrors).toEqual({
      email: 'This field is required.',
      roles: 'Select valid options.',
    });
  });

  it('returns a durable pending result in async mode', async () => {
    const appendedEvents: unknown[] = [];
    const broadcastEvents: unknown[] = [];
    const eventStore: EventStore = {
      append: async (_sessionId, event) => {
        appendedEvents.push(event);
      },
      appendBatch: async (_sessionId, events) => {
        appendedEvents.push(...events);
      },
      getEvents: async () => [],
      getEventsSince: async () => [],
      subscribe: () => () => {},
      clearSession: async () => {},
      deleteSession: async () => {},
    };
    const sessionHub = {
      broadcastToSession: (_sessionId: string, message: unknown) => {
        broadcastEvents.push(message);
      },
    } as SessionHub;
    const ctx = createTestContext({
      eventStore,
      sessionHub,
    });

    const plugin = createTestPlugin();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const result = (await ops.ask(
      {
        mode: 'async',
        autoResume: false,
        prompt: 'Tell me about yourself',
        schema: {
          title: 'Profile',
          fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
        },
      },
      ctx,
    )) as {
      ok?: boolean;
      pending?: boolean;
      mode?: string;
      questionnaireRequestId?: string;
      toolCallId?: string;
      autoResume?: boolean;
    };

    expect(result.ok).toBe(true);
    expect(result.pending).toBe(true);
    expect(result.mode).toBe('async');
    expect(result.questionnaireRequestId).toMatch(/\S/);
    expect(result.toolCallId).toMatch(/\S/);
    expect(result.autoResume).toBe(false);
    expect(appendedEvents).toHaveLength(1);
    expect((appendedEvents[0] as { type?: string }).type).toBe('questionnaire_request');
    expect(broadcastEvents).toHaveLength(1);
  });
});
