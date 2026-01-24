// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { InteractionRequestPayload } from '@assistant/shared';
import { createInteractionElement } from './interactionRenderer';

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
});
