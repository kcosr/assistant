import type { SessionConfig } from '@assistant/shared';

import type { CreateSessionOptions, UpdateSessionOptions } from './sessionManager';
import { apiFetch } from '../utils/api';

export type SessionComposerMode = 'session' | 'schedule';

export interface SessionComposerAgentSummary {
  agentId: string;
  displayName: string;
  description?: string;
  type?: 'chat' | 'external';
  sessionWorkingDir?:
    | { mode: 'none' }
    | { mode: 'fixed'; path: string }
    | { mode: 'prompt'; roots: string[] };
  sessionConfigCapabilities?: {
    availableModels?: string[];
    availableThinking?: string[];
    availableSkills?: Array<{
      id: string;
      name: string;
      description: string;
    }>;
  };
}

export interface CreateScheduledSessionInput {
  agentId: string;
  cron: string;
  prompt?: string;
  preCheck?: string;
  sessionTitle?: string;
  sessionConfig?: SessionConfig;
  enabled?: boolean;
  reuseSession?: boolean;
  maxConcurrent?: number;
}

export interface SessionComposerOpenOptions {
  initialAgentId?: string;
  initialMode?: SessionComposerMode;
  createSessionOptions?: CreateSessionOptions;
  editSession?: {
    sessionId: string;
    title?: string | null;
    sessionConfig?: SessionConfig;
  };
  onSessionCreated?: (sessionId: string) => void;
  onSessionUpdated?: (sessionId: string) => void;
  onScheduleCreated?: () => void;
}

export interface SessionComposerControllerOptions {
  getAgentSummaries: () => SessionComposerAgentSummary[];
  createSessionForAgent: (
    agentId: string,
    options?: CreateSessionOptions,
  ) => Promise<string | null>;
  updateSession: (sessionId: string, options: UpdateSessionOptions) => Promise<boolean>;
  createScheduledSession: (input: CreateScheduledSessionInput) => Promise<void>;
  setStatus?: (text: string) => void;
}

type WorkingDirEntry = {
  root: string;
  directories: string[];
};

export class SessionComposerController {
  private overlay: HTMLDivElement | null = null;
  private cleanup: (() => void) | null = null;
  private workingDirOverlay: HTMLDivElement | null = null;
  private workingDirCleanup: (() => void) | null = null;
  private workingDirAbort: AbortController | null = null;
  private workingDirItems: Array<{ element: HTMLElement; onSelect: () => void }> = [];
  private workingDirFocusedIndex = -1;

  constructor(private readonly options: SessionComposerControllerOptions) {}

