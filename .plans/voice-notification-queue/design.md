# Voice Notification Queue

Status: Draft for review

## Purpose

Define an end-state design for notification-driven voice delivery on Android that:

- keeps TTS and STT execution client-driven
- allows one-at-a-time local queueing while the Android runtime is alive
- preserves durable notification history independently of live voice execution
- allows manual restart of speech or listen flows from Android notifications when automatic voice did not run

This document is intentionally narrower than a generalized distributed turn-management system.

## Problem Statement

The repo now has two adjacent but disconnected capabilities:

- durable notifications with a persisted `tts` hint
- Android native voice playback and recognition with multi-session observation

Current behavior leaves a gap:

- the notifications feature persists and displays TTS intent, but it does not drive Android voice
- the Android voice runtime can autoplay voice prompts and response-mode speech, but only when idle
- if another prompt arrives while the runtime is already speaking or listening, the new prompt is rendered only and is not queued
- if the device is not running the Android voice runtime when a notification arrives, there is no way for automatic voice to resume later except by a separate manual user action

That gives us acceptable v1 behavior, but it does not support the desired “work through multiple asks one at a time” experience for a running device.

## Goals

- Keep live TTS/STT timing, cue playback, and recognition ownership on the Android client.
- Avoid centralizing active voice-turn execution or pending recognition state across devices.
- Allow the Android runtime to queue local speech/listen work one item at a time while it is alive.
- Keep notifications durable even when no Android voice runtime is active.
- Allow Android notifications to expose manual actions that can start or resume local voice work later.
- Support more than one session producing voice-worthy work without letting the latest prompt always win.
- Avoid forcing every notification through audio handling.

## Non-Goals

- Persist active TTS/STT execution or pending recognition turns across devices.
- Create a server-side distributed queue that automatically resumes voice on a different client.
- Guarantee that a notification which arrived while the app was closed will later autoplay when the app opens.
- Turn every notification into a voice action.
- Redesign desktop voice behavior in this phase.

## Locked Product Direction

The current direction for this design is:

- notification persistence is durable
- live voice execution is ephemeral and client-owned
- notifications are the canonical server-originated ingress path for queue admission
- automatic queueing happens only when the Android voice runtime is already alive and eligible
- when the runtime is not alive, notifications may still be shown and may later expose manual Android voice actions
- not all notifications participate in audio queue management
- final assistant responses are the only automatic source for the per-session singleton attention notification
- any session-linked notification may later expose Android `Speaker` and `Mic` actions
- `voice_ask` should flow through the same server-originated notification/event path as final responses
- automatic `voice_speak` should flow through the same server-originated notification/event path as final responses
- automatic final-response speech should queue behind active voice work while the runtime stays alive
- manual `Speaker` and `Mic` actions should jump ahead and interrupt current speech
- `session_attention` clears only on explicit dismiss or user reply
- `Stop` clears only the current local backlog
- `voice_speak` is always `speak`
- `response` and `voice_ask` share identical local execution semantics
- `ttsText` is part of the notification contract as an optional spoken-text override
- any item that reaches `listen` must pass pre-listen validation before recognition starts

This is an intentional compromise between:

- a fully local voice runtime with no durable notification handoff
- a fully centralized cross-device voice-turn scheduler

## Current Baseline

### Notifications

The notifications plugin persists records with:

- `title`
- `body`
- `sessionId`
- `sessionTitle`
- `tts`

The server accepts and stores the `tts` flag, and the panel renders a TTS icon for it. There is not yet any native Android consumer of notification records or notification panel events.

There is not currently a stored `ttsText` override field in the notifications contract.

### Android voice runtime

The Android voice runtime already supports:

- multi-session observation through masked websocket subscriptions
- a persisted `preferredVoiceSessionId` for manual notification speech targeting
- one live `activeVoiceSessionId`
- playback followed by optional recognition
- notification `Speak` and `Stop` actions for the existing runtime

But it still uses a single active-interaction state machine:

- one active TTS request
- one active STT request
- one active session owner
- no backlog queue for later autoplay

### Existing deliberate debt

The current voice designs explicitly preserved “no backlog queue” behavior as a simplicity tradeoff. This proposal intentionally revisits that choice for Android while preserving the newer requirement that live execution remain client-driven rather than centralized.

### Relevant current code

Current implementation touchpoints worth revisiting during design and implementation:

- notifications storage and create operation:
  - `packages/plugins/core/notifications/server/index.ts`
  - `packages/plugins/core/notifications/server/store.ts`
  - `packages/plugins/core/notifications/server/types.ts`
- notifications panel rendering:
  - `packages/plugins/core/notifications/web/index.ts`
- Android voice runtime:
  - `packages/mobile-web/android/app/src/main/java/com/assistant/mobile/voice/AssistantVoiceRuntimeService.java`
  - `packages/mobile-web/android/app/src/main/java/com/assistant/mobile/voice/AssistantVoiceInteractionRules.java`
  - `packages/mobile-web/android/app/src/main/java/com/assistant/mobile/voice/AssistantVoiceSessionSocketProtocol.java`
  - `packages/mobile-web/android/app/src/main/java/com/assistant/mobile/voice/AssistantVoicePlugin.java`
- web voice settings ownership:
  - `packages/web-client/src/utils/voiceSettings.ts`
  - `packages/web-client/src/controllers/speechAudioController.ts`

## Design Principles

### 1. Separate durable attention from live voice execution

A notification should represent that something happened and may require user attention.

A local voice queue item should represent work the current Android runtime may execute now.

Those are related but not identical concepts.

### 1a. Treat final-response attention as a singleton per session

The “latest assistant answer for this session still needs my attention” use case is different from an append-only notification history.

The durable model should therefore support:

- one upserted attention item class per session for final assistant responses
- normal append-only notifications for everything else

### 2. Keep queue execution local to the active Android runtime

The Android service should own:

- ordering
- TTS timing
- recognition cue timing
- speech/listen transitions
- interruption handling
- local queue admission and dequeue

The server should not own an active global voice-turn queue.

### 3. Treat manual notification actions as a recovery path, not a replay guarantee

If the app or service was not alive when the notification arrived:

- the notification still exists
- the user may manually trigger local voice from the notification
- the system should not assume the missed automatic voice flow must be replayed later

### 4. Admit only explicit voice-worthy notification items into the local queue

Some notifications should remain visual-only.

The queue should receive items only when notification or transcript metadata explicitly asks for:

- `speak`
- `ask`
- possibly `listen_only`

### 5. Preserve one-at-a-time live execution

Queueing is about admission and scheduling, not concurrent voice work.

The runtime should still execute only one live voice action at a time.

## Proposed Model

## Layer 1: Durable notifications

The durable layer should distinguish between:

- `session_attention`: one mutable attention item per `sessionId`, updated by final assistant responses
- regular notifications: append-only records for explicit notifications and other session-linked events such as `voice_ask` and `voice_speak`

The singleton rule is scoped to the notification class, not to the whole session.

That means one session may have:

- one `session_attention` item
- and any number of regular append-only notifications

### `session_attention`

This is the new special-case notification shape.

Behavior:

- created or updated on each final assistant response for the session
- replaces the earlier `session_attention` item for the same session
- cleared when the server accepts a user reply in that session
- clearable by explicit dismiss
- not cleared merely by opening the session
- not cleared merely because local TTS playback succeeded

Server uniqueness rule:

- upsert by `(kind, sessionId)` where `kind = session_attention`

Purpose:

- bound notification noise to one “latest pending answer” item per session
- provide a durable recovery surface when automatic local voice did not run
- stay independent from whether a particular device was alive at arrival time

### Regular notifications

Everything that is not the final-response singleton stays append-only.

This includes:

- explicit notifications plugin items
- errors and alerts
- session-linked notifications that may support manual voice reply
- durable `voice_ask` notifications
- durable `voice_speak` notifications

The key point is that `voice_ask` and `voice_speak` do not need special stored notification types in the first pass. They can be regular notifications with explicit voice intent metadata.

For existing voice tools, no new public tool-call parameter is required. The server adapter can derive the spoken payload from the existing tool invocation and map it into the notification contract.

### Shared durable fields

Durable notification records likely need:

- `kind`
- `source`
- `sessionId`
- `sessionTitle`
- `sourceEventId` or correlation id
- `sessionActivitySeq`
- `voiceMode`
- optional `ttsText` override for spoken playback

`ttsText` should be treated as an internal notification-contract field, not necessarily a user-facing tool parameter. For `voice_speak` and `voice_ask`, the adapter can populate it from the tool's existing text payload without changing the tool API.

This layer remains server-side and can continue to back:

- the notifications panel
- Android system notifications
- manual Android notification actions

