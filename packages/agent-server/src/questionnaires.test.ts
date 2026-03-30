import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import { buildQuestionnaireCallbackText, getQuestionnaireState } from './questionnaires';

describe('questionnaires', () => {
  it('reduces questionnaire lifecycle events into the latest state', () => {
    const events: ChatEvent[] = [
      {
        id: 'e1',
        timestamp: Date.now(),
        sessionId: 's1',
        type: 'questionnaire_request',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tool-1',
          toolName: 'questions_ask',
          mode: 'async',
          schema: {
            title: 'Profile',
            fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
          },
          status: 'pending',
          createdAt: '2026-03-29T12:00:00.000Z',
        },
      },
      {
        id: 'e2',
        timestamp: Date.now(),
        sessionId: 's1',
        type: 'questionnaire_reprompt',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tool-1',
          status: 'pending',
          updatedAt: '2026-03-29T12:01:00.000Z',
          errorSummary: 'Please correct the highlighted fields.',
          fieldErrors: { name: 'This field is required.' },
          initialValues: { name: '' },
        },
      },
      {
        id: 'e3',
        timestamp: Date.now(),
        sessionId: 's1',
        type: 'questionnaire_submission',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tool-1',
          status: 'submitted',
          submittedAt: '2026-03-29T12:02:00.000Z',
          interactionId: 'i1',
          answers: { name: 'Ada' },
        },
      },
    ];

    const state = getQuestionnaireState(events, 'qr1');
    expect(state?.status).toBe('submitted');
    if (!state || state.status !== 'submitted') {
      return;
    }
    expect(state.submission.answers).toEqual({ name: 'Ada' });
    expect(state.reprompt?.fieldErrors).toEqual({ name: 'This field is required.' });
  });

  it('escapes callback payload attributes safely', () => {
    const text = buildQuestionnaireCallbackText({
      questionnaireRequestId: 'qr<1>',
      toolCallId: 'tool"1"',
      toolName: "questions'ask",
      schemaTitle: 'Title & <More>',
      answers: { note: '"<&>\'' },
      interactionId: 'i>1',
      submittedAt: '2026-03-29T12:02:00.000Z',
    });

    expect(text).toContain('questionnaire-request-id="qr&lt;1&gt;"');
    expect(text).toContain('tool-call-id="tool&quot;1&quot;"');
    expect(text).toContain('tool="questions&apos;ask"');
    expect(text).toContain('schema-title="Title &amp; &lt;More&gt;"');
    expect(text).toContain('interaction-id="i&gt;1"');
    expect(text).toContain('&lt;');
    expect(text).toContain('&apos;');
  });
});