  open(openOptions: SessionComposerOpenOptions = {}): void {
    this.close();

    const agents = this.options.getAgentSummaries();
    const sortedAgents = [...agents].sort((a, b) => a.displayName.localeCompare(b.displayName));
    const initialAgentId =
      (typeof openOptions.initialAgentId === 'string'
        ? openOptions.initialAgentId.trim()
        : '') || sortedAgents[0]?.agentId || '';
    const editSession = openOptions.editSession;
    let mode: SessionComposerMode = editSession ? 'session' : (openOptions.initialMode ?? 'session');
    const initialConfig = editSession?.sessionConfig ?? openOptions.createSessionOptions?.sessionConfig;
    let selectedAgentId = initialAgentId;
    let explicitTitle =
      typeof editSession?.title === 'string'
        ? editSession.title
        : typeof initialConfig?.sessionTitle === 'string'
          ? initialConfig.sessionTitle
          : '';
    let cron = '';
    let prompt = '';
    let preCheck = '';
    let reuseSession = true;
    let enabled = true;
    let maxConcurrent = 1;
    let customizeExpanded = Boolean(
      initialConfig?.model ||
        initialConfig?.thinking ||
        Array.isArray(initialConfig?.skills) ||
        initialConfig?.workingDir,
    );
    let selectedModel = typeof initialConfig?.model === 'string' ? initialConfig.model : '';
    let selectedThinking = typeof initialConfig?.thinking === 'string' ? initialConfig.thinking : '';
    let selectedSkills: string[] | undefined = Array.isArray(initialConfig?.skills)
      ? [...initialConfig.skills]
      : undefined;
    let skillsTouched = false;
    let selectedWorkingDir =
      typeof initialConfig?.workingDir === 'string' ? initialConfig.workingDir : '';

    const overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay session-composer-overlay';
    overlay.dataset['role'] = 'overlay';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog session-composer-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleEl = document.createElement('h3');
    titleEl.className = 'confirm-dialog-title';
    titleEl.textContent = editSession ? 'Edit Session' : 'Create Session';
    dialog.appendChild(titleEl);

    const form = document.createElement('div');
    form.className = 'list-item-form session-composer-form';
    dialog.appendChild(form);

    const errorEl = document.createElement('p');
    errorEl.className = 'list-metadata-error';
    errorEl.style.display = 'none';
    dialog.appendChild(errorEl);

    const buttons = document.createElement('div');
    buttons.className = 'confirm-dialog-buttons';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'confirm-dialog-button cancel';
    cancelButton.textContent = 'Cancel';
    buttons.appendChild(cancelButton);

    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'confirm-dialog-button primary';
    confirmButton.textContent = editSession ? 'Save Session' : 'Create Session';
    buttons.appendChild(confirmButton);

    dialog.appendChild(buttons);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const setError = (message: string | null): void => {
      if (message) {
        errorEl.textContent = message;
        errorEl.style.display = 'block';
      } else {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    };

    const getSelectedAgent = (): SessionComposerAgentSummary | null =>
      sortedAgents.find((agent) => agent.agentId === selectedAgentId) ?? null;

    const getOrderedSelectedSkillIds = (
      availableSkills: Array<{ id: string }>,
      skillIds: string[] | undefined,
    ): string[] =>
      skillIds !== undefined
        ? availableSkills.map((skill) => skill.id).filter((skillId) => skillIds.includes(skillId))
        : availableSkills.map((skill) => skill.id);

    const normalizeSelectedSkills = (
      availableSkills: Array<{ id: string }>,
      skillIds: string[] | undefined,
    ): string[] | undefined => {
      const ordered = getOrderedSelectedSkillIds(availableSkills, skillIds);
      return ordered.length === availableSkills.length ? undefined : ordered;
    };

    const deriveEffectiveWorkingDir = (): string | undefined => {
      const agent = getSelectedAgent();
      if (!agent?.sessionWorkingDir) {
        return undefined;
      }
      if (agent.sessionWorkingDir.mode === 'fixed') {
        return agent.sessionWorkingDir.path;
      }
      if (agent.sessionWorkingDir.mode === 'prompt') {
        const trimmed = selectedWorkingDir.trim();
        return trimmed || undefined;
      }
      return undefined;
    };

    const normalizeForAgent = (): void => {
      const agent = getSelectedAgent();
      if (!agent) {
        selectedModel = '';
        selectedThinking = '';
        selectedSkills = undefined;
        selectedWorkingDir = '';
        return;
      }

      const models = new Set(agent.sessionConfigCapabilities?.availableModels ?? []);
      if (selectedModel && !models.has(selectedModel)) {
        selectedModel = '';
      }

      const thinking = new Set(agent.sessionConfigCapabilities?.availableThinking ?? []);
      if (selectedThinking && !thinking.has(selectedThinking)) {
        selectedThinking = '';
      }

      if (selectedSkills !== undefined) {
        selectedSkills = normalizeSelectedSkills(
          agent.sessionConfigCapabilities?.availableSkills ?? [],
          selectedSkills,
        );
      }

      const workingDirConfig = agent.sessionWorkingDir;
      if (!workingDirConfig || workingDirConfig.mode === 'none') {
        selectedWorkingDir = '';
      } else if (workingDirConfig.mode === 'fixed') {
        selectedWorkingDir = workingDirConfig.path;
      } else if (!selectedWorkingDir) {
        selectedWorkingDir = '';
      }
    };

    const agentLabel = document.createElement('label');
    agentLabel.className = 'list-item-form-label';
    const agentLabelText = document.createElement('span');
    agentLabelText.className = 'list-item-form-label-text';
    agentLabelText.textContent = 'Agent';
    agentLabel.appendChild(agentLabelText);
    const agentSelect = document.createElement('select');
    agentSelect.className = 'list-item-form-input';
    agentSelect.dataset['role'] = 'agent';
    for (const agent of sortedAgents) {
      const option = document.createElement('option');
      option.value = agent.agentId;
      option.textContent = agent.displayName;
      agentSelect.appendChild(option);
    }
    agentSelect.value = selectedAgentId;
    agentSelect.disabled = Boolean(editSession);
    agentLabel.appendChild(agentSelect);
    form.appendChild(agentLabel);

    const modeSection = document.createElement('label');
    modeSection.className = 'session-composer-checkbox session-composer-mode-toggle';
    const scheduleToggle = document.createElement('input');
    scheduleToggle.type = 'checkbox';
    scheduleToggle.checked = mode === 'schedule';
    scheduleToggle.dataset['role'] = 'mode-schedule';
    const modeLabel = document.createElement('span');
    modeLabel.textContent = 'Schedule this session';
    modeSection.append(scheduleToggle, modeLabel);
    if (editSession) {
      modeSection.hidden = true;
    }
    form.appendChild(modeSection);

    const titleLabel = document.createElement('label');
    titleLabel.className = 'list-item-form-label';
    const titleLabelText = document.createElement('span');
    titleLabelText.className = 'list-item-form-label-text';
    titleLabelText.textContent = 'Title';
    titleLabel.appendChild(titleLabelText);
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'list-item-form-input';
    titleInput.placeholder = 'Optional';
    titleInput.value = explicitTitle;
    titleInput.dataset['role'] = 'title';
    titleLabel.appendChild(titleInput);
    form.appendChild(titleLabel);

    const scheduleFields = document.createElement('div');
    scheduleFields.className = 'session-composer-schedule-fields';
    const cronLabel = document.createElement('label');
    cronLabel.className = 'list-item-form-label';
    const cronLabelText = document.createElement('span');
    cronLabelText.className = 'list-item-form-label-text';
    cronLabelText.textContent = 'Cron';
    cronLabel.appendChild(cronLabelText);
    const cronInput = document.createElement('input');
    cronInput.type = 'text';
    cronInput.className = 'list-item-form-input';
    cronInput.placeholder = '*/5 * * * *';
    cronInput.value = cron;
    cronInput.dataset['role'] = 'cron';
    cronLabel.appendChild(cronInput);
    scheduleFields.appendChild(cronLabel);

    const promptLabel = document.createElement('label');
    promptLabel.className = 'list-item-form-label';
    const promptLabelText = document.createElement('span');
    promptLabelText.className = 'list-item-form-label-text';
    promptLabelText.textContent = 'Prompt';
    promptLabel.appendChild(promptLabelText);
    const promptInput = document.createElement('textarea');
    promptInput.className = 'list-item-form-textarea';
    promptInput.placeholder = 'What should the scheduled run do?';
    promptInput.value = prompt;
    promptInput.dataset['role'] = 'prompt';
    promptLabel.appendChild(promptInput);
    scheduleFields.appendChild(promptLabel);

    form.appendChild(scheduleFields);

    const customizeButton = document.createElement('button');
    customizeButton.type = 'button';
    customizeButton.className = 'session-composer-customize-toggle';
    customizeButton.dataset['role'] = 'customize';
    form.appendChild(customizeButton);

    const customizeSection = document.createElement('div');
    customizeSection.className = 'session-composer-customize';
    form.appendChild(customizeSection);

    const workingDirSection = document.createElement('div');
    workingDirSection.className = 'session-composer-working-dir';
    customizeSection.appendChild(workingDirSection);

    const modelLabel = document.createElement('label');
    modelLabel.className = 'list-item-form-label';
    const modelLabelText = document.createElement('span');
    modelLabelText.className = 'list-item-form-label-text';
    modelLabelText.textContent = 'Model';
    modelLabel.appendChild(modelLabelText);
    const modelSelect = document.createElement('select');
    modelSelect.className = 'list-item-form-input';
    modelSelect.dataset['role'] = 'model';
    modelLabel.appendChild(modelSelect);
    customizeSection.appendChild(modelLabel);

    const thinkingLabel = document.createElement('label');
    thinkingLabel.className = 'list-item-form-label';
    const thinkingLabelText = document.createElement('span');
    thinkingLabelText.className = 'list-item-form-label-text';
    thinkingLabelText.textContent = 'Thinking';
    thinkingLabel.appendChild(thinkingLabelText);
    const thinkingSelect = document.createElement('select');
    thinkingSelect.className = 'list-item-form-input';
    thinkingSelect.dataset['role'] = 'thinking';
    thinkingLabel.appendChild(thinkingSelect);
    customizeSection.appendChild(thinkingLabel);

    const skillsSection = document.createElement('div');
    skillsSection.className = 'session-composer-skills';
    customizeSection.appendChild(skillsSection);

    const preCheckLabel = document.createElement('label');
    preCheckLabel.className = 'list-item-form-label';
    const preCheckText = document.createElement('span');
    preCheckText.className = 'list-item-form-label-text';
    preCheckText.textContent = 'Pre-check';
    preCheckLabel.appendChild(preCheckText);
    const preCheckInput = document.createElement('input');
    preCheckInput.type = 'text';
    preCheckInput.className = 'list-item-form-input';
    preCheckInput.placeholder = 'Optional shell command';
    preCheckInput.value = preCheck;
    preCheckInput.dataset['role'] = 'precheck';
    preCheckLabel.appendChild(preCheckInput);
    scheduleFields.appendChild(preCheckLabel);

    const reuseLabel = document.createElement('label');
    reuseLabel.className = 'session-composer-checkbox';
    const reuseInput = document.createElement('input');
    reuseInput.type = 'checkbox';
    reuseInput.checked = reuseSession;
    reuseInput.dataset['role'] = 'reuse';
    reuseLabel.appendChild(reuseInput);
    const reuseText = document.createElement('span');
    reuseText.textContent = 'Reuse one backing session';
    reuseLabel.appendChild(reuseText);
    scheduleFields.appendChild(reuseLabel);

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'session-composer-checkbox';
    const enabledInput = document.createElement('input');
    enabledInput.type = 'checkbox';
    enabledInput.checked = enabled;
    enabledInput.dataset['role'] = 'enabled';
    enabledLabel.appendChild(enabledInput);
    const enabledText = document.createElement('span');
    enabledText.textContent = 'Enabled';
    enabledLabel.appendChild(enabledText);
    scheduleFields.appendChild(enabledLabel);

    const concurrentLabel = document.createElement('label');
    concurrentLabel.className = 'list-item-form-label';
    const concurrentText = document.createElement('span');
    concurrentText.className = 'list-item-form-label-text';
    concurrentText.textContent = 'Max concurrent runs';
    concurrentLabel.appendChild(concurrentText);
    const concurrentInput = document.createElement('input');
    concurrentInput.type = 'number';
    concurrentInput.min = '1';
    concurrentInput.step = '1';
    concurrentInput.className = 'list-item-form-input';
    concurrentInput.value = String(maxConcurrent);
    concurrentInput.dataset['role'] = 'max-concurrent';
    concurrentLabel.appendChild(concurrentInput);
    scheduleFields.appendChild(concurrentLabel);

    const renderSkills = (): void => {
      const agent = getSelectedAgent();
      const availableSkills = agent?.sessionConfigCapabilities?.availableSkills ?? [];
      skillsSection.innerHTML = '';
      if (availableSkills.length === 0) {
        skillsSection.hidden = true;
        return;
      }
      skillsSection.hidden = false;

      const heading = document.createElement('div');
      heading.className = 'list-item-form-label-text';
      heading.textContent = 'Skills';

      const header = document.createElement('div');
      header.className = 'session-composer-skills-header';
      header.appendChild(heading);

      const actions = document.createElement('div');
      actions.className = 'session-composer-skill-actions';

      const selectAllButton = document.createElement('button');
      selectAllButton.type = 'button';
      selectAllButton.className = 'session-composer-skill-action';
      selectAllButton.dataset['role'] = 'skills-select-all';
      selectAllButton.textContent = 'Select all';
      selectAllButton.addEventListener('click', () => {
        skillsTouched = true;
        selectedSkills = undefined;
        renderSkills();
      });
      actions.appendChild(selectAllButton);

      const selectNoneButton = document.createElement('button');
      selectNoneButton.type = 'button';
      selectNoneButton.className = 'session-composer-skill-action';
      selectNoneButton.dataset['role'] = 'skills-select-none';
      selectNoneButton.textContent = 'Select none';
      selectNoneButton.addEventListener('click', () => {
        skillsTouched = true;
        selectedSkills = [];
        renderSkills();
      });
      actions.appendChild(selectNoneButton);

      header.appendChild(actions);
      skillsSection.appendChild(header);

      const list = document.createElement('div');
      list.className = 'session-composer-skill-list';
      const selectedSkillSet = new Set(getOrderedSelectedSkillIds(availableSkills, selectedSkills));
      for (const skill of availableSkills) {
        const label = document.createElement('label');
        label.className = 'session-composer-skill-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = selectedSkillSet.has(skill.id);
        input.addEventListener('change', () => {
          skillsTouched = true;
          const nextSelected = new Set(
            selectedSkills ?? availableSkills.map((availableSkill) => availableSkill.id),
          );
          if (input.checked) {
            nextSelected.add(skill.id);
          } else {
            nextSelected.delete(skill.id);
          }
          selectedSkills = normalizeSelectedSkills(
            availableSkills,
            availableSkills
              .map((availableSkill) => availableSkill.id)
              .filter((skillId) => nextSelected.has(skillId)),
          );
        });
        const text = document.createElement('span');
        text.innerHTML = `<strong>${escapeHtml(skill.name)}</strong>${skill.description ? `<small>${escapeHtml(skill.description)}</small>` : ''}`;
        label.append(input, text);
        list.appendChild(label);
      }
      skillsSection.appendChild(list);
    };

    const renderSelect = (
      select: HTMLSelectElement,
      values: string[] | undefined,
      current: string,
      defaultLabel: string,
    ): string => {
      const nextValues = values ?? [];
      select.innerHTML = '';
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = defaultLabel;
      select.appendChild(defaultOption);
      for (const value of nextValues) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      }
      const normalizedCurrent = nextValues.includes(current) ? current : '';
      select.value = normalizedCurrent;
      return normalizedCurrent;
    };

    const renderWorkingDirSection = (): void => {
      const agent = getSelectedAgent();
      workingDirSection.innerHTML = '';
      const config = agent?.sessionWorkingDir;
      if (!config || config.mode === 'none') {
        workingDirSection.hidden = true;
        return;
      }
      workingDirSection.hidden = false;

      const label = document.createElement('div');
      label.className = 'list-item-form-label';
      const text = document.createElement('span');
      text.className = 'list-item-form-label-text';
      text.textContent = 'Working directory';
      label.appendChild(text);

      const row = document.createElement('div');
      row.className = 'session-composer-working-dir-row';

      const value = document.createElement('div');
      value.className = 'session-composer-working-dir-value';
      const effective =
        config.mode === 'fixed' ? config.path : selectedWorkingDir.trim() || 'No directory selected';
      value.textContent = effective;
      row.appendChild(value);

      if (config.mode === 'fixed') {
        const badge = document.createElement('span');
        badge.className = 'session-composer-working-dir-badge';
        badge.textContent = 'Fixed';
        row.appendChild(badge);
      } else {
        const chooseButton = document.createElement('button');
        chooseButton.type = 'button';
        chooseButton.className = 'session-composer-action-button';
        chooseButton.textContent = selectedWorkingDir.trim() ? 'Change' : 'Choose';
        chooseButton.dataset['role'] = 'working-dir-choose';
        chooseButton.addEventListener('click', async () => {
          const entries = await this.fetchWorkingDirEntries(agent?.agentId ?? '');
          if (entries.length === 0) {
            this.options.setStatus?.('No working directories available');
            return;
          }
          const choice = await this.promptForWorkingDir({
            agentLabel: agent?.displayName,
            entries,
          });
          if (choice) {
            selectedWorkingDir = choice;
            renderWorkingDirSection();
            setError(null);
          }
        });
        row.appendChild(chooseButton);

        if (selectedWorkingDir.trim()) {
          const clearButton = document.createElement('button');
          clearButton.type = 'button';
          clearButton.className = 'session-composer-action-button';
          clearButton.textContent = 'Clear';
          clearButton.dataset['role'] = 'working-dir-clear';
          clearButton.addEventListener('click', () => {
            selectedWorkingDir = '';
            renderWorkingDirSection();
          });
          row.appendChild(clearButton);
        }
      }

      label.appendChild(row);
      workingDirSection.appendChild(label);
    };

    const updateModeUi = (): void => {
      scheduleToggle.checked = mode === 'schedule';
      scheduleFields.hidden = mode !== 'schedule';
      preCheckLabel.hidden = mode !== 'schedule';
      reuseLabel.hidden = mode !== 'schedule';
      enabledLabel.hidden = mode !== 'schedule';
      concurrentLabel.hidden = mode !== 'schedule' || reuseInput.checked;
      if (editSession) {
        confirmButton.textContent = 'Save Session';
        titleEl.textContent = 'Edit Session';
      } else {
        confirmButton.textContent = mode === 'schedule' ? 'Create Schedule' : 'Create Session';
        titleEl.textContent = mode === 'schedule' ? 'Create Scheduled Session' : 'Create Session';
      }
    };

    const updateCustomizeUi = (): void => {
      customizeButton.textContent = customizeExpanded ? 'Hide advanced' : 'Advanced';
      customizeSection.hidden = !customizeExpanded;
    };

    const updateCapabilityUi = (): void => {
      normalizeForAgent();
      const agent = getSelectedAgent();
      const capabilities = agent?.sessionConfigCapabilities;

      selectedModel = renderSelect(
        modelSelect,
        capabilities?.availableModels,
        selectedModel,
        'Agent default',
      );
      modelLabel.hidden = (capabilities?.availableModels?.length ?? 0) === 0;

      selectedThinking = renderSelect(
        thinkingSelect,
        capabilities?.availableThinking,
        selectedThinking,
        'Agent default',
      );
      thinkingLabel.hidden = (capabilities?.availableThinking?.length ?? 0) === 0;

      renderSkills();
      renderWorkingDirSection();
    };

    const close = (): void => {
      this.close();
    };

    const validate = (): string | null => {
      if (!selectedAgentId) {
        return 'Agent is required';
      }
      const agent = getSelectedAgent();
      if (!agent) {
        return 'Selected agent is unavailable';
      }
      if (agent.sessionWorkingDir?.mode === 'prompt' && !selectedWorkingDir.trim()) {
        return 'Working directory is required for this agent';
      }
      if (mode === 'schedule') {
        if (!cronInput.value.trim()) {
          return 'Cron is required';
        }
        if (!promptInput.value.trim() && !preCheckInput.value.trim()) {
          return 'Schedule requires a prompt, pre-check, or both';
        }
        const concurrent = Number.parseInt(concurrentInput.value.trim() || '1', 10);
        if (!Number.isFinite(concurrent) || concurrent < 1) {
          return 'Max concurrent runs must be at least 1';
        }
      }
      return null;
    };

    const buildSessionConfig = (): SessionConfig | undefined => {
      const workingDir = deriveEffectiveWorkingDir();
      const title = titleInput.value.trim();
      const availableSkills = getSelectedAgent()?.sessionConfigCapabilities?.availableSkills ?? [];
      const config: SessionConfig = {
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(selectedThinking ? { thinking: selectedThinking } : {}),
        ...(workingDir ? { workingDir } : {}),
        ...(selectedSkills !== undefined && availableSkills.length > 0
          ? { skills: [...selectedSkills].sort((a, b) => a.localeCompare(b)) }
          : {}),
      };
      if (mode === 'session' && title) {
        config.sessionTitle = title;
      }
      return Object.keys(config).length > 0 ? config : undefined;
    };

    const submit = async (): Promise<void> => {
      const error = validate();
      if (error) {
        setError(error);
        return;
      }
      setError(null);

      const sessionConfig = buildSessionConfig();
      if (editSession) {
        const updated = await this.options.updateSession(editSession.sessionId, {
          sessionConfig: {
            ...(sessionConfig ?? {}),
            ...(titleInput.value.trim() ? { sessionTitle: titleInput.value.trim() } : {}),
          },
        });
        if (updated) {
          close();
          openOptions.onSessionUpdated?.(editSession.sessionId);
        }
        return;
      }
      if (mode === 'session') {
        const baseOptions = openOptions.createSessionOptions ?? {};
        const baseSessionConfig = { ...(baseOptions.sessionConfig ?? {}) };
        const mergedOptions: CreateSessionOptions = {
          ...baseOptions,
          ...(sessionConfig
            ? {
                sessionConfig: {
                  ...baseSessionConfig,
                  ...sessionConfig,
                },
              }
            : {}),
        };
        if (skillsTouched && selectedSkills === undefined) {
          const nextSessionConfig = { ...(mergedOptions.sessionConfig ?? baseSessionConfig) };
          delete nextSessionConfig.skills;
          if (Object.keys(nextSessionConfig).length > 0) {
            mergedOptions.sessionConfig = nextSessionConfig;
          } else {
            delete mergedOptions.sessionConfig;
          }
        }
        const sessionId = await this.options.createSessionForAgent(selectedAgentId, mergedOptions);
        if (sessionId) {
          close();
          openOptions.onSessionCreated?.(sessionId);
        }
        return;
      }

      const concurrent = Number.parseInt(concurrentInput.value.trim() || '1', 10);
      await this.options.createScheduledSession({
        agentId: selectedAgentId,
        cron: cronInput.value.trim(),
        ...(promptInput.value.trim() ? { prompt: promptInput.value.trim() } : {}),
        ...(preCheckInput.value.trim() ? { preCheck: preCheckInput.value.trim() } : {}),
        ...(titleInput.value.trim() ? { sessionTitle: titleInput.value.trim() } : {}),
        ...(sessionConfig ? { sessionConfig } : {}),
        enabled: enabledInput.checked,
        reuseSession: reuseInput.checked,
        maxConcurrent: concurrent,
      });
      close();
      openOptions.onScheduleCreated?.();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        void submit();
      }
    };

