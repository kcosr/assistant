import type {
  ChatEvent,
  ProjectedTranscriptEvent,
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
  return reduceQuestionnaireState(
    events.filter(isQuestionnaireLifecycleEvent),
    questionnaireRequestId,
  );
}

export function getQuestionnaireStateFromTranscriptEvents(
  events: ProjectedTranscriptEvent[],
  questionnaireRequestId: string,
): QuestionnaireState | null {
  return reduceQuestionnaireState(
    events
      .map((event) => toQuestionnaireLifecycleRecord(event))
      .filter((event): event is QuestionnaireLifecycleRecord => event !== null),
    questionnaireRequestId,
  );
}

type QuestionnaireLifecycleRecord =
  | { type: 'questionnaire_request'; payload: QuestionnaireRequestPayload }
  | { type: 'questionnaire_submission'; payload: QuestionnaireSubmissionPayload }
  | { type: 'questionnaire_reprompt'; payload: QuestionnaireRepromptPayload }
  | { type: 'questionnaire_update'; payload: QuestionnaireUpdatePayload };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toQuestionnaireLifecycleRecord(
  event: ChatEvent | ProjectedTranscriptEvent,
): QuestionnaireLifecycleRecord | null {
  if ('type' in event) {
    if (!isQuestionnaireLifecycleEvent(event)) {
      return null;
    }
    return event;
  }

  if (!isRecord(event.payload)) {
    return null;
  }

  switch (event.chatEventType) {
    case 'questionnaire_request':
      return {
        type: 'questionnaire_request',
        payload: event.payload as QuestionnaireRequestPayload,
      };
    case 'questionnaire_submission':
      return {
        type: 'questionnaire_submission',
        payload: event.payload as QuestionnaireSubmissionPayload,
      };
    case 'questionnaire_reprompt':
      return {
        type: 'questionnaire_reprompt',
        payload: event.payload as QuestionnaireRepromptPayload,
      };
    case 'questionnaire_update':
      return {
        type: 'questionnaire_update',
        payload: event.payload as QuestionnaireUpdatePayload,
      };
    default:
      return null;
  }
}

function reduceQuestionnaireState(
  events: Array<QuestionnaireLifecycleEvent | QuestionnaireLifecycleRecord>,
  questionnaireRequestId: string,
): QuestionnaireState | null {
  let request: QuestionnaireRequestPayload | null = null;
  let reprompt: QuestionnaireRepromptPayload | undefined;
  let submission: QuestionnaireSubmissionPayload | undefined;
  let update: QuestionnaireUpdatePayload | undefined;

  for (const event of events) {
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

export { buildQuestionnaireCallbackText } from '@assistant/shared';