This layer does not represent live playback or live recognition state.

It should also become the canonical server-originated event shape for Android queue admission, replacing the legacy direct final-response admission path.

### Proposed first-pass durable shape

The contract should move toward an explicit notification model along these lines:

```ts
type NotificationKind = 'session_attention' | 'notification';
type VoiceMode = 'none' | 'speak' | 'speak_then_listen';
type NotificationSource = 'tool' | 'http' | 'cli' | 'system';

type NotificationRecord = {
  id: string;
  kind: NotificationKind;
  source: NotificationSource;
  title: string;
  body: string;
  sessionId?: string | null;
  sessionTitle?: string | null;
  sourceEventId?: string | null;
  sessionActivitySeq?: number | null;
  tts: boolean;
  voiceMode: VoiceMode;
  ttsText?: string | null;
  createdAt: string;
  readAt?: string | null;
};
```

First-pass semantics:

- `kind = session_attention` means “upsert by `(kind, sessionId)`”
- `kind = notification` means append-only
- `tts` remains a display and delivery hint
- `voiceMode` tells Android what local queue mode this notification represents
- `ttsText`, when present, is the spoken payload override
- `ttsText` is internal to the notification contract and can be populated by adapters without changing existing tool APIs

### Field semantics

First-pass contract decisions should be:

| Field | Required | Meaning | First-pass rule |
| --- | --- | --- | --- |
| `id` | yes | Stable notification record id | Server-generated |
| `kind` | yes | Storage and coalescing behavior | `session_attention` or `notification` |
| `source` | yes | Provenance of the notification | Existing values plus `system` for server-originated assistant response attention |
| `title` | yes | Visual label for panel and Android notification UI | Always present |
| `body` | yes | Visual body text | Always present |
| `sessionId` | no | Session the item is associated with | Required for `session_attention` and for any notification that offers `Mic` |
| `sessionTitle` | no | Friendly session label | Optional display hint |
| `sourceEventId` | no | Correlation id for the originating event | Strongly recommended for all server-generated voice-bearing items |
| `sessionActivitySeq` | no | Server-generated ordering watermark within a session | Required for any item that may auto-enter `listen` |
| `tts` | yes | Whether the item is eligible for spoken delivery affordances | `false` means visual-only |
| `voiceMode` | yes | Local audio mode represented by the item | `none`, `speak`, or `speak_then_listen` |
| `ttsText` | no | Spoken override text | If absent, Android falls back to normal spoken formatting |
| `createdAt` | yes | Server creation time | ISO timestamp |
| `readAt` | no | Read state | Existing notification-read semantics |

Recommended first-pass invariants:

- `kind = session_attention` requires `sessionId`
- `kind = session_attention` should always have `voiceMode = speak`
- `kind = session_attention` should always have `source = system`
- `voiceMode = speak_then_listen` implies `tts = true`
- `voiceMode = speak_then_listen` requires `sessionId`
- `voiceMode = speak_then_listen` requires a server-generated per-session activity sequence marker
- `voiceMode = none` means Android never auto-enqueues the item
- `ttsText` is optional for direct notification calls and implicitly populated by the server adapter for `voice_speak` and `voice_ask`

### Spoken text resolution

Android spoken text resolution should be:

1. use `ttsText` when present and non-empty
2. otherwise use `body` when it is sufficient on its own
3. otherwise fall back to a client-formatted `title + body`

The point of `ttsText` is not to add a new public tool parameter. It is to let the notification contract carry an explicit spoken override when needed.

### Action derivation

`voiceActions` does not need to be persisted as a first-pass field.

Android actions should be derived from the stored record plus local runtime state:

- `Speaker` is available when `tts = true`
- `Mic` is available when `sessionId` is present
- action enablement still depends on local runtime state such as connectivity and current execution

This keeps the durable schema smaller while still allowing Android to present the right affordances.

### `session_attention` body strategy

For final assistant responses:

- `body` should contain a panel-friendly excerpt or truncated summary for visual display
- `ttsText` should contain the full spoken response text when TTS is enabled

This lets the panel stay readable without sacrificing spoken completeness.

### `session_attention` upsert semantics

The store needs a real upsert operation for `session_attention`.

Suggested behavior:

- lookup by `(kind, sessionId)`
- if no existing record exists, insert a new record
- if a record exists:
  - preserve `id`
  - replace `title`, `body`, `source`, `sourceEventId`, `sessionActivitySeq`, `tts`, `voiceMode`, and `ttsText`
  - set `createdAt` to the latest material update time
  - reset `readAt` to `null`