    const release = (): void => {
      this.closeWorkingDirPicker();
      document.removeEventListener('keydown', handleKeyDown);
    };

    document.addEventListener('keydown', handleKeyDown);
    this.cleanup = release;

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        close();
      }
    });
    cancelButton.addEventListener('click', close);
    confirmButton.addEventListener('click', () => {
      void submit();
    });
    confirmButton.dataset['role'] = 'confirm';
    scheduleToggle.addEventListener('change', () => {
      mode = scheduleToggle.checked ? 'schedule' : 'session';
      updateModeUi();
      setError(null);
    });
    customizeButton.addEventListener('click', () => {
      customizeExpanded = !customizeExpanded;
      updateCustomizeUi();
    });
    agentSelect.addEventListener('change', () => {
      selectedAgentId = agentSelect.value;
      updateCapabilityUi();
      setError(null);
    });
    modelSelect.addEventListener('change', () => {
      selectedModel = modelSelect.value.trim();
    });
    thinkingSelect.addEventListener('change', () => {
      selectedThinking = thinkingSelect.value.trim();
    });
    titleInput.addEventListener('input', () => setError(null));
    cronInput.addEventListener('input', () => setError(null));
    promptInput.addEventListener('input', () => setError(null));
    preCheckInput.addEventListener('input', () => setError(null));
    reuseInput.addEventListener('change', () => {
      reuseSession = reuseInput.checked;
      updateModeUi();
    });
    enabledInput.addEventListener('change', () => {
      enabled = enabledInput.checked;
    });
    concurrentInput.addEventListener('input', () => {
      maxConcurrent = Number.parseInt(concurrentInput.value.trim() || '1', 10);
    });

    updateCapabilityUi();
    updateModeUi();
    updateCustomizeUi();

    setTimeout(() => {
      agentSelect.focus();
    }, 0);
  }

  close(): void {
    const cleanup = this.cleanup;
    this.cleanup = null;
    cleanup?.();
    this.closeWorkingDirPicker();
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  isOpen(): boolean {
    return Boolean(this.overlay);
  }

  private closeWorkingDirPicker(): void {
    this.workingDirCleanup?.();
    this.workingDirCleanup = null;
    if (this.workingDirAbort) {
      this.workingDirAbort.abort();
      this.workingDirAbort = null;
    }
    if (this.workingDirOverlay) {
      this.workingDirOverlay.remove();
      this.workingDirOverlay = null;
    }
    this.workingDirItems = [];
    this.workingDirFocusedIndex = -1;
  }

  private async fetchWorkingDirEntries(agentId: string): Promise<WorkingDirEntry[]> {
    try {
      const controller = new AbortController();
      this.workingDirAbort = controller;
      const response = await apiFetch('/api/plugins/agents/operations/list-working-dirs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as unknown;
      const roots =
        data && typeof data === 'object'
          ? (data as { roots?: unknown }).roots ??
            (data as { result?: { roots?: unknown } }).result?.roots
          : undefined;
      if (!Array.isArray(roots)) {
        return [];
      }
      const parsed: WorkingDirEntry[] = [];
      for (const entry of roots) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const anyEntry = entry as { root?: unknown; directories?: unknown };
        const root = typeof anyEntry.root === 'string' ? anyEntry.root.trim() : '';
        if (!root) {
          continue;
        }
        const directories = Array.isArray(anyEntry.directories)
          ? anyEntry.directories
              .filter((dir) => typeof dir === 'string')
              .map((dir) => dir.trim())
              .filter((dir) => dir.length > 0)
          : [];
        parsed.push({ root, directories });
      }
      return parsed;
    } catch {
      return [];
    } finally {
      this.workingDirAbort = null;
    }
  }

  private async promptForWorkingDir(options: {
    entries: WorkingDirEntry[];
    agentLabel?: string;
  }): Promise<string | undefined> {
    const entries = options.entries.filter(
      (entry) => entry.root.trim().length > 0 && entry.directories.length >= 0,
    );
    if (entries.length === 0) {
      return undefined;
    }

    this.closeWorkingDirPicker();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        this.closeWorkingDirPicker();
        resolve(value);
      };

      const overlay = document.createElement('div');
      overlay.className = 'working-dir-picker-overlay';
      const popover = document.createElement('div');
      popover.className = 'session-picker-popover working-dir-picker-popover';

      const titleEl = document.createElement('div');
      titleEl.className = 'session-picker-title';
      titleEl.textContent = options.agentLabel
        ? `Working directory (${options.agentLabel})`
        : 'Working directory';
      popover.appendChild(titleEl);

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'session-picker-search';
      searchInput.placeholder = 'Search directories...';
      searchInput.autocomplete = 'off';
      searchInput.setAttribute('aria-label', titleEl.textContent ?? 'Working directory');
      popover.appendChild(searchInput);

      const list = document.createElement('div');
      list.className = 'session-picker-list';
      popover.appendChild(list);

      overlay.appendChild(popover);
      document.body.appendChild(overlay);
      this.workingDirOverlay = overlay;

      const renderList = (): void => {
        list.innerHTML = '';
        this.workingDirItems = [];
        this.workingDirFocusedIndex = -1;
        const filter = searchInput.value.trim().toLowerCase();

        const addSection = (label: string): void => {
          const section = document.createElement('div');
          section.className = 'session-picker-section';
          section.textContent = label;
          list.appendChild(section);
        };

        const addEmpty = (label: string): void => {
          const empty = document.createElement('div');
          empty.className = 'session-picker-empty';
          empty.textContent = label;
          list.appendChild(empty);
        };

        const addItem = (label: string, onSelect: () => void, fullValue?: string): void => {
          const item = document.createElement('div');
          item.className = 'session-picker-item';
          item.setAttribute('role', 'button');
          item.tabIndex = 0;

          const labelSpan = document.createElement('span');
          labelSpan.className = 'session-picker-item-label';
          labelSpan.textContent = label;
          if (fullValue) {
            labelSpan.title = fullValue;
          }
          item.appendChild(labelSpan);

          const handleSelect = () => {
            onSelect();
          };
          item.addEventListener('click', (event) => {
            event.preventDefault();
            handleSelect();
          });
          item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleSelect();
            }
          });
          item.addEventListener('mouseenter', () => {
            const index = this.workingDirItems.findIndex((entry) => entry.element === item);
            if (index >= 0) {
              this.setWorkingDirFocusedIndex(index);
            }
          });

          list.appendChild(item);
          this.workingDirItems.push({ element: item, onSelect: handleSelect });
        };

        addSection('Options');
        addItem('Use default', () => finish(undefined));

        let matches = 0;
        for (const entry of entries) {
          const directories = filter
            ? entry.directories.filter((dir) => dir.toLowerCase().includes(filter))
            : entry.directories;
          if (directories.length === 0) {
            continue;
          }
          addSection(entry.root);
          for (const dir of directories) {
            const label = dir.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? dir;
            addItem(label, () => finish(dir), dir);
            matches += 1;
          }
        }
        if (matches === 0) {
          addEmpty(filter ? 'No matching directories.' : 'No directories available.');
        }

        if (this.workingDirItems.length > 0) {
          this.setWorkingDirFocusedIndex(0);
        }
      };

      renderList();
      setTimeout(() => searchInput.focus(), 0);

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.moveWorkingDirFocus(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.moveWorkingDirFocus(-1);
          return;
        }
        if (event.key === 'Enter') {
          const didSelect = this.selectWorkingDirFocusedItem();
          if (didSelect) {
            event.preventDefault();
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(undefined);
        }
      };

      const handleOverlayClick = (event: MouseEvent) => {
        if (event.target === overlay) {
          finish(undefined);
        }
      };

      searchInput.addEventListener('input', renderList);
      overlay.addEventListener('click', handleOverlayClick);
      popover.addEventListener('keydown', handleKeyDown);
      this.workingDirCleanup = () => {
        searchInput.removeEventListener('input', renderList);
        overlay.removeEventListener('click', handleOverlayClick);
        popover.removeEventListener('keydown', handleKeyDown);
      };
    });
  }

  private setWorkingDirFocusedIndex(nextIndex: number): void {
    if (this.workingDirItems.length === 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(this.workingDirItems.length - 1, nextIndex));
    if (this.workingDirFocusedIndex === clamped) {
      return;
    }
    if (this.workingDirFocusedIndex >= 0) {
      const previous = this.workingDirItems[this.workingDirFocusedIndex];
      previous?.element.classList.remove('focused');
    }
    this.workingDirFocusedIndex = clamped;
    const current = this.workingDirItems[this.workingDirFocusedIndex];
    if (current) {
      current.element.classList.add('focused');
      current.element.scrollIntoView({ block: 'nearest' });
    }
  }

  private moveWorkingDirFocus(delta: number): void {
    if (this.workingDirItems.length === 0) {
      return;
    }
    this.setWorkingDirFocusedIndex(this.workingDirFocusedIndex + delta);
  }

  private selectWorkingDirFocusedItem(): boolean {
    if (this.workingDirItems.length === 0 || this.workingDirFocusedIndex < 0) {
      return false;
    }
    const entry = this.workingDirItems[this.workingDirFocusedIndex];
    if (!entry) {
      return false;
    }
    entry.onSelect();
    return true;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
