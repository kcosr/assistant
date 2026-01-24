# Questionnaire Tool Specification

## Overview

This document defines a lightweight questionnaire schema for interactive tools that collect structured user input. It is **inspired by A2UI’s component catalog**, but does not adopt the full A2UI protocol. The questionnaire schema is carried inside `InteractionRequest` payloads and rendered by the client as a dedicated **questionnaire block** (not a tool output block).

The schema supports common input controls (text, textarea, select, checkbox, radio, number, date/time) and provides validation hints that tools can use when handling responses.

## Goals

- Provide a consistent, declarative schema for question UI
- Keep transport simple: use existing `interaction_request` / `interaction_response` ChatEvents
- Enable validation + reprompt flows
- Allow tools to render questionnaires as standalone chat blocks (`presentation: 'questionnaire'`)
- Borrow proven UI primitives from A2UI without adopting its full protocol

## Non‑Goals

- Full A2UI surface lifecycle (createSurface/updateComponents/etc.)
- Arbitrary custom component catalogs
- Client‑side business logic (validation stays tool‑controlled)

## Questionnaire Schema

### InteractionRequest Extension

```ts
interface InteractionRequest {
  type: 'input';
  presentation?: 'questionnaire'; // required for questionnaire rendering
  prompt?: string;                // optional intro text
  approvalScopes?: never;         // not used for input

  inputSchema: QuestionnaireSchema;
  completedView?: {
    showInputs?: boolean;
    summaryTemplate?: string;
  };

  // Hook callbacks
  onResponse: (response: UserResponse) => InteractionOutcome | Promise<InteractionOutcome>;
  onTimeout?: () => InteractionOutcome | Promise<InteractionOutcome>;
  onCancel?: () => void;
}
```

### QuestionnaireSchema

```ts
interface QuestionnaireSchema {
  title?: string;                  // headline shown above the form
  description?: string;            // optional body text
  fields?: QuestionnaireField[];   // simple forms
  sections?: QuestionnaireSection[]; // multi-step/grouped forms
  submitLabel?: string;            // default: "Submit"
  cancelLabel?: string;            // default: "Cancel"
  /** Prefill values keyed by field id (preserved across reprompts) */
  initialValues?: Record<string, unknown>;
}

interface QuestionnaireSection {
  id: string;
  title?: string;
  description?: string;
  fields: QuestionnaireField[];
  optional?: boolean;              // allow skipping section
  submitLabel?: string;            // overrides schema submit label
}
```

**Rules:**
- Use either `fields` or `sections` (not both)
- If `sections` is provided, client renders a stepper or grouped layout
- Optional sections can be skipped; required sections must be completed

### QuestionnaireField

```ts
type QuestionnaireFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'date'
  | 'time'
  | 'datetime';

interface QuestionnaireField {
  id: string;                      // key in response input
  type: QuestionnaireFieldType;
  label: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: unknown;          // used if no initialValues override
  // Note: per-field "initialValue" is not supported; use schema.initialValues instead.

  /** Enable client-side validation for this field (default: true) */
  validateOnClient?: boolean;

  // For select/radio/multiselect
  options?: Array<{ label: string; value: string }>;

  // For number
  min?: number;
  max?: number;
  step?: number;

  // For text
  minLength?: number;
  maxLength?: number;
  pattern?: string;                // regex string
}
```

### Response Shape

The client submits values keyed by field id:

```ts
interface UserResponse {
  action: 'submit' | 'cancel';
  input?: Record<string, unknown>; // e.g., { email: "a@b.com", subscribe: true }
}
```

## Validation & Reprompt

Validation is enforced **client‑side and server‑side**. The client should apply basic rules (required, min/max, pattern) unless `validateOnClient: false` is set on a field. The tool’s `onResponse` hook remains the source of truth and must re‑validate.

Optional fields (`required: false`) are allowed to be empty. If a value is provided, it must still validate:
- **select/radio/multiselect**: value(s) must be in `options`
- **text/number/date**: value must satisfy pattern/min/max constraints
- empty string should be treated as “not provided”

When validation fails, tools should return a reprompt with field‑level errors and preserve the user's previous answers using `initialValues`:

```ts
return {
  reprompt: {
    type: 'input',
    presentation: 'questionnaire',
    inputSchema: {
      title: 'Fix the errors',
      fields: [...],
      initialValues: response.input, // preserve user's previous answers
    },
    errorSummary: 'Please correct the highlighted fields.',
    fieldErrors: {
      email: 'Invalid email format',
    },
  },
};
```

Suggested extensions for reprompt:

```ts
interface InteractionRequest {
  // ... existing fields ...
  errorSummary?: string;
  fieldErrors?: Record<string, string>;
}
```

## Rendering Behavior

- Questionnaire blocks render as standalone chat UI (no tool output block)
- Disabled interactive clients render questionnaires read‑only with a hint:
  “Interactive mode disabled — enable to respond”
- Completed questionnaires show submitted values read‑only

## A2UI Inspiration Mapping

| Questionnaire Field | A2UI Component (v0.9 catalog) |
|---------------------|-------------------------------|
| `text`, `textarea`  | `TextField` (`shortText` / `longText`) |
| `number`            | `TextField` (`number`) |
| `boolean`           | `CheckBox` |
| `select` / `radio`  | `ChoicePicker` (`mutuallyExclusive`) |
| `multiselect`       | `ChoicePicker` (`multipleSelection`) |
| `date`/`time`/`datetime` | `DateTimeInput` |
| `submit`            | `Button` |

## Example: Ask User Tool

```ts
handler: async (args, ctx) => {
  return ctx.requestInteraction({
    type: 'input',
    presentation: 'questionnaire',
    inputSchema: {
      title: 'Quick questions',
      description: 'Please answer a few things.',
      fields: [
        { id: 'email', type: 'text', label: 'Email', required: true },
        { id: 'role', type: 'select', label: 'Role', options: [
          { label: 'Developer', value: 'dev' },
          { label: 'Designer', value: 'design' },
        ]},
        { id: 'subscribe', type: 'boolean', label: 'Subscribe to updates?' },
      ],
      submitLabel: 'Send',
    },
    onResponse: (response) => {
      if (response.action === 'cancel') {
        return { complete: { ok: false, cancelled: true } };
      }
      return { complete: { ok: true, answers: response.input } };
    },
  });
};
```

## Files to Update

Likely touchpoints for implementation:

- `packages/shared/src/chatEvents.ts` (questionnaire interaction events piggy-back on interaction_request/response)
- `packages/web-client/src/controllers/chatRenderer.ts` (render questionnaire blocks)
- `packages/web-client/src/utils/toolOutputRenderer.ts` (if shared form components are reused)
- `packages/web-client/src/utils/markdown.ts` (if questionnaire labels/descriptions use markdown)
- `packages/web-client/public/styles.css` (questionnaire block styling)
- `packages/agent-server/src/tools/types.ts` (extend `InteractionRequest` schema for questionnaire fields)
- `packages/agent-server/src/ws/toolCallHandling.ts` (reprompt + initialValues handling)
- `packages/plugins/official/questions` (questions plugin for questionnaire tool)

## Open Questions

1. ✅ Client + server validation enforced. (Client can skip per field with `validateOnClient: false`.)
2. ✅ Support sections for multi‑step questionnaires (`sections` with optional stepper rendering)
3. ✅ No explicit layout hint; renderer decides layout.
