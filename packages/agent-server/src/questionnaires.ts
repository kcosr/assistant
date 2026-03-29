import type {
  ChatEvent,
  QuestionnaireRepromptPayload,
  QuestionnaireRequestPayload,
  QuestionnaireSubmissionPayload,
  QuestionnaireUpdatePayload,
} from '@assistant/shared';

export type QuestionnaireLifecycleEvent = Extract<
  ChatEvent,
  | { type: 'questionnaire_request' }
  | { type: 'questionnaire_submission' }
  | { type: 'questionnaire_reprompt' }
  | { type: 'questionnaire_update' }
>;

export type QuestionnaireState =
  | {
      request: QuestionnaireRequestPayload;
      status: 'pending';
      reprompt?: QuestionnaireRepromptPayload;
    }
  | {
      request: QuestionnaireRequestPayload;
      status: 'submitted';
      submission: QuestionnaireSubmissionPayload;
      reprompt?: QuestionnaireRepromptPayload;
    }
  | {
      request: QuestionnaireRequestPayload;
      status: 'cancelled';
      update: QuestionnaireUpdatePayload;
      reprompt?: QuestionnaireRepromptPayload;
    };

export function isQuestionnaireLifecycleEvent(
  event: ChatEvent,
): event is QuestionnaireLifecycleEvent {
  return (
    event.type === 'questionnaire_request' ||
    event.type === 'questionnaire_submission' ||
    event.type === 'questionnaire_reprompt' ||
    event.type === 'questionnaire_update'
  );
}

export function getQuestionnaireState(
  events: ChatEvent[],
  questionnaireRequestId: string,
): QuestionnaireState | null {
  let request: QuestionnaireRequestPayload | null = null;
  let reprompt: QuestionnaireRepromptPayload | undefined;
  let submission: QuestionnaireSubmissionPayload | undefined;
  let update: QuestionnaireUpdatePayload | undefined;

  for (const event of events) {
    if (!isQuestionnaireLifecycleEvent(event)) {
      continue;
    }
    if (event.payload.questionnaireRequestId !== questionnaireRequestId) {
      continue;
    }

    switch (event.type) {
      case 'questionnaire_request':
        request = event.payload;
        break;
      case 'questionnaire_reprompt':
        reprompt = event.payload;
        break;
      case 'questionnaire_submission':
        submission = event.payload;
        break;
      case 'questionnaire_update':
        update = event.payload;
        break;
      default:
        break;
    }
  }

  if (!request) {
    return null;
  }
  if (update) {
    return {
      request,
      status: 'cancelled',
      update,
      ...(reprompt ? { reprompt } : {}),
    };
  }
  if (submission) {
    return {
      request,
      status: 'submitted',
      submission,
      ...(reprompt ? { reprompt } : {}),
    };
  }
  return {
    request,
    status: 'pending',
    ...(reprompt ? { reprompt } : {}),
  };
}

export function buildQuestionnaireCallbackText(options: {
  questionnaireRequestId: string;
  toolCallId: string;
  toolName: string;
  schemaTitle?: string;
  answers: Record<string, unknown>;
  interactionId?: string;
  submittedAt: string;
}): string {
  const {
    questionnaireRequestId,
    toolCallId,
    toolName,
    schemaTitle,
    answers,
    interactionId,
    submittedAt,
  } = options;
  const encodeAttribute = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const encodedAnswers = encodeAttribute(JSON.stringify(answers));
  const title = schemaTitle?.trim() ?? '';
  return [
    `<questionnaire-response`,
    ` questionnaire-request-id="${encodeAttribute(questionnaireRequestId)}"`,
    ` tool-call-id="${encodeAttribute(toolCallId)}"`,
    interactionId ? ` interaction-id="${encodeAttribute(interactionId)}"` : '',
    ` tool="${encodeAttribute(toolName)}"`,
    title ? ` schema-title="${encodeAttribute(title)}"` : '',
    ` submitted-at="${encodeAttribute(submittedAt)}"`,
    ` answers-json="${encodedAnswers}" />`,
  ].join('');
}
