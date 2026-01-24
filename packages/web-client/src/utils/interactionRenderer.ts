import type {
  InteractionRequestPayload,
  InteractionResponsePayload,
  QuestionnaireField,
} from '@assistant/shared';

export type InteractionResponseDraft = Omit<
  InteractionResponsePayload,
  'toolCallId' | 'interactionId'
>;

export function createInteractionElement(options: {
  request: InteractionRequestPayload;
  enabled: boolean;
  onSubmit: (response: InteractionResponseDraft) => void;
}): HTMLDivElement {
  const { request } = options;
  if (request.interactionType === 'approval') {
    return createApprovalInteraction(options);
  }
  return createQuestionnaireInteraction(options);
}

export function applyInteractionResponse(
  element: HTMLElement,
  response: InteractionResponsePayload,
): void {
  element.classList.add('interaction-complete');
  const controls = element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input, select, textarea, button',
  );
  for (const control of controls) {
    control.disabled = true;
  }

  let summary = element.querySelector<HTMLElement>('[data-role="interaction-summary"]');
  if (!summary) {
    summary = element.querySelector<HTMLElement>('.interaction-summary');
  }

  if (response.action === 'approve' || response.action === 'deny') {
    if (summary) {
      const scope = response.approvalScope ? ` (${response.approvalScope})` : '';
      summary.textContent =
        response.action === 'approve' ? `Approved${scope}` : 'Denied';
    }
  } else if (response.action === 'cancel') {
    if (!summary) {
      summary = document.createElement('div');
      summary.className = 'interaction-summary';
      summary.dataset['role'] = 'interaction-summary';
      element.appendChild(summary);
    }
    summary.textContent = response.reason ? response.reason : 'Cancelled';
  }

  if (response.input) {
    applyResponseValues(element, response.input);
  }
}

function createApprovalInteraction(options: {
  request: InteractionRequestPayload;
  enabled: boolean;
  onSubmit: (response: InteractionResponseDraft) => void;
}): HTMLDivElement {
  const { request, enabled, onSubmit } = options;

  const wrapper = document.createElement('div');
  wrapper.className = 'interaction-block interaction-approval';
  wrapper.dataset['interactionId'] = request.interactionId;

  const prompt = document.createElement('div');
  prompt.className = 'interaction-prompt';
  prompt.textContent = request.prompt ?? `Allow "${request.toolName}"?`;
  wrapper.appendChild(prompt);

  const summary = document.createElement('div');
  summary.className = 'interaction-summary';
  summary.dataset['role'] = 'interaction-summary';
  wrapper.appendChild(summary);

  const actions = document.createElement('div');
  actions.className = 'interaction-actions';

  const denyButton = createActionButton('Deny', () => {
    onSubmit({ action: 'deny' });
  });
  actions.appendChild(denyButton);

  const scopes: Array<'once' | 'session' | 'always'> = request.approvalScopes?.length
    ? request.approvalScopes
    : ['once', 'session'];
  for (const scope of scopes) {
    const label =
      scope === 'once'
        ? 'Allow once'
        : scope === 'session'
          ? 'Allow for session'
          : 'Always allow';
    actions.appendChild(
      createActionButton(label, () => {
        onSubmit({ action: 'approve', approvalScope: scope });
      }),
    );
  }

  if (!enabled) {
    actions.classList.add('disabled');
    const hint = document.createElement('div');
    hint.className = 'interaction-hint';
    hint.textContent = 'Interactive mode disabled — enable to respond.';
    wrapper.appendChild(hint);
  }

  wrapper.appendChild(actions);

  if (!enabled) {
    disableButtons(actions);
  }

  return wrapper;
}