This ensures the item behaves as “latest pending attention for this session” instead of as historical append-only state.

### Pruning policy

Generic notification pruning should not be the primary lifecycle for `session_attention`.

First-pass policy:

- regular notifications continue to use the normal cap/pruning policy
- `session_attention` items are expected to clear eagerly through dismiss or accepted user reply
- store pruning logic should be kind-aware so singleton attention items are not treated exactly like append-only read history

## Event Contract

The stored record and the broadcast event should be treated as different shapes.

Stored record:

- durable
- queryable
- backs the panel
- backs manual Android recovery

Broadcast event:

- real-time
- carries revision and mutation intent
- drives panel state updates and Android queue admission

Suggested first-pass event shape:

```ts
type NotificationMutation = 'created' | 'upserted' | 'removed' | 'snapshot';

type NotificationEvent = {
  mutation: NotificationMutation;
  revision: number;
  notification?: NotificationRecord;
  replacedId?: string | null;
};
```

Recommended semantics:

- `created` for append-only inserts
- `upserted` for `session_attention` insert-or-replace mutations
- `removed` for dismiss or clear-on-user-reply
- `snapshot` for initial hydration

The panel should replace by `id` on `upserted`, not append.
Android should treat `upserted` as fresh work only when `sourceEventId` or `sessionActivitySeq` changed.

## Layer 2: Android local voice queue

The Android runtime should maintain an in-memory queue of local work items while the service is alive.

Suggested queue modes:

- `speak`
- `listen`
- `speak_then_listen`

Suggested item fields:

- `queueItemId`
- `mode`
- `sessionId`
- `sourceType`
- `sourceId`
- `text`
- `createdAt`

Mapping examples:

- tap `Speaker` on a notification -> `speak`
- tap `Mic` on a notification -> `listen`
- future automatic `voice_ask` flow -> `speak_then_listen`
- automatic final-response playback -> `speak` or `speak_then_listen` depending on local auto-listen policy
- automatic `voice_speak` playback -> `speak`

This queue is intentionally ephemeral:

- no cross-device persistence
- no server-owned active execution state
- loss of pending queue items on process death is acceptable if the durable notification remains available for manual restart

## Layer 3: Current interaction executor

The existing Android state machine should become the executor for the head queue item:

- TTS
- optional recognition
- transcript submit
- interruption
- completion or failure cleanup

In other words, the current runtime should stop being the queue itself and instead become the worker that consumes queue items.

## Admission Rules

Automatic local enqueue should happen only if:

- Android native voice mode is enabled
- the Android voice runtime is alive and connected enough to accept work
- the incoming notification event explicitly requests or implies voice delivery
- the item is still fresh enough to be meaningful

Automatic local enqueue should not happen merely because a durable notification exists.

For final assistant responses, the intended end-state is:

- server upserts `session_attention`
- server emits the resulting notification event
- Android decides locally whether to enqueue `speak`

This removes the duplicate-admission risk between transcript-driven autoplay and notification-driven autoplay.

### Canonical admission mapping

The intended end-state mapping is:

- final assistant response -> `session_attention` notification event -> Android may enqueue `speak`
- `voice_speak` -> regular notification event with `voiceMode = speak` -> Android may enqueue `speak`
- `voice_ask` -> regular notification event with `voiceMode = speak_then_listen` -> Android may enqueue only when that mode is supported
- explicit notification with no voice intent -> durable only, no automatic enqueue

This keeps one server-originated event path for all automatic voice admissions.

### Producer mapping

The server-side producers should emit notifications like this:

| Source | Durable kind | `tts` | `voiceMode` | Coalescing rule | Automatic local behavior |
| --- | --- | --- | --- | --- | --- |
| Final assistant response | `session_attention` | `true` when response voice is enabled for the producing path | `speak` or `speak_then_listen` depending on local auto-listen | Upsert by `(kind, sessionId)` | Queue behind active work when runtime is alive |
| `voice_speak` tool | `notification` | `true` | `speak` | Append-only | Queue behind active work when runtime is alive |
| `voice_ask` tool | `notification` | `true` | `speak` or `speak_then_listen` depending on local auto-listen | Append-only | Queue behind active work when runtime is alive when validation succeeds |
| Explicit notification without voice | `notification` | `false` | `none` | Append-only | Never auto-enqueue |
| Explicit notification with TTS only | `notification` | `true` | `speak` | Append-only unless a future key says otherwise | Queue behind active work when runtime is alive |

