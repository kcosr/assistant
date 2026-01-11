# Hello Plugin (Example)

A minimal example plugin demonstrating the panel plugin architecture.

## Table of Contents

- [Purpose](#purpose)
- [Source files](#source-files)
- [Usage](#usage)
- [Panel](#panel)

## Purpose

This plugin serves as a starting point for building new panel plugins. It shows:

- How to structure a panel-only plugin
- How to define a manifest with panel declarations
- How to register a panel via the global registry
- How to implement the panel mount/unmount lifecycle

## Source files

- `packages/plugins/examples/hello/manifest.json`
- `packages/plugins/examples/hello/web/index.ts`
- `packages/plugins/examples/hello/web/styles.css`

## Usage

Enable in `config.json`:

```json
{
  "plugins": {
    "hello": { "enabled": true }
  }
}
```

Build with:

```bash
npm run build:plugins
```

The panel will appear in the panel launcher.

## Panel

### Type

`hello`

### Features

- Simple "Hello from a plugin panel!" message
- Demonstrates session change callbacks
- Shows basic DOM manipulation in a panel

### Code Example

See `packages/plugins/examples/hello/web/index.ts` for the full implementation:

```typescript
window.ASSISTANT_PANEL_REGISTRY.registerPanel('hello', () => ({
  mount(container, host, init) {
    const body = document.createElement('div');
    body.className = 'panel-body';
    body.textContent = 'Hello from a plugin panel!';
    container.appendChild(body);

    return {
      onSessionChange(sessionId) {
        body.dataset['sessionId'] = sessionId ?? '';
      },
      unmount() {
        container.innerHTML = '';
      },
    };
  },
}));
```
