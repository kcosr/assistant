import type {
  QuestionnaireField,
  QuestionnaireSchema,
  QuestionnaireSection,
} from './chatEvents';

type FieldContext = {
  field: QuestionnaireField;
  section?: QuestionnaireSection;
};

const QUESTIONNAIRE_OPTION_TYPES = new Set(['select', 'radio', 'multiselect']);

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