Additional producer rules:

- accepted user message submission for session `S` clears `session_attention` for `S`
- manual dismiss clears only the targeted durable item
- final assistant response producers should stop using the legacy direct Android autoplay path once the notification-backed path ships
- clear-on-user-reply requires a concrete server hook in the user-message submission path, not just plugin-local logic

## Manual Recovery Rules

When the Android runtime was not alive or automatic enqueue was skipped:

- the durable notification may still expose manual actions
- those actions create fresh local queue items from the durable notification context
- manual actions should respect the same single-executor model as automatic queue items

Current first-pass Android actions:

- `Speaker`: read the notification text through TTS only
- `Mic`: start recognition for the notification's `sessionId` only

First-pass manual-action behavior:

- manual actions should jump ahead of automatically queued work
- manual actions should interrupt current TTS or speech in the same spirit as the current `Stop` behavior
- after interruption, the manual action becomes the active queue head
- the interrupted automatic item should be discarded from the local audio queue rather than requeued
- recovery for discarded automatic items comes from the durable notification surface, not from local queue preservation

Stop behavior:

- `Stop` cancels the current live voice execution
- `Stop` clears the remaining local in-memory queue
- `Stop` does not dismiss durable notifications
- recovery after `Stop` happens by explicit new admissions or manual notification actions
- `Stop` does not suppress future automatic admissions once new events arrive

This is the expected path for “device was closed, but I want to kick speech back off from that point.”

### Android consumer rules

Android should consume notification events with these rules:

| Condition | Behavior |
| --- | --- |
| Voice runtime disabled locally | Keep durable notification only; do not enqueue |
| Voice runtime enabled and idle | Enqueue immediately according to `voiceMode` |
| Voice runtime enabled and busy | Append automatic item behind active queue head |
| Incoming item has `voiceMode = none` | Do not auto-enqueue |
| Incoming item has `voiceMode = speak` | Enqueue `speak` |
| Incoming item has `voiceMode = speak_then_listen` | Enqueue `speak_then_listen` only when local auto-listen is enabled and validation succeeds |
| Manual `Speaker` tap | Interrupt current audio flow, discard interrupted automatic item, run `speak` now |
| Manual `Mic` tap | Interrupt current audio flow, discard interrupted automatic item, run `listen` now |
| User taps `Stop` | Cancel active voice execution and flush local queue |

Definitions:

- `idle` means no active TTS, no active STT, and no currently executing queue head
- `busy` means any active TTS, active STT, or active queue head is in progress

### Queue constraints

First-pass Android queue safeguards should include:

- FIFO ordering for automatic admissions across sessions
- manual actions jump ahead of automatic work
- queue capacity cap of roughly 20 items
- deduplication by `sourceEventId` when present
- a short-lived in-memory recent-id set for admitted/completed items to avoid replay duplicates during reconnect while the service stays alive

For `session_attention` specifically:

- if a newer `upserted` item for the same session arrives before the queued automatic item starts, replace the queued pending item with the newer one
- if the older item is already executing, do not interrupt it automatically

Regular append-only notifications should not be coalesced this way.

### Pre-listen validation

Any queue item that reaches a `listen` phase should be revalidated immediately before recognition starts.

The first-pass validation contract should be based on server-generated per-session ordering, not time-based expiry.

Suggested fields for any item that may reach `listen`:

- `sessionId`
- `sourceEventId`
- `sessionActivitySeq`

Automatic `speak_then_listen` is invalid if:

- session still exists
- no accepted user reply in that session has a higher `sessionActivitySeq`
- no newer assistant response or newer `voice_ask` in that session has a higher `sessionActivitySeq`

If invalid:

- do not start recognition
- finish the local audio item
- leave the durable notification in place
- do not auto-retry

Manual `Mic` should use a looser validation rule:

- require that the session still exists
- do not block manual listen merely because the originating item was superseded

This preserves explicit user intent while still protecting automatic reply turns from stale context.

Validation source of truth:

- server remains the authority for `sessionActivitySeq`
- Android may cache the latest known sequence from incoming notification events while connected
- immediately before automatic recognition starts, Android should use a lightweight server validation check when local knowledge may be stale

