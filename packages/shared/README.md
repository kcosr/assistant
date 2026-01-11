# @assistant/shared

Shared types, protocol definitions, and utilities used by both the agent server and web client.

## Table of Contents

- [Building](#building)
- [Source files](#source-files)
- [Contents](#contents)
- [Modes](#modes)
- [Protocol Version](#protocol-version)

## Building

```bash
npm run build
```

## Source files

- `src/protocol.ts`
- `src/panelProtocol.ts`
- `src/audio.ts`

## Contents

### Protocol Types (`protocol.ts`)

Client and server message types with Zod validation:

```typescript
// Client messages
type ClientMessage =
  | ClientHelloMessage // Initial handshake
  | ClientTextInputMessage // User text
  | ClientSetModesMessage // Mode configuration
  | ClientControlMessage // Cancel output, etc.
  | ClientPingMessage // Keep-alive
  | ClientPanelEventMessage // Panel-scoped events
  | ClientSubscribeMessage // Subscribe to a session
  | ClientUnsubscribeMessage // Unsubscribe from a session
  | ClientSetSessionModelMessage; // Set selected model for a session (sessionId required)

// Server messages
type ServerMessage =
  | ServerSessionReadyMessage // Session ready
  | ServerSessionClearedMessage // Session history cleared
  | ServerSessionCreatedMessage // Session created (broadcast to all)
  | ServerSessionDeletedMessage // Session deleted (broadcast to all)
  | ServerSessionUpdatedMessage // Session timestamp updated (broadcast to all)
  | ServerTextDeltaMessage // Streaming text chunk
  | ServerTextDoneMessage // Complete response
  | ServerThinkingStartMessage // Thinking content started
  | ServerThinkingDeltaMessage // Streaming thinking chunk
  | ServerThinkingDoneMessage // Complete thinking content
  | ServerUserMessageMessage // User message echo
  | ServerTranscriptDeltaMessage // Transcription chunk
  | ServerTranscriptDoneMessage // Complete transcription
  | ServerToolCallMessage // Tool invocation
  | ServerToolCallStartMessage // Tool call started
  | ServerToolOutputDeltaMessage // Streaming tool output chunk
  | ServerToolResultMessage // Tool result
  | ServerChatEventMessage // Chat event
  | ServerAgentCallbackResultMessage // Agent callback result
  | ServerModesUpdatedMessage // Mode change ack
  | ServerPongMessage // Ping response
  | ServerErrorMessage // Error
  | ServerMessageQueuedMessage // Message queued
  | ServerMessageDequeuedMessage // Message dequeued
  | ServerOutputCancelledMessage // Cancel confirmed
  | ServerOpenUrlMessage // Open URL request
  | ServerPanelEventMessage // Panel-scoped event
  | ServerSubscribedMessage // Subscription acknowledged
  | ServerUnsubscribedMessage; // Unsubscribe acknowledged
```

Panel-scoped events carry plugin-specific payloads (for example, `panel_update` for the lists panel).
over the `panel_event` envelope:

```json
{
  "type": "panel_event",
  "panelId": "terminal-1",
  "panelType": "terminal",
  "sessionId": "session-123",
  "payload": { "type": "terminal_output", "text": "ready" }
}
```

Routing notes:

- If `sessionId` is present, clients deliver the event to panels bound to that session.
- If `sessionId` is omitted, the event targets unbound/global panels.
- Use `sessionId: "*"` to broadcast to all panels of the given `panelType` regardless of binding.

Core does not interpret panel payloads, but reserves a few lifecycle payload types for plugin handlers:
`panel_lifecycle`, `panel_binding`, and `panel_session_changed`.

### Panel Protocol Types (`panelProtocol.ts`)

Shared panel layout and plugin manifest types:

```typescript
type LayoutNode =
  | { kind: 'split'; splitId: string; direction: 'horizontal' | 'vertical'; sizes: number[]; children: LayoutNode[]; viewMode?: 'split' | 'tabs'; activeId?: string }
  | { kind: 'panel'; panelId: string };
// split nodes can include viewMode: 'split' | 'tabs' and activeId for tab view.
interface LayoutPersistence { layout: LayoutNode; panels: Record<string, PanelInstance>; }
interface PanelInstance { panelId: string; panelType: string; binding?: PanelBinding; }
interface CombinedPluginManifest { id: string; version: string; panels?: PanelTypeManifest[]; ... }
```

### Audio Frame Types (`audio.ts`)

Binary audio frame encoding/decoding:

```typescript
interface AudioFrame {
  magic: number; // AUDIO_FRAME_MAGIC (0x4155)
  flags: number; // AUDIO_FLAG_MIC (0x01) or AUDIO_FLAG_TTS (0x02)
  seq: number; // Sequence number
  timestampMs: number; // Timestamp in milliseconds
  sampleRate: number; // Sample rate (e.g., 24000)
  channels: number; // Number of channels (1)
  sampleFormat: number; // Format (1 = PCM16)
  data: Uint8Array; // PCM audio data
}
```

Functions:

- `encodeAudioFrame(frame)` → `Uint8Array`
- `decodeAudioFrame(bytes)` → `AudioFrame`

### Validation

```typescript
// Validate with exceptions
validateClientMessage(data); // throws ZodError
validateServerMessage(data);

// Safe validation
safeValidateClientMessage(data); // returns { success, data?, error? }
safeValidateServerMessage(data);
```

## Modes

```typescript
type InputMode = 'text' | 'speech' | 'both';
type OutputMode = 'text' | 'speech' | 'both';
```

Note: Currently only `outputMode` affects behavior. When `'both'` or `'speech'`, the server generates TTS audio.

## Protocol Version

```typescript
const CURRENT_PROTOCOL_VERSION = 2;
```

Clients should send this in the `hello` message. Servers reject unsupported versions.