function createQuestionnaireInteraction(options: {
  request: InteractionRequestPayload;
  enabled: boolean;
  onSubmit: (response: InteractionResponseDraft) => void;
}): HTMLDivElement {
  const { request, enabled, onSubmit } = options;
  const inputSchema = request.inputSchema;

  const wrapper = document.createElement('div');
  wrapper.className = 'interaction-block interaction-questionnaire';
  wrapper.dataset['interactionId'] = request.interactionId;

  if (request.prompt) {
    const prompt = document.createElement('div');
    prompt.className = 'interaction-prompt';
    prompt.textContent = request.prompt;
    wrapper.appendChild(prompt);
  }

  if (request.errorSummary) {
    const error = document.createElement('div');
    error.className = 'interaction-error-summary';
    error.textContent = request.errorSummary;
    wrapper.appendChild(error);
  }

  if (!inputSchema || typeof inputSchema !== 'object') {
    const empty = document.createElement('div');
    empty.className = 'interaction-empty';
    empty.textContent = 'No input schema provided.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  const title = (inputSchema as { title?: string }).title;
  if (title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'interaction-title';
    titleEl.textContent = title;
    wrapper.appendChild(titleEl);
  }

  const description = (inputSchema as { description?: string }).description;
  if (description) {
    const descEl = document.createElement('div');
    descEl.className = 'interaction-description';
    descEl.textContent = description;
    wrapper.appendChild(descEl);
  }

  const form = document.createElement('form');
  form.className = 'interaction-form';

  const schema = inputSchema as {
    type?: string;
    fields?: QuestionnaireField[];
    sections?: Array<{ fields: QuestionnaireField[]; title?: string; description?: string }>;
    submitLabel?: string;
    cancelLabel?: string;
    initialValues?: Record<string, unknown>;
  };

  const fields = schema.fields ?? [];
  const sections = schema.sections ?? [];

  if (schema.type === 'form') {
    const simpleFields = fields as QuestionnaireField[];
    appendFields(form, simpleFields, request);
  } else if (sections.length > 0) {
    for (const section of sections) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'interaction-section';
      if (section.title) {
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'interaction-section-title';
        sectionTitle.textContent = section.title;
        sectionEl.appendChild(sectionTitle);
      }
      if (section.description) {
        const sectionDesc = document.createElement('div');
        sectionDesc.className = 'interaction-section-description';
        sectionDesc.textContent = section.description;
        sectionEl.appendChild(sectionDesc);
      }
      appendFields(sectionEl, section.fields, request);
      form.appendChild(sectionEl);
    }
  } else {
    appendFields(form, fields, request);
  }

  const actions = document.createElement('div');
  actions.className = 'interaction-actions';
  const cancelLabel = schema.cancelLabel ?? 'Cancel';
  const submitLabel = schema.submitLabel ?? 'Submit';

  const cancelButton = createActionButton(cancelLabel, () => {
    onSubmit({ action: 'cancel' });
  });
  cancelButton.type = 'button';
  actions.appendChild(cancelButton);

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'interaction-action';
  submitButton.textContent = submitLabel;
  actions.appendChild(submitButton);

  form.appendChild(actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!enabled) {
      return;
    }
    if (!form.reportValidity()) {
      return;
    }
    const input = collectFormValues(form);
    onSubmit({ action: 'submit', input });
  });

  if (!enabled) {
    form.classList.add('disabled');
    disableButtons(form);
    const hint = document.createElement('div');
    hint.className = 'interaction-hint';
    hint.textContent = 'Interactive mode disabled — enable to respond.';
    wrapper.appendChild(hint);
  }

  wrapper.appendChild(form);
  applyInitialValues(wrapper, schema.initialValues);

  return wrapper;
}

function appendFields(
  container: HTMLElement,
  fields: QuestionnaireField[],
  request: InteractionRequestPayload,
): void {
  for (const field of fields) {
    const fieldRow = document.createElement('div');
    fieldRow.className = 'interaction-field';

    const label = document.createElement('label');
    label.className = 'interaction-field-label';
    const labelText = document.createElement('span');
    labelText.className = 'interaction-field-label-text';
    labelText.textContent = field.label;
    label.appendChild(labelText);

    if (field.required) {
      const required = document.createElement('span');
      required.className = 'interaction-field-required';
      required.textContent = ' *';
      labelText.appendChild(required);
    }

    const input = createInputForField(field);
    label.appendChild(input);
    fieldRow.appendChild(label);

    if (field.description) {
      const desc = document.createElement('div');
      desc.className = 'interaction-field-description';
      desc.textContent = field.description;
      fieldRow.appendChild(desc);
    }

    const errorText = request.fieldErrors?.[field.id];
    if (errorText) {
      const error = document.createElement('div');
      error.className = 'interaction-field-error';
      error.textContent = errorText;
      fieldRow.appendChild(error);
    }

    container.appendChild(fieldRow);
  }
}

