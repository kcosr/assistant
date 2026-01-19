import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CombinedPluginManifest } from '@assistant/shared';
import { AgentRegistry } from '../../../../agent-server/src/agents';
import { SessionHub } from '../../../../agent-server/src/sessionHub';
import { SessionIndex } from '../../../../agent-server/src/sessionIndex';
import type { ToolContext } from '../../../../agent-server/src/tools';
import manifestJson from '../manifest.json';
import { createPlugin } from './index';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

describe('sessions plugin operations', () => {
  it('broadcasts session_created when creating a new session', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const broadcastSpy = vi.spyOn(sessionHub, 'broadcastSessionCreated');

    const result = await plugin.operations?.create({ agentId: 'general' }, ctx);

    expect(result).toEqual(expect.objectContaining({ sessionId: expect.any(String) }));
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: (result as { sessionId: string }).sessionId }),
    );
  });
});
