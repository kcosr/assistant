# @assistant/assistant-cli

This package now exists to support generated plugin CLIs. The legacy `assistant-cli`
binary and its command groups have been removed.

Use the plugin-specific CLIs generated under `dist/skills/<pluginId>/` instead.
For example:

```
./notes-cli --help
./notes-cli list
```

## Session scoping

Plugin CLIs accept `--session-id` (or `-s`) for session-scoped operations.
If the flag is omitted, the CLI will fall back to the `ASSISTANT_SESSION_ID`
environment variable.
