import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgentRegistry } from './agents';
import { SessionHub } from './sessionHub';
import { SessionIndex } from './sessionIndex';
import type { LogicalSessionState } from './sessionHub';
import { updateSystemPromptWithTools } from './systemPromptUpdater';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

describe('updateSystemPromptWithTools', () => {
  it('preserves project directory in the system prompt', async () => {
    const agentRegistry = new AgentRegistry([
      { agentId: 'general', displayName: 'General', description: 'General agent' },
    ]);
    const sessionIndex = new SessionIndex(createTempFile('system-prompt-updater'));
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });

    const state: LogicalSessionState = {
      summary: {
        sessionId: 'session-1',
        agentId: 'general',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attributes: { core: { workingDir: '/home/kevin/worktrees/project-a' } },
      },
      chatMessages: [{ role: 'system', content: 'Old system prompt' }],
      activeChatRun: undefined,
      messageQueue: [],
    };

    await updateSystemPromptWithTools({
      state,
      sessionHub,
      tools: [
        {
          name: 'lists_list',
          description: 'List items',
          parameters: {},
        },
      ],
    });

    expect(state.chatMessages[0]?.content).toContain(
      'Project directory: /home/kevin/worktrees/project-a',
    );
  });
});
