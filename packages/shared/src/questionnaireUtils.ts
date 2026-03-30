import type {
  QuestionnaireField,
  QuestionnaireSchema,
  QuestionnaireSection,
} from './chatEvents';

export interface QuestionnaireCallbackPayload {
  questionnaireRequestId: string;
  toolCallId: string;
  toolName: string;
  schemaTitle?: string;
  answers: Record<string, unknown>;
  interactionId?: string;
  submittedAt: string;
}

type FieldContext = {
  field: QuestionnaireField;
  section?: QuestionnaireSection;
};

const QUESTIONNAIRE_OPTION_TYPES = new Set(['select', 'radio', 'multiselect']);

function encodeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function buildQuestionnaireCallbackText(options: QuestionnaireCallbackPayload): string {
  const {
    questionnaireRequestId,
    toolCallId,
    toolName,
    schemaTitle,
    answers,
    interactionId,
    submittedAt,
  } = options;
  const encodedAnswers = encodeXmlAttribute(JSON.stringify(answers));
  const title = schemaTitle?.trim() ?? '';
  return [
    `<questionnaire-response`,
    ` questionnaire-request-id="${encodeXmlAttribute(questionnaireRequestId)}"`,
    ` tool-call-id="${encodeXmlAttribute(toolCallId)}"`,
    interactionId ? ` interaction-id="${encodeXmlAttribute(interactionId)}"` : '',
    ` tool="${encodeXmlAttribute(toolName)}"`,
    title ? ` schema-title="${encodeXmlAttribute(title)}"` : '',
    ` submitted-at="${encodeXmlAttribute(submittedAt)}"`,
    ` answers-json="${encodedAnswers}" />`,
  ].join('');
}

export function parseQuestionnaireCallbackText(text: string): QuestionnaireCallbackPayload | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^<questionnaire-response\s+(.+?)\s*\/>$/s);
  if (!match) {
    return null;
  }

  const attributes = new Map<string, string>();
  const attributePattern = /([a-z-]+)="([^"]*)"/g;
  const attributeSource = match[1] ?? '';
  for (const entry of attributeSource.matchAll(attributePattern)) {
    const name = entry[1];
    const value = entry[2];
    if (!name || value === undefined) {
      continue;
    }
    attributes.set(name, decodeXmlAttribute(value));
  }

  const questionnaireRequestId = attributes.get('questionnaire-request-id')?.trim() ?? '';
  const toolCallId = attributes.get('tool-call-id')?.trim() ?? '';
  const toolName = attributes.get('tool')?.trim() ?? '';
  const submittedAt = attributes.get('submitted-at')?.trim() ?? '';
  const answersJson = attributes.get('answers-json');
  if (!questionnaireRequestId || !toolCallId || !toolName || !submittedAt || !answersJson) {
    return null;
  }

  let answers: Record<string, unknown>;
  try {
    const parsed = JSON.parse(answersJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    answers = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const schemaTitle = attributes.get('schema-title')?.trim() ?? '';
  const interactionId = attributes.get('interaction-id')?.trim() ?? '';
  return {
    questionnaireRequestId,
    toolCallId,
    toolName,
    submittedAt,
    answers,
    ...(schemaTitle ? { schemaTitle } : {}),
    ...(interactionId ? { interactionId } : {}),
  };
}

export function listQuestionnaireFieldContexts(schema: QuestionnaireSchema): FieldContext[] {
  if (schema.fields && schema.fields.length > 0) {
    return schema.fields.map((field) => ({ field }));
  }
  if (schema.sections) {
    return schema.sections.flatMap((section) =>
      section.fields.map((field) => ({ field, section })),
    );
  }
  return [];
}

export function collectQuestionnaireFields(schema: QuestionnaireSchema): QuestionnaireField[] {
  return listQuestionnaireFieldContexts(schema).map((entry) => entry.field);
}

export function mergeQuestionnaireInitialValues(schema: QuestionnaireSchema): QuestionnaireSchema {
  const initialValues = schema.initialValues ?? {};
  const merged: Record<string, unknown> = { ...initialValues };
  let hasDefaults = false;

  for (const field of collectQuestionnaireFields(schema)) {
    if (field.defaultValue !== undefined && !(field.id in merged)) {
      merged[field.id] = field.defaultValue;
      hasDefaults = true;
    }
  }

  if (!hasDefaults) {
    return schema;
  }

  return {
    ...schema,
    initialValues: merged,
  };
}

export function findQuestionnaireSchemaIssue(schema: QuestionnaireSchema): string | null {
  const ids = new Set<string>();
  for (const field of collectQuestionnaireFields(schema)) {
    if (ids.has(field.id)) {
      return `Duplicate field id: ${field.id}`;
    }
    ids.add(field.id);

    if (QUESTIONNAIRE_OPTION_TYPES.has(field.type)) {
      if (!field.options || field.options.length === 0) {
        return `Field "${field.id}" requires options`;
      }
    }

    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        return `Invalid pattern for field "${field.id}"`;
      }
    }
  }

  return null;
}

