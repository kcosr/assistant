import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRegistry } from './agents';
import { buildSystemPrompt } from './index';
import type { SkillSummary } from './skills';
import type { Tool } from './tools';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeSkill(options: {
  root: string;
  dirName: string;
  frontmatter: string;
  body: string;
}): string {
  const { root, dirName, frontmatter, body } = options;
  const dirPath = path.join(root, dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  const skillPath = path.join(dirPath, 'SKILL.md');
  fs.writeFileSync(skillPath, `${frontmatter.trim()}\n\n${body}\n`, 'utf8');
  return skillPath;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSystemPrompt', () => {
  it('uses default system prompt when no agentId is provided and lists all agents', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'reading-list',
        displayName: 'Reading List Manager',
        description: 'Manages articles and links to read later',
        systemPrompt:
          'You are a reading list manager.\nHelp the user track articles, papers, and links.',
        toolAllowlist: ['reading_list_*'],
      },
      {
        agentId: 'todo',
        displayName: 'Todo Manager',
        description: 'Tracks tasks and reminders',
        systemPrompt: 'You are a todo list manager. Help the user track tasks.',
      },
    ]);

    const prompt = buildSystemPrompt(registry, undefined);

    expect(prompt).toContain('You are a helpful AI assistant.');
    expect(prompt).toContain('Available agents you can delegate to:');
    expect(prompt).toContain(
      '- reading-list: Reading List Manager - Manages articles and links to read later',
    );
    expect(prompt).toContain('- todo: Todo Manager - Tracks tasks and reminders');
    expect(prompt).toContain('Use agents_list to see available agents (also listed above).');
    expect(prompt).toContain('Use agents_message to send a message to another agent:');
    expect(prompt).toContain(
      '  - session: "create" for fresh tasks, "latest" to continue prior work, "latest-or-create" (default) for general use',
    );
    expect(prompt).toContain(
      '  - mode: "sync" (default) to wait for response, "async" for fire-and-forget (no response returned)',
    );
  });

  it('uses agent system prompt when agentId is provided and excludes the current agent', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'reading-list',
        displayName: 'Reading List Manager',
        description: 'Manages articles and links to read later',
        systemPrompt: 'You manage a reading list.',
      },
      {
        agentId: 'todo',
        displayName: 'Todo Manager',
        description: 'Tracks tasks and reminders',
        systemPrompt: 'You manage todos.',
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'reading-list');

    expect(prompt.startsWith('You manage a reading list.')).toBe(true);
    expect(prompt).toContain('- todo: Todo Manager - Tracks tasks and reminders');
    expect(prompt).not.toContain('reading-list: Reading List Manager');
  });

  it('omits available-agents list when no agents are configured', () => {
    const registry = new AgentRegistry([]);

    const prompt = buildSystemPrompt(registry, undefined);

    expect(prompt).toContain('You are a helpful AI assistant.');

    // When no agents are available, the available agents list section should be omitted
    // (though the default prompt still mentions the agent tools in general)
    expect(prompt).not.toContain('Available agents you can delegate to:');
  });

  it('falls back to the default system prompt when the agentId is not found', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'reading-list',
        displayName: 'Reading List Manager',
        description: 'Manages articles and links to read later',
        systemPrompt: 'You manage a reading list.',
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'unknown-agent');

    expect(prompt).toContain('You are a helpful AI assistant.');
    expect(prompt.startsWith('You are a helpful AI assistant.')).toBe(true);
    expect(prompt).toContain(
      '- reading-list: Reading List Manager - Manages articles and links to read later',
    );
  });

  it('only lists agents that are visible from the current agent', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'primary',
        displayName: 'Primary',
        description: 'Primary agent',
        systemPrompt: 'You are the primary agent.',
        agentAllowlist: ['secondary'],
      },
      {
        agentId: 'secondary',
        displayName: 'Secondary',
        description: 'Secondary agent',
        systemPrompt: 'You are the secondary agent.',
      },
      {
        agentId: 'hidden',
        displayName: 'Hidden',
        description: 'Hidden agent',
        systemPrompt: 'You are hidden.',
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'primary');

    expect(prompt).toContain('- secondary: Secondary - Secondary agent');
    expect(prompt).not.toContain('- hidden: Hidden - Hidden agent');
  });

  it('generates default prompt from displayName and description when systemPrompt is omitted', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'reading-list',
        displayName: 'Reading List Manager',
        description: 'Manages your reading queue of articles and links.',
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'reading-list');

    expect(prompt).toContain('You are Reading List Manager.');
    expect(prompt).toContain('Manages your reading queue of articles and links.');
  });

  it('includes tools section when tools are provided', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'reading-list',
        displayName: 'Reading List Manager',
        description: 'Manages your reading queue.',
        systemPrompt: 'You are a reading list assistant.',
      },
    ]);

    const tools: Tool[] = [
      { name: 'reading_list_add', description: 'Add an item to the reading list', parameters: {} },
      { name: 'reading_list_list', description: 'List items in the reading list', parameters: {} },
      { name: 'agents_message', description: 'Message another agent', parameters: {} },
    ];

    const prompt = buildSystemPrompt(registry, 'reading-list', tools);

    expect(prompt).toContain('Available tools:');
    expect(prompt).toContain('- reading_list_add: Add an item to the reading list');
    expect(prompt).toContain('- reading_list_list: List items in the reading list');
    // system_ tools should not be listed in the tools section
    expect(prompt).not.toContain('- agents_message');
  });

  it('omits tools section when no non-system tools are provided', () => {
    const registry = new AgentRegistry([]);

    const tools: Tool[] = [
      { name: 'agents_message', description: 'Message another agent', parameters: {} },
    ];

    const prompt = buildSystemPrompt(registry, undefined, tools);

    expect(prompt).not.toContain('Available tools:');
  });

  it('includes message context section when tools are present', () => {
    const registry = new AgentRegistry([]);

    const tools: Tool[] = [
      { name: 'lists_create', description: 'Create a list', parameters: {} },
      { name: 'lists_get', description: 'Get a list', parameters: {} },
    ];

    const prompt = buildSystemPrompt(registry, undefined, tools);

    expect(prompt).toContain('## Message Context');
    expect(prompt).toContain('Each user message begins with a context line in XML format');
    expect(prompt).toContain(
      '<context panel-id="<panel-id>" panel-type="<panel-type>" panel-title="<panel-title>" />',
    );
    expect(prompt).toContain(
      'Always rely on this context line for the current panel and selection',
    );
    expect(prompt).toContain('mode: Optional. When set to "brief"');
  });

  it('omits message context section when no tools or skills are present', () => {
    const registry = new AgentRegistry([]);
    const prompt = buildSystemPrompt(registry, undefined);

    expect(prompt).not.toContain('## Message Context');
  });

  it('includes message context section with notes tools', () => {
    const registry = new AgentRegistry([]);

    const tools: Tool[] = [
      { name: 'notes_create', description: 'Create a note', parameters: {} },
      { name: 'notes_get', description: 'Get a note', parameters: {} },
    ];

    const prompt = buildSystemPrompt(registry, undefined, tools);

    expect(prompt).toContain('## Message Context');
  });

  it('includes skills section when CLI skills are provided', () => {
    const registry = new AgentRegistry([]);
    const skills: SkillSummary[] = [
      {
        id: 'notes',
        name: 'Notes',
        description: 'Notes tools',
        skillsPath: '/tmp/skills/notes/SKILL.md',
        cliPath: '/tmp/skills/notes/notes-cli',
        toolNames: ['notes_read'],
      },
    ];

    const prompt = buildSystemPrompt({
      agentRegistry: registry,
      agentId: undefined,
      tools: [],
      skills,
    });

    expect(prompt).toContain('Available CLI skills:');
    expect(prompt).toContain('notes: Notes tools');
    expect(prompt).toContain('/tmp/skills/notes/SKILL.md');
    expect(prompt).toContain('/tmp/skills/notes/notes-cli');
  });

  it('includes message context when artifact skills are present', () => {
    const registry = new AgentRegistry([]);
    const skills: SkillSummary[] = [
      {
        id: 'notes',
        name: 'Notes',
        description: 'Notes tools',
        skillsPath: '/tmp/skills/notes/SKILL.md',
        cliPath: '/tmp/skills/notes/notes-cli',
        toolNames: ['notes_read'],
      },
    ];

    const prompt = buildSystemPrompt({
      agentRegistry: registry,
      agentId: undefined,
      tools: [],
      skills,
    });

    expect(prompt).toContain('## Message Context');
  });

  it('includes Pi-style instruction skills blocks when configured on the agent', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const root = createTempDir('instruction-skills');
    const listsPath = writeSkill({
      root,
      dirName: 'lists',
      frontmatter: `---
name: lists
description: Lists skill
---`,
      body: '# Lists Skill\n\nDo list things.',
    });
    const criticalPath = writeSkill({
      root,
      dirName: 'my-critical-x',
      frontmatter: `---
name: my-critical-x
description: Critical skill
---`,
      body: '# Critical Skill\n\nDo critical things.',
    });

    const registry = new AgentRegistry([
      {
        agentId: 'agent',
        displayName: 'Agent',
        description: 'Agent',
        skills: [{ root, available: ['*'], inline: ['my-critical-*'] }],
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'agent');

    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain(`<location>${listsPath}</location>`);
    expect(prompt).not.toContain('<name>my-critical-x</name>');
    expect(prompt).toContain(`<skill name="my-critical-x" location="${criticalPath}">`);
    expect(prompt).toContain(`References are relative to ${path.dirname(criticalPath)}.`);
    expect(prompt).toContain('# Critical Skill');
    expect(prompt).not.toContain('name: my-critical-x');

    expect(warnSpy).toHaveBeenCalled();
  });

  it('defaults a skills source with only root to available: [\"*\"]', () => {
    const root = createTempDir('instruction-skills-defaults');
    writeSkill({
      root,
      dirName: 'alpha',
      frontmatter: `---
name: alpha
description: Alpha skill
---`,
      body: '# Alpha Skill',
    });

    const registry = new AgentRegistry([
      {
        agentId: 'agent',
        displayName: 'Agent',
        description: 'Agent',
        skills: [{ root }],
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'agent');

    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('<name>alpha</name>');
    expect(prompt).not.toContain('<skill name="alpha"');
  });

  it('warns and keeps the first discovered skill when names collide within a root', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const root = createTempDir('instruction-skills-collision');
    const first = writeSkill({
      root,
      dirName: 'a',
      frontmatter: `---
name: dup
description: First dup
---`,
      body: '# First',
    });
    const second = writeSkill({
      root,
      dirName: 'b',
      frontmatter: `---
name: dup
description: Second dup
---`,
      body: '# Second',
    });

    const registry = new AgentRegistry([
      {
        agentId: 'agent',
        displayName: 'Agent',
        description: 'Agent',
        skills: [{ root, available: ['dup'] }],
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'agent');

    expect(prompt).toContain(`<location>${first}</location>`);
    expect(prompt).not.toContain(`<location>${second}</location>`);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate skill name "dup"'));
  });

  it('warns and skips skills with missing or empty description', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const root = createTempDir('instruction-skills-missing-desc');
    writeSkill({
      root,
      dirName: 'no-desc',
      frontmatter: `---
name: no-desc
---`,
      body: '# No Desc',
    });

    const registry = new AgentRegistry([
      {
        agentId: 'agent',
        displayName: 'Agent',
        description: 'Agent',
        skills: [{ root }],
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'agent');

    expect(prompt).not.toContain('<name>no-desc</name>');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('missing or empty description'),
    );
  });

  it('warns and falls back to parent directory name when frontmatter name is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const root = createTempDir('instruction-skills-missing-name');
    writeSkill({
      root,
      dirName: 'fallback-name',
      frontmatter: `---
description: Has description
---`,
      body: '# Fallback',
    });

    const registry = new AgentRegistry([
      {
        agentId: 'agent',
        displayName: 'Agent',
        description: 'Agent',
        skills: [{ root, available: ['fallback-name'] }],
      },
    ]);

    const prompt = buildSystemPrompt(registry, 'agent');

    expect(prompt).toContain('<name>fallback-name</name>');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to "fallback-name"'));
  });
});
