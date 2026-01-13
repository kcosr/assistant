# @assistant/web-client

Browser-based chat client for the AI Assistant.

## Table of Contents

- [Features](#features)
- [Building](#building)
- [Web-Specific Implementation](#web-specific-implementation)
- [Protocol Messages (v2)](#protocol-messages-v2)
- [Browser APIs Used](#browser-apis-used)
- [Files](#files)

## Features

- Text input with streaming response display
- Voice input via Web Speech API (browser speech recognition)
- Audio output via server-generated TTS
- Session management (create, switch, delete)
- Auto-reconnect on connection loss
- Theme + font preferences (local storage)

See [Common UI Specification](../../docs/UI_SPEC.md) for cross-platform UI behavior requirements.

## Building

```bash
npm run build
```

This compiles TypeScript and bundles to `public/client.js`.

## Web-Specific Implementation

### Layout

The web client uses CSS flexbox for layout:

- `body` uses `height: 100dvh` with `overflow: hidden`
- `.chat-container` is a flex column
- `#chat-log` has `flex: 1 1 auto` to fill available space and `overflow-y: auto` for scrolling
- `#input-form` stays at bottom naturally due to flex layout

### Sticky Input Bar

The input bar stays at bottom due to:

1. Container is a flex column with `height: 100dvh`
2. Chat log takes flexible space with `flex: 1`
3. Input form is last child, naturally positioned at bottom
4. Mobile safe area handled with `padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px))`

### Auto-Scroll

Implemented via `scrollTop` manipulation:

```javascript
// Scroll to bottom on new messages
chatLogEl.scrollTop = chatLogEl.scrollHeight;

// Scroll specific element into view
container.scrollTop = element.offsetTop;
```

Auto-scroll triggers on:

- User sends a message
- First assistant response delta received
- Response streaming updates
- Response complete

### Controls Toggle

- Controls are collapsed by default on all platforms
- Toggle button shows `▲`/`▼`
- CSS class `.controls-collapsed` hides child elements

## Protocol Messages (v2)

The web client uses protocol v2 with **multiplexed connections** - a single WebSocket can subscribe to multiple sessions.

### Connection Model

```
Browser ────── WebSocket ────── Server
                  │
                  ├── Session A (subscribed)
                  ├── Session B (subscribed)
                  └── Session C (not subscribed)
```

- **Subscribed sessions**: Receive all messages (text_delta, tool calls, etc.)
- **Input binding**: Client chooses which session receives text input
- **Session switching**: No reconnect needed, just select a different input session

### Client → Server

| Message       | Purpose                                     |
| ------------- | ------------------------------------------- |
| `hello`       | Initial handshake with subscriptions        |
| `subscribe`   | Subscribe to a session's messages           |
| `unsubscribe` | Stop receiving messages from a session      |
| `text_input`  | Send user text message (sessionId required) |
| `set_modes`   | Update output mode (text/both)              |
| `control`     | Cancel output, with optional audioEndMs     |
| `ping`        | Keep-alive                                  |

### Server → Client

All session-specific messages include `sessionId` field.

| Message             | Purpose                                |
| ------------------- | -------------------------------------- |
| `session_ready`     | Session ready for this connection      |
| `subscribed`        | Subscription confirmed                 |
| `unsubscribed`      | Unsubscription confirmed               |
| `session_created`   | New session created (broadcast to all) |
| `session_deleted`   | Session deleted (broadcast to all)     |
| `session_updated`   | Session timestamp updated              |
| `thinking_start`    | Assistant thinking started             |
| `thinking_delta`    | Streaming thinking chunk               |
| `thinking_done`     | Complete thinking content              |
| `text_delta`        | Streaming text chunk                   |
| `text_done`         | Complete response text                 |
| `tool_call_start`   | Tool call started                      |
| `tool_output_delta` | Tool output streaming                  |
| `tool_result`       | Tool call complete                     |
| `modes_updated`     | Acknowledge mode change                |
| `error`             | Error with code and message            |
| `output_cancelled`  | Confirm output cancellation            |
| `pong`              | Response to ping                       |

### Sidebar Activity Indicators

The client subscribes to all visible sessions in the sidebar. When messages arrive for non-focused sessions, activity indicators are shown.

### Binary Frames

Audio frames are sent as binary WebSocket messages with custom framing:

- Magic bytes for identification
- Flags (TTS flag = 0x02)
- Sequence number
- Timestamp
- Sample rate, channels, format
- PCM16 audio data

When available, the client plays TTS audio through an AudioWorklet ring buffer to reduce scheduling jitter on long responses.

## Browser APIs Used

| API            | Purpose                          |
| -------------- | -------------------------------- |
| WebSocket      | Server communication             |
| Web Speech API | Speech recognition (voice input) |
| AudioContext   | TTS audio playback               |
| AudioWorklet   | Ring-buffered TTS playback       |
| Fetch          | Session HTTP APIs                |

## Files

| File                 | Purpose                                     |
| -------------------- | ------------------------------------------- |
| `src/index.ts`       | Main client logic, UI handling              |
| `src/audio.ts`       | TtsAudioPlayer for audio output             |
| `src/speechInput.ts` | Web Speech API wrapper                      |
| `src/markdown.ts`    | Markdown rendering with syntax highlighting |
| `public/index.html`  | HTML + CSS                                  |
| `public/client.js`   | Bundled output                              |

## Key Controllers

The panel system is implemented through a set of controllers in `src/controllers/`:

| Controller                   | Purpose                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `panelWorkspaceController`   | Manages the split/tab panel layout and panel lifecycle     |
| `panelHostController`        | Provides host APIs to panel modules (context, events, etc) |
| `panelRegistry`              | Registers panel types and creates panel instances          |
| `panelLauncherController`    | Panel picker UI with search and keyboard navigation        |
| `chatRenderer`               | Renders chat messages from event stream                    |
| `messageRenderer`            | Legacy message rendering (being replaced by chatRenderer)  |
| `keyboardNavigationController` | Global keyboard shortcuts and panel focus management     |
| `dialogManager`              | Modal dialog lifecycle and stacking                        |
| `connectionManager`          | WebSocket connection and reconnection logic                |
| `sessionManager`             | Session state and subscription management                  |

### Collection Controllers

Shared controllers for list-style panels (lists, notes):

| Controller                      | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `collectionBrowserController`   | Renders item list with tags and preview         |
| `collectionDropdown`            | Collection selector dropdown                    |
| `collectionPanelSearchController` | Search input and tag filter management        |
| `collectionTagFilterController` | Tag filter pill rendering and state             |

### List Panel Controllers

| Controller                | Purpose                                         |
| ------------------------- | ----------------------------------------------- |
| `listPanelController`     | Main list panel orchestration                   |
| `listPanelTableController`| Table rendering with columns and selection      |
| `listItemEditorDialog`    | Item create/edit dialog                         |
| `listMetadataDialog`      | List settings and custom fields dialog          |