export function isQuestionnaireEmptyValue(field: QuestionnaireField, value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  if (field.type === 'multiselect') {
    return !Array.isArray(value) || value.length === 0;
  }
  if (field.type === 'checkbox' || field.type === 'boolean') {
    return value !== true;
  }
  if (field.type === 'number') {
    return typeof value !== 'number' || Number.isNaN(value);
  }
  return false;
}

function getSectionSkipMap(
  schema: QuestionnaireSchema,
  input: Record<string, unknown>,
): Map<string, boolean> {
  const skipMap = new Map<string, boolean>();
  if (!schema.sections) {
    return skipMap;
  }
  for (const section of schema.sections) {
    if (!section.optional) {
      continue;
    }
    const allEmpty = section.fields.every((field) =>
      isQuestionnaireEmptyValue(field, input[field.id]),
    );
    skipMap.set(section.id, allEmpty);
  }
  return skipMap;
}

export function validateQuestionnaireInput(
  schema: QuestionnaireSchema,
  input: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const sectionSkipMap = getSectionSkipMap(schema, input);

  for (const { field, section } of listQuestionnaireFieldContexts(schema)) {
    if (section && section.optional && sectionSkipMap.get(section.id)) {
      continue;
    }

    const value = input[field.id];
    const empty = isQuestionnaireEmptyValue(field, value);

    if (field.required && empty) {
      errors[field.id] = 'This field is required.';
      continue;
    }

    if (empty) {
      continue;
    }

    switch (field.type) {
      case 'text':
      case 'textarea': {
        if (typeof value !== 'string') {
          errors[field.id] = 'Enter a valid text value.';
          break;
        }
        if (typeof field.minLength === 'number' && value.length < field.minLength) {
          errors[field.id] = `Must be at least ${field.minLength} characters.`;
        }
        if (typeof field.maxLength === 'number' && value.length > field.maxLength) {
          errors[field.id] = `Must be at most ${field.maxLength} characters.`;
        }
        if (field.pattern) {
          const regex = new RegExp(field.pattern);
          if (!regex.test(value)) {
            errors[field.id] = 'Invalid format.';
          }
        }
        break;
      }
      case 'number': {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors[field.id] = 'Enter a valid number.';
          break;
        }
        if (typeof field.min === 'number' && value < field.min) {
          errors[field.id] = `Must be at least ${field.min}.`;
        }
        if (typeof field.max === 'number' && value > field.max) {
          errors[field.id] = `Must be at most ${field.max}.`;
        }
        break;
      }
      case 'select':
      case 'radio': {
        if (typeof value !== 'string') {
          errors[field.id] = 'Select a valid option.';
          break;
        }
        const options = field.options ?? [];
        if (!options.some((option) => option.value === value)) {
          errors[field.id] = 'Select a valid option.';
        }
        break;
      }
      case 'multiselect': {
        if (!Array.isArray(value)) {
          errors[field.id] = 'Select one or more options.';
          break;
        }
        const options = new Set((field.options ?? []).map((option) => option.value));
        const unknown = value.some((entry) => !options.has(String(entry)));
        if (unknown) {
          errors[field.id] = 'Select valid options.';
        }
        break;
      }
      case 'checkbox':
      case 'boolean': {
        if (typeof value !== 'boolean') {
          errors[field.id] = 'Select a valid option.';
        }
        break;
      }
      case 'date':
      case 'time':
      case 'datetime': {
        if (typeof value !== 'string' || value.trim().length === 0) {
          errors[field.id] = 'Enter a valid date/time value.';
        }
        break;
      }
      default:
        break;
    }
  }

  return errors;
}
