// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { InteractionRequestPayload } from '@assistant/shared';
import { applyInteractionResponse, createInteractionElement } from './interactionRenderer';

describe('interactionRenderer', () => {
  it('submits questionnaire form values', () => {
    const request: InteractionRequestPayload = {
      toolCallId: 'tc1',
      toolName: 'ask_user',
      interactionId: 'i1',
      interactionType: 'input',
      inputSchema: {
        title: 'Quick question',
        fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
      },
    };
    const onSubmit = vi.fn();
    const element = createInteractionElement({ request, enabled: true, onSubmit });
    document.body.appendChild(element);

    const input = element.querySelector<HTMLInputElement>('[data-field-id="answer"]');
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = 'hello';

    const form = element.querySelector<HTMLFormElement>('form');
    expect(form).not.toBeNull();
    if (!form) return;
    form.reportValidity = () => true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(onSubmit).toHaveBeenCalledWith({ action: 'submit', input: { answer: 'hello' } });
  });

  it('skips client validation when validateOnClient is false', () => {
    const request: InteractionRequestPayload = {
      toolCallId: 'tc2',
      toolName: 'questions_ask',
      interactionId: 'i2',
      interactionType: 'input',
      inputSchema: {
        title: 'Skip validation',
        fields: [
          {
            id: 'name',
            type: 'text',
            label: 'Name',
            required: true,
            minLength: 3,
            pattern: '^a',
            validateOnClient: false,
          },
        ],
      },
    };
    const onSubmit = vi.fn();
    const element = createInteractionElement({ request, enabled: true, onSubmit });
    document.body.appendChild(element);

    const input = element.querySelector<HTMLInputElement>('[data-field-id=\"name\"]');
    expect(input).not.toBeNull();
    if (!input) return;

    expect(input.required).toBe(false);
    expect(input.minLength).toBe(-1);
    expect(input.pattern).toBe('');
  });

  it('adds required indicator and themed input classes', () => {
    const request: InteractionRequestPayload = {
      toolCallId: 'tc3',
      toolName: 'questions_ask',
      interactionId: 'i3',
      interactionType: 'input',
      inputSchema: {
        title: 'Required field',
        fields: [{ id: 'email', type: 'text', label: 'Email', required: true }],
      },
    };
    const onSubmit = vi.fn();
    const element = createInteractionElement({ request, enabled: true, onSubmit });
    document.body.appendChild(element);

    const label = element.querySelector<HTMLLabelElement>('.interaction-field-label');
    expect(label).not.toBeNull();
    const required = label?.querySelector('.interaction-field-required');
    expect(required).not.toBeNull();
    expect(required?.textContent?.trim()).toBe('*');

    const input = element.querySelector<HTMLInputElement>('[data-field-id="email"]');
    expect(input).not.toBeNull();
    expect(input?.classList.contains('interaction-input')).toBe(true);
  });

  it('shows a cancel reason when interactions are completed', () => {
    const request: InteractionRequestPayload = {
      toolCallId: 'tc4',
      toolName: 'dangerous_action',
      interactionId: 'i4',
      interactionType: 'approval',
      prompt: 'Allow this action?',
    };
    const onSubmit = vi.fn();
    const element = createInteractionElement({ request, enabled: true, onSubmit });
    document.body.appendChild(element);

    applyInteractionResponse(element, {
      toolCallId: 'tc4',
      interactionId: 'i4',
      action: 'cancel',
      reason: 'Timed out',
    });

    const summary = element.querySelector<HTMLElement>('.interaction-summary');
    expect(summary?.textContent).toBe('Timed out');
  });

  it('submits on Enter even inside textarea', () => {
    const request: InteractionRequestPayload = {
      toolCallId: 'tc5',
      toolName: 'questions_ask',
      interactionId: 'i5',
      interactionType: 'input',
      inputSchema: {
        title: 'Details',
        fields: [{ id: 'notes', type: 'textarea', label: 'Notes' }],
      },
    };
    const onSubmit = vi.fn();
    const element = createInteractionElement({ request, enabled: true, onSubmit });
    document.body.appendChild(element);

    const form = element.querySelector<HTMLFormElement>('form');
    expect(form).not.toBeNull();
    if (!form) return;
    form.reportValidity = () => true;
    form.requestSubmit = () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };

    const textarea = element.querySelector<HTMLTextAreaElement>('[data-field-id="notes"]');
    expect(textarea).not.toBeNull();
    if (!textarea) return;
    textarea.value = 'hello';

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSubmit).toHaveBeenCalledWith({ action: 'submit', input: { notes: 'hello' } });
  });

  it('does not submit on Shift+Enter in textarea', () => {
    const request: InteractionRequestPayload = {
      toolCallId: 'tc6',
      toolName: 'questions_ask',
      interactionId: 'i6',
      interactionType: 'input',
      inputSchema: {
        title: 'Details',
        fields: [{ id: 'notes', type: 'textarea', label: 'Notes' }],
      },
    };
    const onSubmit = vi.fn();
    const element = createInteractionElement({ request, enabled: true, onSubmit });
    document.body.appendChild(element);

    const form = element.querySelector<HTMLFormElement>('form');
    expect(form).not.toBeNull();
    if (!form) return;
    form.reportValidity = () => true;
    form.requestSubmit = () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };

    const textarea = element.querySelector<HTMLTextAreaElement>('[data-field-id="notes"]');
    expect(textarea).not.toBeNull();
    if (!textarea) return;
    textarea.value = 'hello';

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
