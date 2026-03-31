# Mobile Voice Filtered Session Subscriptions

## Summary

This document describes the next-stage design for Android native voice session observation.

The current native voice runtime subscribes to one Assistant session at a time and receives the
full websocket event stream for that session. That is workable for the initial single-session
voice flow, but it does not scale cleanly to:

- multi-session background voice observation
- notification-driven manual speech targeting
- reduced websocket noise for native voice clients
- a future where native voice is watching many sessions but only cares about a small subset of
  events

The proposed end-state is:

- move the Assistant websocket protocol to a new structured subscription model
- let subscriptions carry an optional generic event mask
- make the native Android runtime subscribe to many sessions at once with a narrow mask
- introduce a persisted `preferredVoiceSessionId` that the notification `Speak` action uses when
  starting a new manual speech turn
- keep `Stop` notification behavior global to the currently active native interaction

This is an intentional protocol and client contract change. We do not preserve the old unstructured
subscription flow.

## Why This Follow-Up Exists

Today the codebase has these constraints:

- protocol subscriptions are session-only:
  - `hello.subscriptions` is `string[]`
  - `subscribe` / `unsubscribe` carry only `sessionId`
- server subscription state is session membership only
- the Android native voice runtime tracks only one subscribed Assistant session at a time
- native voice filters prompt events client-side after receiving the full stream for that session

This creates three concrete problems:

1. native Android receives far more websocket traffic than it actually needs
2. multi-session background voice support would multiply that noise
3. notification-initiated manual speech still needs a stable target session even when the user is
   not actively viewing a chat

## Goals

- Reduce native Android websocket traffic by filtering at the Assistant server subscription layer.
- Support one connection subscribing to many sessions at once with a consistent generic mask model.
- Keep the filtering model generic rather than voice-specific.
- Allow native Android voice to observe all relevant sessions while still routing each active voice
  interaction to the correct session.
- Introduce a persisted session target for notification `Speak` without inventing a generic global
  assistant-wide default session concept.
- Keep the end-state implementation simple:
  - one effective subscription per session per connection
  - replace semantics on repeated subscribe
  - session-wide unsubscribe

## Non-Goals

- Preserve protocol v1 or v2 websocket subscription compatibility.
- Introduce subscription ids, per-mask unsubscribe, or merged masks in the first pass.
- Add a generic global default session concept unrelated to voice.
- Queue skipped prompts from multiple sessions for later background playback.
- Build a full native session browser UI in this phase.

## Current Code Shape

Current protocol and runtime behavior:

- shared protocol uses:
  - `hello.subscriptions: string[]`
  - `subscribe.sessionId`
  - `unsubscribe.sessionId`
- `MultiplexedConnection` stores subscriptions as `Set<string>`
- `SessionConnectionRegistry` stores per-connection session membership only
- Android native voice currently:
  - builds hello and subscribe messages with a single session id
  - tracks one `assistantSubscribedSessionId`
  - parses all incoming `chat_event` messages and filters client-side

This means multi-session support is partially present at the web/server connection level, but only
as plain session ids with no filtering. Android voice still uses a single-session runtime model.

## Design Decisions

### 1. Protocol Version

Move to `protocolVersion: 3`.

We do not preserve the old unstructured subscription flow for first-party clients. All Assistant
clients in this repo should move together to the structured subscription model.

### 2. Subscription Object

A subscription is identified by:

- `sessionId`
- optional `mask`

Proposed conceptual shape:

```json
{
  "sessionId": "session-a",
  "mask": {
    "serverMessageTypes": ["chat_event", "output_cancelled"],
    "chatEventTypes": ["tool_call", "tool_result", "assistant_done", "interrupt", "turn_start", "turn_end"],
    "toolNames": ["voice_speak", "voice_ask"],
    "messagePhases": ["final_answer"]
  }
}
```

### 3. Mask Semantics

Mask fields should remain generic and map directly onto existing Assistant protocol/event concepts.

Proposed fields:

- `serverMessageTypes`
  - top-level websocket server message `type`
  - examples: `chat_event`, `output_cancelled`
- `chatEventTypes`
  - existing chat event types from `packages/shared/src/chatEvents.ts`
  - examples: `tool_call`, `tool_result`, `assistant_done`, `interrupt`
- `toolNames`
  - applies to tool-related chat events
  - should match both `tool_call` and `tool_result`
- `messagePhases`
  - filters assistant text events by existing phase values
  - use current values:
    - `commentary`
    - `final_answer`

Semantics:

- all provided mask fields are ANDed together
- omitted mask field means "all"
- empty arrays are invalid and should be rejected
- a missing `mask` means "all events for the session"

For this design, `messagePhases` applies to chat-event assistant text payloads only:

- `assistant_chunk`
- `assistant_done`

