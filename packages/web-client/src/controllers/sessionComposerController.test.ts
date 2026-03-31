// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionComposerController } from './sessionComposerController';

describe('SessionComposerController', () => {
  const originalFetch = globalThis.fetch;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    vi.restoreAllMocks();
  });

  function buildController() {
    const createSessionForAgent = vi.fn(async () => 'session-1');
    const updateSession = vi.fn(async () => true);
    const createScheduledSession = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const controller = new SessionComposerController({
      getAgentSummaries: () => [
        {
          agentId: 'assistant',
          displayName: 'Assistant',
          sessionWorkingDir: { mode: 'fixed', path: '/home/kevin/assistant' },
          sessionConfigCapabilities: {
            availableModels: ['gpt-5.4', 'gpt-5.4-mini'],
            availableThinking: ['low', 'medium'],
            availableSkills: [
              { id: 'worktrees', name: 'Worktrees', description: 'Use git worktrees.' },
              { id: 'agent-runner-review', name: 'Review', description: 'External review.' },
            ],
          },
        },
        {
          agentId: 'coding',
          displayName: 'Coding',
          sessionWorkingDir: { mode: 'prompt', roots: ['/home/kevin/worktrees'] },
          sessionConfigCapabilities: {
            availableModels: ['gpt-5.4'],
            availableThinking: ['medium', 'high'],
            availableSkills: [{ id: 'worktrees', name: 'Worktrees', description: 'Use git worktrees.' }],
          },
        },
      ],
      createSessionForAgent,
      updateSession,
      createScheduledSession,
      setStatus,
    });

    return {
      controller,
      createSessionForAgent,
      updateSession,
      createScheduledSession,
      setStatus,
    };
  }

  function queryRole<T extends Element = HTMLElement>(role: string): T {
    const element = document.querySelector<T>(`[data-role="${role}"]`);
    if (!element) {
      throw new Error(`Missing element for role ${role}`);
    }
    return element;
  }

  it('creates a one-off session with sessionConfig values', async () => {
    const { controller, createSessionForAgent, createScheduledSession } = buildController();
    const onSessionCreated = vi.fn();

    controller.open({ initialAgentId: 'assistant', onSessionCreated });

    queryRole<HTMLButtonElement>('customize').click();
    const initialSkillInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '.session-composer-skill-option input[type="checkbox"]',
      ),
    );
    expect(initialSkillInputs.every((input) => input.checked)).toBe(true);

    const title = queryRole<HTMLInputElement>('title');
    title.value = 'Daily Assistant';
    title.dispatchEvent(new Event('input', { bubbles: true }));

    const model = queryRole<HTMLSelectElement>('model');
    model.value = 'gpt-5.4';
    model.dispatchEvent(new Event('change', { bubbles: true }));

    const thinking = queryRole<HTMLSelectElement>('thinking');
    thinking.value = 'medium';
    thinking.dispatchEvent(new Event('change', { bubbles: true }));

    queryRole<HTMLButtonElement>('confirm').click();
    await Promise.resolve();

    expect(createSessionForAgent).toHaveBeenCalledWith('assistant', {
      sessionConfig: {
        model: 'gpt-5.4',
        thinking: 'medium',
        workingDir: '/home/kevin/assistant',
        sessionTitle: 'Daily Assistant',
      },
    });
    expect(createScheduledSession).not.toHaveBeenCalled();
    expect(onSessionCreated).toHaveBeenCalledWith('session-1');
    expect(controller.isOpen()).toBe(false);
    expect(document.querySelector('[data-role="overlay"]')).toBeNull();
  });

  it('creates a schedule with top-level sessionTitle and sessionConfig overrides', async () => {
    const { controller, createScheduledSession, createSessionForAgent } = buildController();

    controller.open({ initialAgentId: 'assistant', initialMode: 'schedule' });

    const title = queryRole<HTMLInputElement>('title');
    title.value = 'Morning Review';
    title.dispatchEvent(new Event('input', { bubbles: true }));

    const cron = queryRole<HTMLInputElement>('cron');
    cron.value = '0 9 * * 1-5';
    cron.dispatchEvent(new Event('input', { bubbles: true }));

    const prompt = queryRole<HTMLTextAreaElement>('prompt');
    prompt.value = 'Summarize the day.';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));

    queryRole<HTMLButtonElement>('customize').click();

    const model = queryRole<HTMLSelectElement>('model');
    model.value = 'gpt-5.4-mini';
    model.dispatchEvent(new Event('change', { bubbles: true }));

    const preCheck = queryRole<HTMLInputElement>('precheck');
    preCheck.value = 'test -d /home/kevin/assistant';
    preCheck.dispatchEvent(new Event('input', { bubbles: true }));

    const reuse = queryRole<HTMLInputElement>('reuse');
    reuse.checked = false;
    reuse.dispatchEvent(new Event('change', { bubbles: true }));

    const enabled = queryRole<HTMLInputElement>('enabled');
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));

    const maxConcurrent = queryRole<HTMLInputElement>('max-concurrent');
    maxConcurrent.value = '3';
    maxConcurrent.dispatchEvent(new Event('input', { bubbles: true }));

    queryRole<HTMLButtonElement>('confirm').click();
    await Promise.resolve();

    expect(createScheduledSession).toHaveBeenCalledWith({
      agentId: 'assistant',
      cron: '0 9 * * 1-5',
      prompt: 'Summarize the day.',
      preCheck: 'test -d /home/kevin/assistant',
      sessionTitle: 'Morning Review',
      sessionConfig: {
        model: 'gpt-5.4-mini',
        workingDir: '/home/kevin/assistant',
      },
      enabled: false,
      reuseSession: false,
      maxConcurrent: 3,
    });
    expect(createSessionForAgent).not.toHaveBeenCalled();
  });

  it('lets prompt-working-dir agents choose a directory before creating', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        roots: [
          {
            root: '/home/kevin/worktrees',
            directories: ['/home/kevin/worktrees/project-a'],
          },
        ],
      }),
    }) as unknown as typeof fetch;

    const { controller, createSessionForAgent } = buildController();

    controller.open({ initialAgentId: 'coding' });

    queryRole<HTMLButtonElement>('customize').click();
    queryRole<HTMLButtonElement>('working-dir-choose').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const dirLabel = Array.from(
      document.querySelectorAll<HTMLElement>('.working-dir-picker-overlay .session-picker-item-label'),
    ).find((element) => element.textContent?.trim() === 'project-a');
    expect(dirLabel).toBeTruthy();
    dirLabel?.closest('.session-picker-item')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const workingDirValue = document.querySelector<HTMLElement>('.session-composer-working-dir-value');
    expect(workingDirValue?.textContent).toContain('/home/kevin/worktrees/project-a');

    queryRole<HTMLButtonElement>('confirm').click();
    await Promise.resolve();

    expect(createSessionForAgent).toHaveBeenCalledWith('coding', {
      sessionConfig: {
        workingDir: '/home/kevin/worktrees/project-a',
      },
    });
  });

  it('preserves an explicit empty skill selection', async () => {
    const { controller, createSessionForAgent } = buildController();

    controller.open({ initialAgentId: 'assistant' });
    queryRole<HTMLButtonElement>('customize').click();
    queryRole<HTMLButtonElement>('skills-select-none').click();

    queryRole<HTMLButtonElement>('confirm').click();
    await Promise.resolve();

    expect(createSessionForAgent).toHaveBeenCalledWith('assistant', {
      sessionConfig: {
        workingDir: '/home/kevin/assistant',
        skills: [],
      },
    });
  });

  it('restores implicit all-skills default when select all is used', async () => {
    const { controller, createSessionForAgent } = buildController();

    controller.open({
      initialAgentId: 'assistant',
      createSessionOptions: {
        sessionConfig: {
          skills: ['worktrees'],
        },
      },
    });
    queryRole<HTMLButtonElement>('customize').click();

    queryRole<HTMLButtonElement>('skills-select-all').click();

    queryRole<HTMLButtonElement>('confirm').click();
    await Promise.resolve();

    expect(createSessionForAgent).toHaveBeenCalledWith('assistant', {
      sessionConfig: {
        workingDir: '/home/kevin/assistant',
      },
    });
  });

  it('keeps skill descriptions collapsed until expanded', () => {
    const { controller } = buildController();

    controller.open({ initialAgentId: 'assistant' });
    queryRole<HTMLButtonElement>('customize').click();

    const description = document.querySelector<HTMLElement>('.session-composer-skill-description');
    expect(description?.hidden).toBe(true);

    queryRole<HTMLButtonElement>('skill-details-worktrees').click();

    const expandedDescription = document.querySelector<HTMLElement>('.session-composer-skill-description');
    expect(expandedDescription?.hidden).toBe(false);
    expect(expandedDescription?.textContent).toContain('Use git worktrees.');
  });

  it('toggles skill selection from the row while keeping details separate', () => {
    const { controller } = buildController();

    controller.open({ initialAgentId: 'assistant' });
    queryRole<HTMLButtonElement>('customize').click();

    const firstOption = document.querySelector<HTMLElement>('.session-composer-skill-option');
    const firstInput = firstOption?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const name = firstOption?.querySelector<HTMLElement>('.session-composer-skill-name');
    const detailsButton = queryRole<HTMLButtonElement>('skill-details-worktrees');

    expect(firstInput?.checked).toBe(true);

    name?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const toggledInput = document.querySelector<HTMLInputElement>(
      '.session-composer-skill-option input[type="checkbox"]',
    );
    expect(toggledInput?.checked).toBe(false);

    detailsButton.click();
    const afterDetailsInput = document.querySelector<HTMLInputElement>(
      '.session-composer-skill-option input[type="checkbox"]',
    );
    expect(afterDetailsInput?.checked).toBe(false);

    afterDetailsInput?.click();
    const afterCheckboxInput = document.querySelector<HTMLInputElement>(
      '.session-composer-skill-option input[type="checkbox"]',
    );
    expect(afterCheckboxInput?.checked).toBe(true);
  });

  it('closes immediately when cancel is pressed', () => {
    const { controller } = buildController();
    controller.open({ initialAgentId: 'assistant' });

    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Cancel',
    );
    cancel?.click();

    expect(controller.isOpen()).toBe(false);
    expect(document.querySelector('[data-role="overlay"]')).toBeNull();
  });

  it('updates an existing session from edit mode', async () => {
    const { controller, updateSession, createSessionForAgent, createScheduledSession } =
      buildController();

    controller.open({
      initialAgentId: 'assistant',
      editSession: {
        sessionId: 'session-42',
        title: 'Existing Session',
        sessionConfig: {
          model: 'gpt-5.4-mini',
          thinking: 'low',
          workingDir: '/home/kevin/assistant',
          skills: ['agent-runner-review'],
        },
      },
    });

    const agent = queryRole<HTMLSelectElement>('agent');
    expect(agent.disabled).toBe(true);
    expect(queryRole<HTMLInputElement>('mode-schedule').closest('label')?.hasAttribute('hidden')).toBe(
      true,
    );

    queryRole<HTMLButtonElement>('customize').click();

    const title = queryRole<HTMLInputElement>('title');
    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));

    const model = queryRole<HTMLSelectElement>('model');
    model.value = '';
    model.dispatchEvent(new Event('change', { bubbles: true }));

    const thinking = queryRole<HTMLSelectElement>('thinking');
    thinking.value = 'medium';
    thinking.dispatchEvent(new Event('change', { bubbles: true }));

    const skillInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        '.session-composer-skill-option input[type="checkbox"]',
      ),
    );
    skillInputs[0]?.click();
    skillInputs[1]?.click();

    queryRole<HTMLButtonElement>('confirm').click();
    await Promise.resolve();

    expect(updateSession).toHaveBeenCalledWith('session-42', {
      sessionConfig: {
        thinking: 'medium',
        workingDir: '/home/kevin/assistant',
        skills: ['worktrees'],
      },
    });
    expect(createSessionForAgent).not.toHaveBeenCalled();
    expect(createScheduledSession).not.toHaveBeenCalled();
    expect(controller.isOpen()).toBe(false);
  });
});
