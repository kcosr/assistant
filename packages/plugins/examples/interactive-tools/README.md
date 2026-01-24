# Interactive Tools Plugin (Example)

An example plugin that demonstrates interactive approvals and questionnaires.

## Source files

- `packages/plugins/examples/interactive-tools/manifest.json`
- `packages/plugins/examples/interactive-tools/server/index.ts`

## Configuration

Enable in `config.json`:

```json
{
  "plugins": {
    "interactive-tools": { "enabled": true }
  }
}
```

## Tools

| Tool                             | Description                                   |
| -------------------------------- | --------------------------------------------- |
| `interactive_tools_approval_request` | Request an approval prompt from the user. |
| `interactive_tools_questionnaire_request` | Request a sample questionnaire.       |

## Notes

- These tools rely on interactive client support.
- If no interactive client is available, they return an `interaction_unavailable` error.
