# Questions Plugin

The questions plugin asks users to fill out structured questionnaires using the interactive
questionnaire UI in chat. It exposes a single tool (`questions_ask`) that accepts a questionnaire
schema (fields or sections), renders the form, and returns the submitted answers.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Operation (HTTP)](#operation-http)
- [Tool](#tool)
- [Notes](#notes)

## Configuration

Enable the plugin in `config.json`:

```json
{
  "plugins": {
    "questions": { "enabled": true }
  }
}
```

## Source files

- `packages/plugins/official/questions/manifest.json`
- `packages/plugins/official/questions/server/index.ts`

## Operation (HTTP)

- `POST /api/plugins/questions/operations/ask`

## Tool

- `questions_ask`: Ask the user a questionnaire and return answers.
  - Args: `schema` (object, required), `prompt` (string, optional), `timeoutMs` (number, optional),
    `completedView` (object, optional), `validate` (boolean, optional).

## Notes

- `schema.fields` and `schema.sections` map to the questionnaire schema documented in
  `docs/design/questionnaire-tool.md`.
- When `validate` is `true` (default), the plugin validates the response against the schema and
  reprompts with `fieldErrors` and `initialValues` when needed.
