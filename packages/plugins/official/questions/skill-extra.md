Use this tool to ask structured questions via the interactive questionnaire UI.

Quick rules
- Provide either `schema.fields` (flat form) or `schema.sections` (grouped form with `sections[].fields`).
- Supported field types: text, textarea, number, boolean, select, multiselect, checkbox, radio, date, time, datetime.
- Option-backed fields (select, radio, multiselect) require `options` with `{ label, value }`.
- Field ids must be unique across the schema.
- Validation runs by default (`validate: true`): required, min/max, minLength/maxLength, pattern, and option membership.
- On validation errors the tool reprompts with `fieldErrors` and preserves prior input via `initialValues`.
- Set `validate: false` to handle validation in your own tool logic.
- `schema.initialValues` is the only supported way to prefill fields; per-field `initialValue` is ignored.

Response shape
- `answers` map field ids to values:
  - text/textarea/date/time/datetime -> string
  - number -> number|null
  - select/radio -> string
  - multiselect -> string[]
  - checkbox/boolean -> boolean

Pre-populating fields (initialValues)
Use `schema.initialValues` to pre-fill form fields. This is a map of field ids to initial values.

```
{
  "prompt": "Edit your profile.",
  "schema": {
    "title": "Edit profile",
    "initialValues": {
      "name": "Kevin Smith",
      "age": 35,
      "theme": "dark",
      "languages": ["ts", "rust"],
      "subscribe": true
    },
    "fields": [
      { "id": "name", "type": "text", "label": "Name" },
      { "id": "age", "type": "number", "label": "Age" },
      {
        "id": "theme",
        "type": "select",
        "label": "Theme",
        "options": [
          { "label": "Light", "value": "light" },
          { "label": "Dark", "value": "dark" }
        ]
      },
      {
        "id": "languages",
        "type": "multiselect",
        "label": "Languages",
        "options": [
          { "label": "TypeScript", "value": "ts" },
          { "label": "Rust", "value": "rust" }
        ]
      },
      { "id": "subscribe", "type": "boolean", "label": "Subscribe?" }
    ]
  }
}
```

Value types should match the field type:
- text/textarea/date/time/datetime -> string
- number -> number
- select/radio -> string (matching an option value)
- multiselect -> string[] (matching option values)
- checkbox/boolean -> boolean

Example: flat fields
```
{
  "prompt": "Please answer a few questions.",
  "schema": {
    "title": "Project intake",
    "description": "Tell us a bit about the work.",
    "fields": [
      { "id": "title", "type": "text", "label": "Title", "required": true },
      { "id": "budget", "type": "number", "label": "Budget", "min": 0 },
      { "id": "start", "type": "date", "label": "Start date" },
      {
        "id": "priority",
        "type": "select",
        "label": "Priority",
        "options": [
          { "label": "High", "value": "high" },
          { "label": "Medium", "value": "medium" },
          { "label": "Low", "value": "low" }
        ]
      },
      {
        "id": "channels",
        "type": "multiselect",
        "label": "Preferred channels",
        "options": [
          { "label": "Email", "value": "email" },
          { "label": "Slack", "value": "slack" },
          { "label": "SMS", "value": "sms" }
        ]
      },
      { "id": "subscribe", "type": "boolean", "label": "Subscribe to updates?" }
    ],
    "submitLabel": "Send",
    "cancelLabel": "Cancel"
  }
}
```

Example: sectioned form
```
{
  "schema": {
    "title": "Team info",
    "sections": [
      {
        "id": "basics",
        "title": "Basics",
        "fields": [
          { "id": "name", "type": "text", "label": "Name", "required": true },
          { "id": "role", "type": "text", "label": "Role" }
        ]
      },
      {
        "id": "availability",
        "title": "Availability",
        "optional": true,
        "fields": [
          { "id": "timezone", "type": "text", "label": "Time zone" },
          { "id": "hours", "type": "number", "label": "Hours/week", "min": 0 }
        ]
      }
    ]
  }
}
```

Optional behavior
- `timeoutMs` sets a client timeout for the prompt.
- `completedView` can hide inputs or define a summary template in the completed view.
- `validateOnClient: false` on a field disables client-side HTML validation for that field.
