import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { filterVisibleAgents } from './index';
import { AgentRegistry } from './agents';
import { AttachmentStore } from './attachments/store';
import { MAX_ATTACHMENT_SIZE_BYTES } from './attachments/constants';
import { BuiltInToolHost } from './tools';
import type { BuiltInToolDefinition, ToolContext } from './tools';
import { registerBuiltInSessionTools } from './builtInTools';

// Agent tool tests moved to packages/plugins/core/agents/server/index.test.ts.

// context_get_active_artifact has been removed; corresponding tests are no longer needed.

describe('filterVisibleAgents', () => {
  it('applies agentAllowlist patterns when present', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'source',
        displayName: 'Source',
        description: 'Source agent',
        systemPrompt: 'You are the source agent.',
        agentAllowlist: ['helper-*'],
      },
      {
        agentId: 'helper-one',
        displayName: 'Helper One',
        description: 'First helper agent',
        systemPrompt: 'You are helper one.',
      },
      {
        agentId: 'helper-two',
        displayName: 'Helper Two',
        description: 'Second helper agent',
        systemPrompt: 'You are helper two.',
      },
      {
        agentId: 'other',
        displayName: 'Other',
        description: 'Other agent',
        systemPrompt: 'You are other.',
      },
    ]);

    const allAgents = registry.listAgents();
    const visible = filterVisibleAgents(allAgents, 'source', registry);

    const ids = visible.map((agent) => agent.agentId);
    expect(ids).toContain('helper-one');
    expect(ids).toContain('helper-two');
    expect(ids).not.toContain('other');
  });

  it('applies agentDenylist patterns after allowlist', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'source',
        displayName: 'Source',
        description: 'Source agent',
        systemPrompt: 'You are the source agent.',
        agentAllowlist: ['helper-*'],
        agentDenylist: ['helper-secret'],
      },
      {
        agentId: 'helper-1',
        displayName: 'Helper One',
        description: 'First helper agent',
        systemPrompt: 'You are helper one.',
      },
      {
        agentId: 'helper-secret',
        displayName: 'Helper Secret',
        description: 'Secret helper agent',
        systemPrompt: 'You are secret.',
      },
    ]);

    const allAgents = registry.listAgents();
    const visible = filterVisibleAgents(allAgents, 'source', registry);

    const ids = visible.map((agent) => agent.agentId);
    expect(ids).toContain('helper-1');
    expect(ids).not.toContain('helper-secret');
  });

  it('excludes agents marked uiVisible=false even when allowlisted', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'source',
        displayName: 'Source',
        description: 'Source agent',
        systemPrompt: 'You are the source agent.',
        agentAllowlist: ['hidden', 'visible'],
      },
      {
        agentId: 'visible',
        displayName: 'Visible',
        description: 'Visible agent',
        systemPrompt: 'You are visible.',
      },
      {
        agentId: 'hidden',
        displayName: 'Hidden',
        description: 'Hidden agent',
        systemPrompt: 'You are hidden.',
        uiVisible: false,
      },
    ]);

    const allAgents = registry.listAgents();
    const visible = filterVisibleAgents(allAgents, 'source', registry);

    const ids = visible.map((agent) => agent.agentId);
    expect(ids).toContain('visible');
    expect(ids).not.toContain('hidden');
  });
});

