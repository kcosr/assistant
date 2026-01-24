import type {
  CombinedPluginManifest,
  QuestionnaireField,
  QuestionnaireSchema,
  QuestionnaireSection,
} from '@assistant/shared';
import { QuestionnaireSchema as QuestionnaireSchemaZod } from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type QuestionsAskArgs = {
  prompt?: string;
  schema: QuestionnaireSchema;
  timeoutMs?: number;
  completedView?: {
    showInputs?: boolean;
    summaryTemplate?: string;
  };
  validate?: boolean;
};

type FieldContext = {
  field: QuestionnaireField;
  section?: QuestionnaireSection;
};

const QUESTIONNAIRE_OPTION_TYPES = new Set(['select', 'radio', 'multiselect']);

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ToolError('invalid_arguments', `${field} must be a boolean`);
  }
  return value;
}

function parseOptionalTimeout(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ToolError('invalid_arguments', 'timeoutMs must be a positive number');
  }
  return value;
}

function parseCompletedView(value: unknown): QuestionsAskArgs['completedView'] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'completedView must be an object');
  }
  const obj = value as Record<string, unknown>;
  const showInputs = obj['showInputs'];
  if (showInputs !== undefined && typeof showInputs !== 'boolean') {
    throw new ToolError('invalid_arguments', 'completedView.showInputs must be a boolean');
  }
  const summaryTemplate = obj['summaryTemplate'];
  if (summaryTemplate !== undefined && typeof summaryTemplate !== 'string') {
    throw new ToolError('invalid_arguments', 'completedView.summaryTemplate must be a string');
  }
  return {
    ...(showInputs !== undefined ? { showInputs } : {}),
    ...(summaryTemplate !== undefined ? { summaryTemplate } : {}),
  };
}

function listFieldContexts(schema: QuestionnaireSchema): FieldContext[] {
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

function collectFields(schema: QuestionnaireSchema): QuestionnaireField[] {
  return listFieldContexts(schema).map((entry) => entry.field);
}

function mergeInitialValues(schema: QuestionnaireSchema): QuestionnaireSchema {
  const initialValues = schema.initialValues ?? {};
  const merged: Record<string, unknown> = { ...initialValues };
  let hasDefaults = false;

  for (const field of collectFields(schema)) {
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

function ensureSchemaValid(schema: QuestionnaireSchema): void {
  const ids = new Set<string>();
  for (const field of collectFields(schema)) {
    if (ids.has(field.id)) {
      throw new ToolError('invalid_arguments', `Duplicate field id: ${field.id}`);
    }
    ids.add(field.id);

    if (QUESTIONNAIRE_OPTION_TYPES.has(field.type)) {
      if (!field.options || field.options.length === 0) {
        throw new ToolError('invalid_arguments', `Field "${field.id}" requires options`);
      }
    }

    if (field.pattern) {
      try {
        new RegExp(field.pattern);
      } catch {
        throw new ToolError('invalid_arguments', `Invalid pattern for field "${field.id}"`);
      }
    }
  }
}

function parseQuestionnaireArgs(raw: unknown): QuestionsAskArgs {
  const obj = asObject(raw);
  const schemaRaw = obj['schema'];
  if (!schemaRaw || typeof schemaRaw !== 'object' || Array.isArray(schemaRaw)) {
    throw new ToolError('invalid_arguments', 'schema is required and must be an object');
  }
  const parsedSchema = QuestionnaireSchemaZod.safeParse(schemaRaw);
  if (!parsedSchema.success) {
    const issues = parsedSchema.error.errors
      .map((issue) => issue.message)
      .slice(0, 3)
      .join('; ');
    throw new ToolError('invalid_arguments', `schema is invalid: ${issues}`);
  }
  ensureSchemaValid(parsedSchema.data);

  const prompt = parseOptionalString(obj['prompt'], 'prompt');
  const timeoutMs = parseOptionalTimeout(obj['timeoutMs']);
  const completedView = parseCompletedView(obj['completedView']);
  const validate = parseOptionalBoolean(obj['validate'], 'validate');

  return {
    schema: parsedSchema.data,
    ...(prompt ? { prompt } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(completedView ? { completedView } : {}),
    ...(validate !== undefined ? { validate } : {}),
  };
}

function requireInteraction(ctx: ToolContext) {
  const requestInteraction = ctx.requestInteraction;
  if (!requestInteraction) {
    throw new ToolError(
      'interaction_unavailable',
      'Interactive tools are not available in this environment.',
    );
  }
  return requestInteraction;
}

function isEmptyValue(field: QuestionnaireField, value: unknown): boolean {
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
    const allEmpty = section.fields.every((field) => isEmptyValue(field, input[field.id]));
    skipMap.set(section.id, allEmpty);
  }
  return skipMap;
}

function validateInput(
  schema: QuestionnaireSchema,
  input: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const sectionSkipMap = getSectionSkipMap(schema, input);

  for (const { field, section } of listFieldContexts(schema)) {
    if (section && section.optional && sectionSkipMap.get(section.id)) {
      continue;
    }

    const value = input[field.id];
    const empty = isEmptyValue(field, value);

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

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      ask: async (args, ctx) => {
        const parsed = parseQuestionnaireArgs(args);
        const requestInteraction = requireInteraction(ctx);
        const schemaWithDefaults = mergeInitialValues(parsed.schema);

        return requestInteraction({
          type: 'input',
          presentation: 'questionnaire',
          ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
          ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
          ...(parsed.completedView ? { completedView: parsed.completedView } : {}),
          inputSchema: schemaWithDefaults,
          onResponse: (response) => {
            if (response.action === 'cancel') {
              return { complete: { ok: false, cancelled: true } };
            }
            if (response.action !== 'submit') {
              return { complete: { ok: false, error: 'Unexpected response action' } };
            }

            const input = response.input ?? {};
            if (parsed.validate !== false) {
              const fieldErrors = validateInput(parsed.schema, input);
              if (Object.keys(fieldErrors).length > 0) {
                return {
                  reprompt: {
                    type: 'input',
                    presentation: 'questionnaire',
                    ...(parsed.prompt ? { prompt: parsed.prompt } : {}),
                    ...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
                    ...(parsed.completedView ? { completedView: parsed.completedView } : {}),
                    inputSchema: {
                      ...parsed.schema,
                      initialValues: input,
                    },
                    errorSummary: 'Please correct the highlighted fields.',
                    fieldErrors,
                  },
                };
              }
            }

            return {
              complete: {
                ok: true,
                answers: input,
              },
            };
          },
        });
      },
    },
  };
}