It does not apply to unrelated top-level websocket message types.

### 4. Hello / Subscribe / Unsubscribe

#### `hello`

`hello.subscriptions` becomes structured.

Example:

```json
{
  "type": "hello",
  "protocolVersion": 3,
  "subscriptions": [
    {
      "sessionId": "session-a",
      "mask": {
        "serverMessageTypes": ["chat_event", "output_cancelled"],
        "chatEventTypes": ["tool_call", "tool_result"],
        "toolNames": ["voice_speak", "voice_ask"]
      }
    }
  ]
}
```

`hello.sessionId` should be removed from the protocol shape in this version. The structured
subscription list is the single source of truth.

#### `subscribe`

For consistency with current usage, keep `sessionId` top-level and add optional `mask`.

```json
{
  "type": "subscribe",
  "sessionId": "session-a",
  "mask": {
    "serverMessageTypes": ["chat_event", "output_cancelled"],
    "chatEventTypes": ["tool_call", "tool_result"],
    "toolNames": ["voice_speak", "voice_ask"]
  }
}
```

Repeated subscribe behavior:

- last subscribe replaces the prior effective mask for that session on that connection

#### `unsubscribe`

Remain session-wide:

```json
{
  "type": "unsubscribe",
  "sessionId": "session-a"
}
```

No mask-specific unsubscribe is needed in the first pass.

### 5. Subscription Acknowledgements

`subscribed` should echo the effective mask for debugging and observability.

Proposed shape:

```json
{
  "type": "subscribed",
  "sessionId": "session-a",
  "mask": {
    "serverMessageTypes": ["chat_event"],
    "chatEventTypes": ["tool_call"],
    "toolNames": ["voice_speak", "voice_ask"]
  }
}
```

`unsubscribed` can remain session-only.

When `hello.subscriptions` contains multiple entries, the server should emit one `subscribed`
message per accepted subscription, matching the current per-session acknowledgement style.

### 6. Server Dispatch Model

Filtering should live in the subscription dispatch layer, not inside every individual broadcaster.

That means changing per-connection subscription state from:

- `Set<string>`

to something like:

- `Map<string, SubscriptionMask | null>`

Dispatch predicate order:

1. is the connection subscribed to the session?
2. does the top-level server message type match?
3. if the message is `chat_event`, does the chat event type match?
4. if it is a tool event, does the tool name match?
5. if it is an assistant text event with a phase, does the phase match?

This logic belongs in the websocket connection/registry layer so all session broadcasts get the
same semantics.

Global non-session-scoped broadcasts are not governed by per-session masks. These continue to flow
outside session subscription filtering. Examples include:

- `session_created`
- `session_deleted`
- `session_updated`

For `output_cancelled`, session-filtered delivery should require a concrete `sessionId`. A
session-less `output_cancelled` does not participate in masked per-session dispatch.

### 7. Native Voice Session Model

Native Android should track three different session concepts.

#### `watchedSessionIds`

The set of sessions native voice is actively subscribed to with the voice-oriented mask.

This is for passive prompt observation.

#### `preferredVoiceSessionId`

A persisted session id used only when the user initiates a new manual speech turn from the
notification `Speak` action.

This is not a generic global default session. It is a voice-runtime preference.

#### `activeVoiceSessionId`

The session currently owning the live native interaction.

Examples:

- active prompt playback from `voice_ask`
- active response-mode playback
- active recognition that will submit back to a session

### 8. Notification Behavior

#### `Speak`

When the notification `Speak` action starts a new manual listen turn:

- target `preferredVoiceSessionId`
- do not depend on the currently visible session
- if there is no preferred voice session, hide `Speak`

#### `Stop`

`Stop` should continue to apply to whichever native interaction is currently active, regardless of
which session owns it.

This includes:

- prompt playback
- response playback
- recognition

If the active interaction is a speak-then-listen flow such as `voice_ask` or response playback with
`Auto-listen`, `Stop` should continue to honor the existing two-phase stop behavior.

### 9. Prompt Autoplay Across Many Sessions

For multi-session observation, autoplay should remain intentionally simple:

- if native is idle and a newly observed eligible prompt arrives, native may start it
- once a prompt starts, `activeVoiceSessionId` becomes that prompt's session
- if another eligible prompt arrives while native is already speaking or listening:
  - do not interrupt
  - do not queue for later autoplay
  - leave it visible in transcript replay only

This preserves the current "no backlog queue" design even when many sessions are being watched.

### 10. Session Discovery Ownership

Native Android should own watched-session discovery for background voice.

Recommended first pass:

- native calls the existing sessions list API on startup and reconnect
- native derives `watchedSessionIds` from that response
- native persists the latest watched set locally
- native subscribes to all watched sessions with the configured voice mask

Initial source:

- `GET /api/plugins/sessions/operations/list`

This should be treated as a hard dependency for the Android runtime phase.

This avoids making background voice correctness depend on a foreground WebView being open.

The web client still owns:

- `preferredVoiceSessionId`
- normal voice settings UI
- syncing those settings into native

### 11. Preferred Voice Session Ownership

The web client should remain the source of truth for `preferredVoiceSessionId`.

The value should:

- be stored in client preferences
- be synced into native config
- remain set until:
  - the user explicitly chooses a different session
  - the chosen session is deleted

If native detects that the preferred session no longer exists, it should clear the local value and
report the cleared state back to the web layer on the next bridge sync.

Native can detect this through either:

- a global `session_deleted` websocket broadcast, or
- the next sessions-list refresh result

## Proposed Runtime Masks

### Tool Mode prompt observation

```json
{
  "serverMessageTypes": ["chat_event", "output_cancelled"],
  "chatEventTypes": ["tool_call", "tool_result", "interrupt", "turn_start", "turn_end"],
  "toolNames": ["voice_speak", "voice_ask"]
}
```

### Response Mode observation

```json
{
  "serverMessageTypes": ["chat_event", "output_cancelled"],
  "chatEventTypes": ["assistant_done", "interrupt", "turn_start", "turn_end"],
  "messagePhases": ["final_answer"]
}
```

### Combined voice runtime observation

If one runtime instance supports both tool and response modes simultaneously in the future, the
single effective mask for a watched session can include both categories.

## Implementation Plan

## Phase 1: Shared Protocol And Server Filtering

### Shared protocol

Update `packages/shared/src/protocol.ts`:

- set `CURRENT_PROTOCOL_VERSION` to `3`
- add:
  - `SubscriptionMaskSchema`
  - `SessionSubscriptionSchema`
- change `ClientHelloMessageSchema`:
  - remove `sessionId`
  - `subscriptions` becomes `SessionSubscription[]`
- extend `ClientSubscribeMessageSchema` with optional `mask`
- extend `ServerSubscribedMessageSchema` with optional `mask`
- add/update protocol tests in:
  - `packages/shared/src/protocol.test.ts`

### Connection state

Update:

- `packages/agent-server/src/ws/multiplexedConnection.ts`
- `packages/agent-server/src/sessionConnectionRegistry.ts`
- `packages/agent-server/src/sessionHub.ts`

Changes:

- replace per-connection `Set<string>` subscription tracking with a masked per-session structure
- expose:
  - get effective subscription mask for a session
  - replace subscription for a session
  - session-wide unsubscribe
- keep `SessionHub` helpers thin; filtering logic belongs in registry/connection dispatch

### Hello and subscribe handling

Update:

- `packages/agent-server/src/ws/helloHandling.ts`
- `packages/agent-server/src/ws/clientMessageDispatch.ts`
- `packages/agent-server/src/ws/sessionRuntime.ts`

Changes:

- require protocol version `3`
- reject older protocol versions instead of silently accepting legacy subscription shapes
- initialise masked subscriptions from `hello.subscriptions`
- `subscribe` replaces prior mask for that session
- `subscribed` echoes the effective mask
- reject invalid empty session ids and invalid empty-array masks

### Dispatch filtering

Add a shared helper for mask matching and use it in:

- `packages/agent-server/src/sessionConnectionRegistry.ts`

The helper should evaluate:

- top-level server message type
- chat event type
- tool name
- assistant text phase

### Phase 1 tests

Add or update tests for:

- legacy-free protocol v3 hello validation
- masked `hello` initial subscriptions
- masked `subscribe` replace semantics
- unmasked subscribe still means all events for that session
- non-matching top-level message types are dropped
- non-matching tool names are dropped
- phase filtering for `assistant_done`
- one connection subscribed to multiple sessions with different masks

Likely files:

- `packages/shared/src/protocol.test.ts`
- `packages/agent-server/src/ws/helloHandling.test.ts`
- `packages/agent-server/src/sessionConnectionRegistry.test.ts`
- `packages/agent-server/src/subscriptionSessionHub.test.ts`
- `packages/agent-server/src/ws/subscriptionRuntime.test.ts`

## Phase 2: Native Android Multi-Session Voice Runtime

### Native protocol helper

Update:

- `packages/mobile-web/android/app/src/main/java/com/assistant/mobile/voice/AssistantVoiceSessionSocketProtocol.java`

Changes:

- build v3 `hello` with structured subscriptions
- build masked `subscribe`
- parse `subscribed` acknowledgements with echoed mask if present
- remove assumptions that only one session can be subscribed

### Native config model

Update:

- `AssistantVoiceConfig`
- `AssistantVoicePlugin`

Add:

- `preferredVoiceSessionId`
- `watchedSessionIds`