describe('registerBuiltInSessionTools', () => {
  async function createTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  }

  function createHost(attachmentStore?: AttachmentStore): BuiltInToolHost {
    const host = new BuiltInToolHost({ tools: new Map<string, BuiltInToolDefinition>() });
    registerBuiltInSessionTools({
      host,
      sessionHub: {
        getAttachmentStore: () => attachmentStore,
      } as never,
    });
    return host;
  }

  function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
    return {
      sessionId: 'session-1',
      signal: new AbortController().signal,
      turnId: 'turn-1',
      toolCallId: 'tool-call-1',
      ...overrides,
    };
  }

  it('registers voice_speak and voice_ask with agent-facing descriptions', async () => {
    const host = createHost();

    const tools = await host.listTools();

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'voice_speak',
          description: expect.stringContaining(
            'Only use this when the user has initiated or requested voice-style interaction.',
          ),
        }),
        expect.objectContaining({
          name: 'voice_ask',
          description: expect.stringContaining('spoken reply is expected'),
        }),
      ]),
    );
  });

  it('registers attachment_send', async () => {
    const host = createHost();

    const tools = await host.listTools();

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'attachment_send',
          description: expect.stringContaining('persistent attachment bubble'),
        }),
      ]),
    );
  });

  it('returns the minimal accepted payload for valid voice prompts', async () => {
    const host = createHost();
    const ctx = createContext();

    await expect(host.callTool('voice_speak', '{"text":"Status update"}', ctx)).resolves.toEqual({
      accepted: true,
    });
    await expect(
      host.callTool('voice_ask', '{"text":"What should I do next?"}', ctx),
    ).resolves.toEqual({
      accepted: true,
    });
  });

  it('rejects missing or empty voice prompt text', async () => {
    const host = createHost();
    const ctx = createContext();

    await expect(host.callTool('voice_speak', '{}', ctx)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'text is required and must be a string',
    });
    await expect(host.callTool('voice_ask', '{"text":"   "}', ctx)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'text must not be empty',
    });
  });

  it('stores text attachments and returns replayable metadata', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-attachments'));
    const host = createHost(store);
    const ctx = createContext();

    const result = (await host.callTool(
      'attachment_send',
      JSON.stringify({
        title: 'Release Notes',
        fileName: 'notes.md',
        contentType: 'text/markdown',
        text: '# Hello\n\nThis is a note.',
      }),
      ctx,
    )) as {
      ok: boolean;
      attachment: {
        attachmentId: string;
        fileName: string;
        title?: string;
        contentType: string;
        size: number;
        downloadUrl: string;
        previewType: string;
        previewText?: string;
      };
    };

    expect(result.ok).toBe(true);
    expect(result.attachment.title).toBe('Release Notes');
    expect(result.attachment.fileName).toBe('notes.md');
    expect(result.attachment.contentType).toBe('text/markdown');
    expect(result.attachment.downloadUrl).toContain('/api/attachments/session-1/');
    expect(result.attachment.previewType).toBe('markdown');
    expect(result.attachment.previewText).toContain('# Hello');

    const stored = await store.getAttachment('session-1', result.attachment.attachmentId);
    expect(stored?.turnId).toBe('turn-1');
    expect(stored?.toolCallId).toBe('tool-call-1');
  });

  it('uses browser_blob open mode for HTML attachments', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-html'));
    const host = createHost(store);

    const result = (await host.callTool(
      'attachment_send',
      JSON.stringify({
        fileName: 'report.html',
        text: '<html><body>Hi</body></html>',
      }),
      createContext(),
    )) as {
      attachment: {
        openUrl?: string;
        openMode?: string;
        previewType: string;
      };
    };

    expect(result.attachment.openUrl).toContain('/api/attachments/session-1/');
    expect(result.attachment.openMode).toBe('browser_blob');
    expect(result.attachment.previewType).toBe('none');
  });

  it('stores base64 attachments and preserves decoded bytes', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-base64'));
    const host = createHost(store);

    const result = (await host.callTool(
      'attachment_send',
      JSON.stringify({
        fileName: 'hello.bin',
        dataBase64: Buffer.from('hello from base64', 'utf8').toString('base64'),
      }),
      createContext(),
    )) as {
      attachment: {
        attachmentId: string;
        contentType: string;
      };
    };

    const stored = await store.getAttachmentFile('session-1', result.attachment.attachmentId);
    expect(stored?.content.toString('utf8')).toBe('hello from base64');
    expect(result.attachment.contentType).toBe('application/octet-stream');
  });

  it('stores bytes from absolute path sources', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-path-bytes'));
    const host = createHost(store);
    const sourcePath = path.join(await createTempDir('built-in-tools-path-source'), 'report.txt');
    await fs.writeFile(sourcePath, 'path sourced bytes', 'utf8');

    const result = (await host.callTool(
      'attachment_send',
      JSON.stringify({
        fileName: 'report.txt',
        path: sourcePath,
      }),
      createContext(),
    )) as {
      attachment: {
        attachmentId: string;
      };
    };

    const stored = await store.getAttachmentFile('session-1', result.attachment.attachmentId);
    expect(stored?.content.toString('utf8')).toBe('path sourced bytes');
  });

  it('rejects attachments larger than 4 MB', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-too-large'));
    const host = createHost(store);

    await expect(
      host.callTool(
        'attachment_send',
        JSON.stringify({
          fileName: 'big.txt',
          text: 'a'.repeat(MAX_ATTACHMENT_SIZE_BYTES + 1),
        }),
        createContext(),
      ),
    ).rejects.toMatchObject({
      code: 'attachment_too_large',
      message: `Attachment exceeds the 4 MB limit (${MAX_ATTACHMENT_SIZE_BYTES + 1} bytes)`,
    });
  });

  it('rejects invalid attachment arguments', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-invalid-attachments'));
    const host = createHost(store);

    await expect(
      host.callTool(
        'attachment_send',
        JSON.stringify({
          fileName: 'note.txt',
          text: 'hello',
          dataBase64: 'aGVsbG8=',
        }),
        createContext(),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Exactly one of text, dataBase64, or path must be provided',
    });

    await expect(
      host.callTool(
        'attachment_send',
        JSON.stringify({
          fileName: 'note.txt',
          path: 'relative/path.txt',
        }),
        createContext(),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'path must be an absolute path',
    });
  });

  it('prefers fileName extension over source path for MIME inference', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-path-inference'));
    const host = createHost(store);
    const sourcePath = path.join(await createTempDir('built-in-tools-source-file'), 'report');
    await fs.writeFile(sourcePath, '<html><body>Hi</body></html>', 'utf8');

    const result = (await host.callTool(
      'attachment_send',
      JSON.stringify({
        fileName: 'report.html',
        path: sourcePath,
      }),
      createContext(),
    )) as {
      attachment: {
        contentType: string;
        openMode?: string;
      };
    };

    expect(result.attachment.contentType).toBe('text/html');
    expect(result.attachment.openMode).toBe('browser_blob');
  });

  it('defaults unknown extensions to application/octet-stream while keeping extensionless text plain', async () => {
    const store = new AttachmentStore(await createTempDir('built-in-tools-unknown-extension'));
    const host = createHost(store);

    const unknownExtension = (await host.callTool(
      'attachment_send',
      JSON.stringify({
        fileName: 'archive.unknownext',
        dataBase64: Buffer.from('abc', 'utf8').toString('base64'),
      }),
      createContext({ toolCallId: 'tool-call-unknown-ext' }),
    )) as {
      attachment: {
        contentType: string;
      };
    };

    const noExtension = (await host.callTool(
      'attachment_send',
      JSON.stringify({
        fileName: 'README',
        text: 'plain text without an extension',
      }),
      createContext({ toolCallId: 'tool-call-no-ext' }),
    )) as {
      attachment: {
        contentType: string;
        previewType: string;
      };
    };

    expect(unknownExtension.attachment.contentType).toBe('application/octet-stream');
    expect(noExtension.attachment.contentType).toBe('text/plain');
    expect(noExtension.attachment.previewType).toBe('text');
  });
});