This avoids relying on wall-clock time or assuming the client has perfect ordering knowledge.

## Transport And Cutover

Preferred transport direction:

- use the notifications event stream as the canonical transport for Android queue admission
- do not keep transcript-event autoplay as a permanent parallel path

Implementation note:

- if Android cannot yet consume notification events directly, a temporary dual-path development phase is acceptable behind an implementation flag
- final cutover should remove direct transcript autoplay admission once notification-event parity is verified

Preferred end-state:

- the same notification event stream that updates the panel also feeds Android queue admission
- no second bespoke autoplay-only transport remains

## Candidate Ingress Sources

### 1. Final assistant responses

Final assistant responses are the current preferred source for the durable per-session singleton.

Policy direction:

- update or create `session_attention`
- emit the canonical notification event for that `session_attention`
- optionally enqueue local voice from that notification event when the Android runtime is alive and eligible
- if the runtime is already busy, append behind the active local voice item rather than dropping the work

This preserves the existing Android response-mode “final only” behavior at the product level while changing the ingress path to the notifications system.

At the Android queue layer:

- `voice_speak` is always `speak`
- final assistant responses are `speak` when auto-listen is off
- final assistant responses are `speak_then_listen` when auto-listen is on
- `voice_ask` follows the same rule as final assistant responses

### 2. Regular notifications

Explicit notifications plugin calls continue to create append-only notifications.

If session-linked, they may also expose:

- `Speaker`
- `Mic`

Some regular notifications may later be eligible for automatic local enqueue, but that should be opt-in rather than implied by mere persistence.

### 3. Voice tool prompts

- `voice_speak` maps naturally to local `speak`
- `voice_ask` maps naturally to local `speak_then_listen`

These should use the same canonical server-originated notification/event path as final assistant responses.

They should be represented as regular session-linked notifications with explicit voice intent metadata rather than dedicated stored types.

Server-side mapping direction:

- existing `voice_speak` text becomes notification spoken content
- existing `voice_ask` prompt text becomes notification spoken content
- no additional tool parameter is introduced just to support the notification queue
- visual notification fields may mirror that text or present a shorter summary, depending on UX needs

Queue-semantics direction:

- final assistant response -> `speak` or `speak_then_listen` depending on local auto-listen policy
- `voice_speak` -> `speak`
- `voice_ask` -> `speak` or `speak_then_listen` depending on local auto-listen policy

The important distinction is:

- `voice_speak` is always one-way
- final assistant responses and `voice_ask` may expect a reply turn and should be executed the same way locally

So the special case is any flow that reaches `listen`. That includes both final assistant responses with auto-listen enabled and `voice_ask` with auto-listen enabled.

The design preference is to avoid parallel canonical ingress paths for the same event class. Tool-originated voice events should therefore be notification-backed from the start in this design.

## Recommended First-Cut Policy

For the first implementation:

- keep live execution local and in-memory
- do not try to persist active queue state
- create or update one `session_attention` item per session from final assistant responses
- route automatic `voice_speak` through regular notification events
- defer automatic `voice_ask` execution while still routing its event server-side
- allow any session-linked notification to expose Android `Speaker` and `Mic` actions
- support local queue modes that distinguish `speak`, `listen`, and `speak_then_listen`
- allow automatic final-response `speak` items to queue behind active work
- treat `voice_speak` as pure `speak`
- treat final assistant responses and `voice_ask` identically according to local auto-listen policy
- let manual `Speaker` and `Mic` actions jump ahead and interrupt current speech
- flush the local queue on `Stop` and leave durable notifications intact
- clear `session_attention` only on explicit dismiss or user reply
- defer automatic queued `ask` until stale-turn and supersession semantics are locked

That sequencing keeps the first pass smaller and reduces the risk of delivering an outdated recognition prompt after the underlying conversation moved on.

### First-pass event examples

Final assistant response:

```json
{
  "kind": "session_attention",
  "sessionId": "s_123",
  "title": "Planner",
  "body": "I updated the rollout plan.",
  "tts": true,
  "voiceMode": "speak"
}
```

Tool-driven `voice_speak`:

```json
{
  "kind": "notification",
  "sessionId": "s_123",
  "title": "Agent prompt",
  "body": "Deployment completed successfully.",
  "tts": true,
  "voiceMode": "speak",
  "ttsText": "Deployment completed successfully."
}
```

Tool-driven `voice_ask` for later phases:

