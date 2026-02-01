import { matchesGlobPattern, type Tool } from './tools';
import type { SkillSummary } from './skills';
import { AgentRegistry, type AgentDefinition } from './agents';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. Always respond in English unless the user explicitly asks for a different language.

You must not create, modify, infer, or remove organizational tags (such as list or note tags) unless the user explicitly asks you to do so. Only change tags when the user clearly requests a tag-related operation (for example, adding, removing, or renaming tags).

You can collaborate with other specialized agents using the agents_* tools.

When coordinating between agents:
- Use agents_message to send a message to another agent. Prefer sync mode when you need the response in this conversation, and async mode for background or fire-and-forget tasks.`;

export function filterVisibleAgents(
  allAgents: AgentDefinition[],
  fromAgentId: string | undefined,
  agentRegistry: AgentRegistry,
): AgentDefinition[] {
  const uiVisibleAgents = allAgents.filter((agent) => agent.uiVisible !== false);
  if (!fromAgentId) {
    return uiVisibleAgents;
  }

  const sourceAgent = agentRegistry.getAgent(fromAgentId);
  if (!sourceAgent) {
    return uiVisibleAgents;
  }

  const allowlist = sourceAgent.agentAllowlist;
  const denylist = sourceAgent.agentDenylist;

  let visibleAgents = uiVisibleAgents;

  if (allowlist && allowlist.length > 0) {
    visibleAgents = visibleAgents.filter((agent) =>
      allowlist.some((pattern) => matchesGlobPattern(agent.agentId, pattern)),
    );
  }

  if (denylist && denylist.length > 0) {
    visibleAgents = visibleAgents.filter(
      (agent) => !denylist.some((pattern) => matchesGlobPattern(agent.agentId, pattern)),
    );
  }

  return visibleAgents;
}

export interface BuildSystemPromptOptions {
  agentRegistry: AgentRegistry;
  agentId: string | undefined;
  tools?: Tool[];
  skills?: SkillSummary[];
  sessionId?: string;
}

function collectToolNames(
  tools: Tool[] | undefined,
  skills: SkillSummary[] | undefined,
): Set<string> {
  const names = new Set<string>();
  if (tools) {
    for (const tool of tools) {
      names.add(tool.name);
    }
  }
  if (skills) {
    for (const skill of skills) {
      for (const toolName of skill.toolNames) {
        names.add(toolName);
      }
    }
  }
  return names;
}

export function buildSystemPrompt(options: BuildSystemPromptOptions): string;
export function buildSystemPrompt(
  agentRegistry: AgentRegistry,
  agentId: string | undefined,
  tools?: Tool[],
): string;
export function buildSystemPrompt(
  optionsOrRegistry: BuildSystemPromptOptions | AgentRegistry,
  agentIdArg?: string | undefined,
  toolsArg?: Tool[],
): string {
  // Handle both call signatures
  let agentRegistry: AgentRegistry;
  let agentId: string | undefined;
  let tools: Tool[] | undefined;
  let skills: SkillSummary[] | undefined;

  if (optionsOrRegistry instanceof AgentRegistry) {
    agentRegistry = optionsOrRegistry;
    agentId = agentIdArg;
    tools = toolsArg;
  } else {
    agentRegistry = optionsOrRegistry.agentRegistry;
    agentId = optionsOrRegistry.agentId;
    tools = optionsOrRegistry.tools;
    skills = optionsOrRegistry.skills;
  }

  let basePrompt = DEFAULT_SYSTEM_PROMPT;
  let agent: AgentDefinition | undefined;

  if (agentId) {
    agent = agentRegistry.getAgent(agentId);
    const systemPrompt = agent?.systemPrompt;
    if (typeof systemPrompt === 'string' && systemPrompt.trim().length > 0) {
      basePrompt = systemPrompt;
    } else if (agent) {
      // Generate a default prompt from agent info
      basePrompt = `You are ${agent.displayName}. ${agent.description}`;
    }
  }

  const sections: string[] = [basePrompt.trimEnd()];

  const toolNames = collectToolNames(tools, skills);
  const hasToolContext = (tools && tools.length > 0) || (skills && skills.length > 0);

  // Add tools section if tools are provided
  if (tools && tools.length > 0) {
    const nonSystemTools = tools.filter(
      (t) => !t.name.startsWith('system_') && !t.name.startsWith('agents_'),
    );
    if (nonSystemTools.length > 0) {
      const toolLines: string[] = ['', 'Available tools:'];
      for (const tool of nonSystemTools) {
        toolLines.push(`- ${tool.name}: ${tool.description}`);
      }
      sections.push(toolLines.join('\n'));
    }
  }

  if (skills && skills.length > 0) {
    const skillLines: string[] = ['', 'Available CLI skills:', ''];
    skillLines.push(
      'Use bash to read each SKILL.md file and invoke the CLI for that skill.',
      'Each skill lists its operations plus usage details.',
    );
    for (const skill of skills) {
      skillLines.push(
        `- ${skill.id}: ${skill.description} (SKILLS: ${skill.skillsPath}, CLI: ${skill.cliPath})`,
      );
    }
    sections.push(skillLines.join('\n'));
  }

  // Add message context section when tool context is available
  if (hasToolContext) {
    const messageContextLines: string[] = [
      '',
      '## Message Context',
      '',
      'Each user message begins with a context line in XML format:',
      '<context panel-id="<panel-id>" panel-type="<panel-type>" panel-title="<panel-title>" />',
      '',
      '- panel-id, panel-type, panel-title: The currently selected panel in the UI',
      '- Additional attributes may be provided by the active panel plugin (for example selected item metadata)',
      '- selection: Optional. Comma-separated item IDs the user has selected in the UI',
      '- selection-titles: Optional. JSON array of selected item titles aligned to the selection ids when available.',
      '- mode: Optional. When set to "brief", the user prefers concise responses. Be shorter but do not skip important steps, safety checks, or required detail.',
      '',
      'Always rely on this context line for the current panel and selection when it is present.',
      'If no context line is available (headless agents), call panels_list or panels_selected (includeContext true) to find the target panel and its context.',
      'If multiple windows are active, include windowId in panels_* calls.',
      'Use the panel-id for panel-specific tools when required.',
      'Use the appropriate tools (lists_* for lists, notes_* for notes) or CLI skills if tools are not exposed.',
    ];
    sections.push(messageContextLines.join('\n'));
  }

  // Add memory lookup guidance when list/note search tools are available
  const hasListsItemsSearch = toolNames.has('lists_items_search');
  const hasNotesSearch = toolNames.has('notes_search');
  const hasMemoryTools = hasListsItemsSearch || hasNotesSearch;

  if (hasMemoryTools) {
    const memoryLines: string[] = [
      '',
      '## Memory Lookup',
      '',
      'When a user references something you don\'t recognize or asks about "my ..." (repo, project,',
      'workflow, format, etc.), search stored memory before asking clarifying questions.',
      '',
      'Memory is stored as:',
      '- List items (preferred for short facts) in lists tagged "memory"',
      '- Notes (for longer context) tagged "memory"',
      '',
      'Trigger phrases: "what\'s my ...", "my usual ...", "clone my project", "my github", etc.',
      '',
      'Lookup sequence:',
    ];

    if (hasListsItemsSearch) {
      memoryLines.push(
        '1. lists_items_search with listId: "memory" and query keywords (searches the Memory list)',
      );
      memoryLines.push(
        '2. lists_items_search with tags: ["memory"] and query keywords (searches items tagged memory in any list)',
      );
      if (hasNotesSearch) {
        memoryLines.push('3. notes_search with tags: ["memory"] and relevant query');
        memoryLines.push('4. Only ask the user if no memory found');
      } else {
        memoryLines.push('3. Only ask the user if no memory found');
      }
    } else if (hasNotesSearch) {
      memoryLines.push('1. notes_search with tags: ["memory"] and relevant query');
      memoryLines.push('2. Only ask the user if no memory found');
    }

    sections.push(memoryLines.join('\n'));
  }

  // Add available agents section
  const allAgents = agentRegistry.listAgents();
  const visibleAgents = filterVisibleAgents(allAgents, agentId, agentRegistry);
  const availableAgents = visibleAgents.filter((a) => a.agentId !== agentId);

  if (availableAgents.length > 0) {
    const agentLines: string[] = ['', 'Available agents you can delegate to:'];
    for (const a of availableAgents) {
      agentLines.push(`- ${a.agentId}: ${a.displayName} - ${a.description}`);
    }
    agentLines.push(
      '',
      'Use agents_list to see available agents (also listed above).',
      'Use agents_message to send a message to another agent:',
      '  - session: "create" for fresh tasks, "latest" to continue prior work, "latest-or-create" (default) for general use',
      '  - mode: "sync" (default) to wait for response, "async" for fire-and-forget (no response returned)',
    );
    sections.push(agentLines.join('\n'));
  }

  return sections.join('\n');
}
