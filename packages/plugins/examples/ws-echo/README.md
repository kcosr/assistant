# WS Echo Plugin

Sample WebSocket echo panel for validating panel events.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Panel](#panel)

## Configuration

```jsonc
{
  "plugins": {
    "ws-echo": { "enabled": true },
  },
}
```

## Source files

- `packages/plugins/examples/ws-echo/manifest.json`
- `packages/plugins/examples/ws-echo/server/index.ts`
- `packages/plugins/examples/ws-echo/web/index.ts`

## Panel

- Panel type: `ws-echo` (multi-instance, global scope).
- Sends `ws_echo_input` events over the panel WebSocket and echoes text back.