```json
{
  "kind": "notification",
  "sessionId": "s_123",
  "title": "Agent question",
  "body": "Do you want me to restart the service?",
  "tts": true,
  "voiceMode": "speak_then_listen",
  "ttsText": "Do you want me to restart the service?"
}
```

## State Ownership

### Server owns

- durable notification records
- notification metadata and display history
- any future notification-level voice intent metadata

### Android runtime owns

- local queue contents
- active queue head
- TTS execution
- recognition timing and cue playback
- interruption behavior
- recognized speech submission

### Web client owns

- voice settings UI
- selected and preferred session configuration
- syncing those preferences into native

## Risks

- a per-session singleton can hide important intermediate responses if the replacement rule is too aggressive
- queued `speak_then_listen` items can become stale if the session progresses before the user responds
- coupling transcript-derived prompt observation and notification-derived queue admission may duplicate work unless correlation ids are explicit
- queue-jumping manual actions can feel surprising if automatic work is discarded too aggressively on interruption
- a queue that is too eager may produce noisy background speech across many sessions
- a queue that is too conservative may make notifications feel disconnected from live voice
- Android notification actions need enough metadata to reconstruct a local queue item without inventing server-owned execution state

## Open Questions

### 1. What invalidates a queued `ask` item?

Likely candidates:

- session deleted
- session receives a newer user message
- session receives a newer assistant turn that supersedes the ask

Recommended mechanism:

- represent session ordering with a server-generated `sessionActivitySeq`
- require `sessionActivitySeq` on any notification that may auto-enter `listen`
- compare the queued item’s `sessionActivitySeq` with the latest known session activity immediately before recognition starts

These checks matter specifically for the `listen` phase. They do not need to block ordinary `speak` items such as `voice_speak`.

### 2. When should `session_attention` clear besides reply and dismiss?

Likely options:

- reply only
- reply or dismiss only
- clear after successful `Speaker`
- clear after opening the session

The current recommendation is reply or dismiss only, and no broader clearing behavior is needed for first pass.

### 3. How much deduplication is required?

If one event creates both:

- a transcript voice prompt
- and a durable notification with voice intent

the runtime needs a correlation mechanism so it does not enqueue the same work twice.

The cleanest likely split is:

- final assistant responses: notification event for `session_attention` is the canonical admission path
- explicit notifications with voice intent: notification event is the canonical admission path
- `voice_speak`: regular notification event is the canonical admission path
- `voice_ask`: regular notification event is the canonical admission path

## Implementation Notes

The main code changes likely fall into these buckets:

- notifications plugin:
  - add `kind`, `voiceMode`, and optional `ttsText`
  - add upsert semantics for `session_attention`
  - emit one canonical notification event shape for panel and Android consumers
- server event producers:
  - route final assistant responses into `session_attention`
  - adapt `voice_speak` and `voice_ask` into regular notification events
  - clear `session_attention` on accepted user message submission
- Android runtime:
  - replace direct final-response autoplay admission with notification-event admission
  - add a local queue with `speak`, `listen`, and later `speak_then_listen`
  - implement manual action preemption and discard behavior
  - keep execution client-owned and ephemeral

## Implementation-Ready Summary

If work started now, the first coded contract should be:

- persist `kind`, `voiceMode`, optional `ttsText`, and `sourceEventId` on notifications
- upsert `session_attention` by `(kind, sessionId)`
- emit one canonical notification event shape for all voice-bearing items
- map:
  - final response -> `session_attention` + `voiceMode = speak` or `speak_then_listen` according to local auto-listen policy
  - `voice_speak` -> `notification` + `voiceMode = speak`
  - `voice_ask` -> `notification` + `voiceMode = speak_then_listen`
- let Android:
  - queue `speak` items automatically
  - allow `speak_then_listen` when local auto-listen is enabled and pre-listen validation succeeds
  - allow manual `Speaker` and `Mic` to preempt and discard interrupted automatic audio work

This implies the legacy direct final-response admission path in Android should be removed as part of the unified design.

## Initial Recommendation

Proceed with a hybrid model:

- durable notifications remain the recovery surface
- Android owns an ephemeral local queue
- only a running Android runtime auto-enqueues voice work
- final assistant responses own a singleton per-session durable attention item
- any session-linked notification can offer Android `Speaker` and `Mic`
- manual notification actions can create fresh local queue items later

That gives us queueing where it helps most without turning voice execution into a cross-device server-managed workflow.