Keep:

- `activeVoiceSessionId` as explicit runtime state rather than only implicit prompt ownership

### Native session discovery

Update:

- `AssistantVoiceRuntimeService`

Add:

- fetch sessions list from Assistant on startup/reconnect
- derive watched sessions
- diff previous vs next watched sessions
- subscribe new sessions
- unsubscribe removed sessions

### Native event handling

Update:

- `AssistantVoiceRuntimeService`
- `AssistantVoiceEventParser`
- `AssistantVoiceInteractionRules`

Changes:

- accept prompt events from any watched session
- when playback/listening starts, bind `activeVoiceSessionId`
- submit recognition results to `activeVoiceSessionId`
- keep current no-backlog behavior for prompts arriving while busy

### Notification behavior

Update:

- `AssistantVoiceRuntimeService`
- related notification action strings/resources

Changes:

- `Speak` starts manual listen against `preferredVoiceSessionId`
- hide `Speak` when there is no preferred session
- `Stop` continues to stop whichever interaction is active

### Why `turn_start` / `turn_end` stay in the masks

These events are not part of playback payload selection. They are included so native can keep a
correct per-session busy/idle model and avoid stale active-turn assumptions while watching many
sessions.

### Phase 2 tests

Add/update Android unit tests for:

- structured hello generation
- subscribe/unsubscribe generation
- watched session diff application
- notification `Speak` visibility with and without preferred session
- manual listen targets preferred session
- recognition submit uses `activeVoiceSessionId`
- active interaction blocks autoplay from other watched sessions
- reconnect restores watched sessions and re-sends masked subscriptions
- preferred voice session missing at startup clears notification `Speak`

## Phase 3: Web Client Preference And UX Wiring

The web client must also move to websocket protocol v3 as part of the same overall rollout. That
protocol work belongs with the shared/server phase, even though the preferred-session UX work lives
here.

### Voice settings model

Update:

- `packages/web-client/src/utils/voiceSettings.ts`
- `packages/web-client/src/utils/clientPreferences.ts`
- `packages/web-client/src/index.ts`

Add:

- `preferredVoiceSessionId`

The web client should persist this as part of the existing voice settings model.

### Native bridge contract

Update:

- `speechAudioController.ts`
- related web/native bridge code

Change `setVoiceSettings` payload to include:

- `preferredVoiceSessionId`

The web layer does not need to push `watchedSessionIds` if native owns session discovery.

### UX entry point for choosing preferred session

Add an explicit session-level action, such as:

- "Use for voice notification"

This action should:

- set `preferredVoiceSessionId`
- persist it
- sync it into native

If the preferred session is deleted:

- clear the preference
- hide notification `Speak` until a new preferred session is chosen

### Phase 3 tests

Add/update tests for:

- client preference persistence of `preferredVoiceSessionId`
- bridge sync of the updated voice settings payload
- clearing the preferred voice session when the session is deleted

## Phase 4: End-To-End Validation

Validate at least:

- Android runtime receives only masked event traffic for watched sessions
- `voice_speak` and `voice_ask` still autoplay correctly from watched sessions
- response-mode final assistant playback still works with masked subscriptions
- notification `Speak` starts recognition for the preferred session while no chat is open
- notification `Stop` stops the active interaction regardless of owning session
- recognition submission returns to the correct session after background initiation
- reconnect restores watched masked subscriptions cleanly

## Open Questions Resolved For First Pass

### Replace or merge?

Replace.

Repeated subscribe for the same session replaces the old mask.

### Specific-mask unsubscribe?

No.

`unsubscribe` remains session-wide.

### Wildcards?

Omitted field means all.

Empty arrays are invalid.

### Does `toolNames` apply to `tool_result` too?

Yes.

The filter should apply to all tool-related chat events.

### Do final assistant messages need a separate top-level concept?

No.

Use existing `chat_event` + `assistant_done` + `messagePhases`.

## Recommended Delivery Order

1. shared protocol v3, server-side masked dispatch, and first-party client protocol updates
2. Android runtime multi-session support and preferred voice session routing
3. web preference and explicit preferred-session UX
4. end-to-end validation with notification-driven manual speech and multi-session prompt replay

## Notes On Scope

This plan intentionally treats the filtered-subscription protocol change and the preferred voice
session model as one combined design. They solve related problems:

- filtered subscriptions make multi-session native voice efficient enough to be practical
- multi-session native voice makes a notification-driven manual `Speak` action useful
- a preferred voice session gives that notification action a stable target without inventing a
  generic assistant-wide default session

## Rollout Constraint

Because this design intentionally drops the legacy subscription protocol, the shared protocol
change, server change, web client protocol update, and Android native protocol update should be
landed as one coordinated first-party rollout rather than as a staggered compatibility migration.
