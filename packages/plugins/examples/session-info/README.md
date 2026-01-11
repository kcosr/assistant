# Session Info Plugin (Example)

An example plugin demonstrating session-scoped data storage and panel-server communication.

## Table of Contents

- [Purpose](#purpose)
- [Source files](#source-files)
- [Configuration](#configuration)
- [Operations](#operations)
- [Tools](#tools)
- [Panel](#panel)

## Purpose

This plugin demonstrates:

- How to create a plugin with both server operations and a panel
- How to store session-scoped data in session attributes
- How to use panel events for real-time updates
- How to expose tools that agents can use

## Source files

- `packages/plugins/examples/session-info/manifest.json`
- `packages/plugins/examples/session-info/server/index.ts`
- `packages/plugins/examples/session-info/web/index.ts`
- `packages/plugins/examples/session-info/skill-extra.md`

## Configuration

Enable in `config.json`:

```json
{
  "plugins": {
    "session-info": { "enabled": true }
  }
}
```

## Operations

### `session_info_label_get`

Read the current session label.

**HTTP:** `POST /api/plugins/session-info/operations/label_get`

**Response:**

```json
{
  "ok": true,
  "result": {
    "label": "Current label text"
  }
}
```

### `session_info_label_set`

Set a session-scoped label for the Session Info panel.

**Parameters:**

- `text` (string, required): Label text to display. Use empty string to clear.

**HTTP:** `POST /api/plugins/session-info/operations/label_set`

**Request:**

```json
{
  "text": "New label text"
}
```

## Tools

| Tool                     | Description                           |
| ------------------------ | ------------------------------------- |
| `session_info_label_get` | Read the current session label        |
| `session_info_label_set` | Set the Session Info panel label      |

## Panel

### Type

`session-info`

### Features

- Shows the bound session ID
- Displays session attributes (workingDir, activeBranch, etc.)
- Shows a custom label that agents can set via tools
- Real-time updates when attributes change

### Properties

| Property                | Value       | Description                           |
| ----------------------- | ----------- | ------------------------------------- |
| `multiInstance`         | `true`      | Multiple panels can be opened         |
| `defaultSessionBinding` | `"fixed"`   | Bound to a session by default         |
| `sessionScope`          | `"optional"` | Session binding is optional           |