function createInputForField(
  field: QuestionnaireField,
): HTMLElement {
  const shouldValidate = field.validateOnClient !== false;
  switch (field.type) {
    case 'textarea': {
      const textarea = document.createElement('textarea');
      textarea.className = 'interaction-input';
      textarea.dataset['fieldId'] = field.id;
      if (shouldValidate && field.required) textarea.required = true;
      if (field.placeholder) textarea.placeholder = field.placeholder;
      if (shouldValidate && typeof field.minLength === 'number') {
        textarea.minLength = field.minLength;
      }
      if (shouldValidate && typeof field.maxLength === 'number') {
        textarea.maxLength = field.maxLength;
      }
      return textarea;
    }
    case 'select':
    case 'multiselect': {
      const select = document.createElement('select');
      select.className = 'interaction-input';
      select.dataset['fieldId'] = field.id;
      if (field.type === 'multiselect') {
        select.multiple = true;
      }
      if (shouldValidate && field.required) {
        select.required = true;
      }
      if (field.options) {
        for (const option of field.options) {
          const optionEl = document.createElement('option');
          optionEl.value = option.value;
          optionEl.textContent = option.label;
          select.appendChild(optionEl);
        }
      }
      return select;
    }
    case 'radio': {
      const wrapper = document.createElement('div');
      wrapper.className = 'interaction-radio-group';
      if (field.options) {
        field.options.forEach((option, index) => {
          const optionLabel = document.createElement('label');
          optionLabel.className = 'interaction-radio-option';
          const input = document.createElement('input');
          input.className = 'interaction-option-input';
          input.type = 'radio';
          input.name = field.id;
          input.value = option.value;
          input.dataset['fieldId'] = field.id;
          if (shouldValidate && field.required && index === 0) {
            input.required = true;
          }
          optionLabel.appendChild(input);
          optionLabel.append(option.label);
          wrapper.appendChild(optionLabel);
        });
      }
      return wrapper;
    }
    case 'checkbox':
    case 'boolean': {
      const input = document.createElement('input');
      input.className = 'interaction-option-input';
      input.type = 'checkbox';
      input.dataset['fieldId'] = field.id;
      if (shouldValidate && field.required) {
        input.required = true;
      }
      return input;
    }
    case 'number':
    case 'date':
    case 'time':
    case 'datetime':
    case 'text':
    default: {
      const input = document.createElement('input');
      input.className = 'interaction-input';
      input.type =
        field.type === 'number'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : field.type === 'time'
              ? 'time'
              : field.type === 'datetime'
                ? 'datetime-local'
                : 'text';

      input.dataset['fieldId'] = field.id;
      if (shouldValidate && field.required) {
        input.required = true;
      }
      if (field.placeholder) {
        input.placeholder = field.placeholder;
      }
      if (field.type === 'number') {
        if (shouldValidate && typeof field.min === 'number') {
          input.min = String(field.min);
        }
        if (shouldValidate && typeof field.max === 'number') {
          input.max = String(field.max);
        }
        if (shouldValidate && typeof field.step === 'number') {
          input.step = String(field.step);
        }
      }

      if (field.type === 'text') {
        if (shouldValidate && typeof field.minLength === 'number') {
          input.minLength = field.minLength;
        }
        if (shouldValidate && typeof field.maxLength === 'number') {
          input.maxLength = field.maxLength;
        }
        if (shouldValidate && typeof field.pattern === 'string') {
          input.pattern = field.pattern;
        }
      }

      return input;
    }
  }
}

function collectFormValues(form: HTMLFormElement): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const inputs = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    '[data-field-id]',
  );
  for (const input of inputs) {
    const fieldId = input.dataset['fieldId'];
    if (!fieldId) {
      continue;
    }
    if (input instanceof HTMLInputElement) {
      if (input.type === 'checkbox') {
        values[fieldId] = input.checked;
      } else if (input.type === 'radio') {
        if (input.checked) {
          values[fieldId] = input.value;
        }
      } else if (input.type === 'number') {
        values[fieldId] = input.value === '' ? null : Number(input.value);
      } else {
        values[fieldId] = input.value;
      }
    } else if (input instanceof HTMLSelectElement) {
      if (input.multiple) {
        values[fieldId] = Array.from(input.selectedOptions).map((option) => option.value);
      } else {
        values[fieldId] = input.value;
      }
    } else {
      values[fieldId] = input.value;
    }
  }
  return values;
}

function applyInitialValues(
  wrapper: HTMLElement,
  initialValues?: Record<string, unknown>,
): void {
  if (!initialValues) {
    return;
  }
  applyResponseValues(wrapper, initialValues);
}

function applyResponseValues(wrapper: HTMLElement, values: Record<string, unknown>): void {
  const inputs = wrapper.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    '[data-field-id]',
  );
  for (const input of inputs) {
    const fieldId = input.dataset['fieldId'];
    if (!fieldId) {
      continue;
    }
    if (!(fieldId in values)) {
      continue;
    }
    const value = values[fieldId];
    if (input instanceof HTMLInputElement) {
      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else if (input.type === 'radio') {
        input.checked = input.value === String(value);
      } else {
        input.value = value == null ? '' : String(value);
      }
    } else if (input instanceof HTMLSelectElement) {
      if (input.multiple) {
        const selected = new Set(
          Array.isArray(value) ? value.map((item) => String(item)) : [],
        );
        for (const option of input.options) {
          option.selected = selected.has(option.value);
        }
      } else {
        input.value = value == null ? '' : String(value);
      }
    } else {
      input.value = value == null ? '' : String(value);
    }
  }
}

function disableButtons(container: HTMLElement): void {
  const buttons = container.querySelectorAll<HTMLButtonElement>('button');
  for (const button of buttons) {
    button.disabled = true;
  }
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'interaction-action';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}
