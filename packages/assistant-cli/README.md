# @assistant/assistant-cli

This package now exists to support generated plugin CLIs. The legacy `assistant-cli`
binary and its command groups have been removed.

Use the plugin-specific CLIs generated under `dist/skills/<pluginId>/` instead.
For example:

```
./notes-cli --help
./notes-cli list
```
