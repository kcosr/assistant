# Audio TTS/STT Refactor (Long-term)

**Status:** Proposal (breaking changes OK)
**Created:** 2026-02-01
**Author:** Agent

## Overview

This document proposes a long-term refactor of speech features:

- **TTS**: clean backend boundaries + consistent file layout (aligned with `omni-channel-suite`).
- **STT**: add **server-side streaming STT** via **OpenAI Realtime Transcription**.
- **Voice sessions**: support true barge-in (speech-start interrupts TTS) and robust audio input handling.

Backwards compatibility is **not** a goal; we optimize for the “best” design.

## Goals

1. **Clean TTS architecture**
   - Backend-specific configs (no `EnvConfig` coupling).
   - Colocate backend + client implementation under `src/tts/`.
   - No implicit fallback behavior.

2. **Server-side streaming STT**
   - OpenAI Realtime WebSocket transcription (`intent=transcription`).
   - Server VAD support (`server_vad` or `none`).
   - Emit partial + final events.

3. **Protocol that works with multiplexed sessions**
   - This repo supports multiplexed sessions on a single WebSocket.
   - Binary audio frames do not carry `sessionId`, so we need an explicit binding model.

4. **Barge-in**
   - On `speech_started` (server VAD), cancel any active output using the existing output-cancel path.

5. **Preserve the existing mic UX while allowing STT backend choice**
   - Keep the current “tap to talk / long-press to continuous listen” behavior.
   - Allow choosing STT backend: `browser` (native SpeechRecognition) or `server` (OpenAI Realtime streaming).

## Non-goals

- Supporting multiple STT vendors in v1 of this refactor (we can add later).
- Maintaining the existing `transcript_delta/transcript_done` message types.
- Perfect parity across all browsers/devices (some browsers may not support required mic capture APIs).

## Current State (this repo)

### TTS

- OpenAI TTS is implemented in `packages/agent-server/src/tts/openAiTtsBackend.ts` and is **batch-only** (buffers all text, then generates PCM).
- ElevenLabs TTS uses a streaming WebSocket client living outside `tts/` at `packages/agent-server/src/elevenLabsTts.ts`.
- `selectTtsBackendFactory.ts` contains runtime fallback logic (ElevenLabs → OpenAI).

### STT

- No server-side STT. The web client uses Web Speech API (`packages/web-client/src/controllers/speechInput.ts`).
- The agent server currently **rejects binary audio input** (`SessionRuntime.handleClientBinaryMessage()` returns `audio_not_supported`).

### Protocol

- The shared protocol already contains `transcript_delta` / `transcript_done`, but the agent server does not emit them today.
- Multiplexing is supported (protocol v2), but binary frames have no `sessionId` and therefore require a binding scheme.

## Reference: omni-channel-suite

`omni-channel-suite` already has the target architecture:

- `packages/hub/src/tts/elevenLabsClient.ts` + `elevenLabsBackend.ts`
- `packages/hub/src/stt/types.ts` + `openaiRealtime.ts`

We will port/adapt these patterns.

---

## Proposed Design

## 1) TTS refactor

### File layout

```text
packages/agent-server/src/tts/
├── types.ts
├── backends.ts
├── elevenLabsClient.ts          # moved from ../elevenLabsTts.ts
├── elevenLabsBackend.ts         # refactored to use ElevenLabsConfig
├── openAiBackend.ts             # renamed from openAiTtsBackend.ts
├── selectBackendFactory.ts      # simplified: no fallback
└── sanitizeTtsText.ts
```

### Backend configs (focused)

Backend configs should not depend on `EnvConfig` and should not “know about” other backends.

```ts
export interface ElevenLabsConfig {
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId?: string;
  elevenLabsBaseUrl?: string;

  // output framing
  ttsFrameDurationMs: number;
  outputSampleRate: number;
}

export interface OpenAiTtsConfig {
  apiKey: string;
  model: string;
  voice?: string;
  speed?: number;

  // output framing
  ttsFrameDurationMs: number;
  // NOTE: OpenAI PCM output rate must match what we label in AudioFrames.
  // If OpenAI is fixed-rate, we must hardcode/validate this.
  outputSampleRate: number;
}
```

### Explicit TTS backend selection (no fallback)

```ts
export type TtsBackendType = 'elevenlabs' | 'openai' | 'none';

export function selectTtsBackendFactory(...): TtsBackendFactory | null {
  switch (ttsBackend) {
    case 'elevenlabs': return createElevenLabsFactory(...);
    case 'openai':     return createOpenAiFactory(...);
    case 'none':
    default:           return null;
  }
}
```

### Important correctness note: OpenAI TTS sample rate

The current OpenAI TTS backend labels frames with `sampleRate = config.audioSampleRate`.

Long-term we should:

- **Standardize** on a single output sample rate (recommended: **24000 Hz**) and enforce it.
- Or implement resampling if we truly need arbitrary output rates.

Without this, clients can receive PCM bytes whose *declared* sample rate doesn’t match the PCM’s true rate.

---

## 2) STT: server-side OpenAI Realtime

### File layout

```text
packages/agent-server/src/stt/
├── types.ts
├── openaiRealtime.ts
└── index.ts
```

`stt/types.ts` and `stt/openaiRealtime.ts` should be ported from `omni-channel-suite` with minimal changes.

### OpenAI Realtime requirements

- WebSocket URL default: `wss://api.openai.com/v1/realtime?intent=transcription`
- Required header: `OpenAI-Beta: realtime=v1`

### STT provider config

```ts
export type SttProviderType = 'openai' | 'none';

export interface SttConfig {
  provider: SttProviderType;

  // OpenAI
  apiKey?: string;
  baseUrl?: string;
  organization?: string;

  model: string;              // e.g. gpt-4o-mini-transcribe
  language?: string;

  vad: 'server' | 'none';
  vadConfig?: {
    threshold?: number;
    prefixPaddingMs?: number;
    silenceDurationMs?: number;
  };

  // audio input
  inputFormat: 'pcm16' | 'g711_ulaw' | 'g711_alaw';
  inputSampleRate: number;

  // debugging
  debug: boolean;
  debugLogFile?: string;
}
```

---

## 3) Protocol changes (breaking)

### Summary

We introduce an explicit **voice stream binding** model so that binary mic audio can be routed to the correct session.

This design supports multiplexing while still using a simple binary format (`AudioFrame`) without embedding a `sessionId` in every frame.

### Protocol version

- Bump protocol to **v3**.

### New client → server messages

```ts
// Start sending microphone frames for a session.
// After this message is accepted, the client streams binary AudioFrame messages.
interface ClientVoiceStartMessage {
  type: 'voice_start';
  sessionId: string;

  // Optional per-session overrides
  stt?: {
    provider?: 'openai' | 'none';
    model?: string;
    language?: string;
    vad?: 'server' | 'none';
    vadConfig?: {
      threshold?: number;
      prefixPaddingMs?: number;
      silenceDurationMs?: number;
    };
  };

  // Declares what the client will send.
  audio: {
    sampleRate: number;
    channels: 1;
    format: 'pcm16';
  };
}

interface ClientVoiceStopMessage {
  type: 'voice_stop';
  sessionId: string;
}

interface ClientVoiceCancelMessage {
  type: 'voice_cancel';
  sessionId: string;
}
```

### Binary messages

- Client streams binary `AudioFrame` messages with `AUDIO_FLAG_MIC`.
- **Routing rule:** binary mic frames are attributed to the most recently started `voice_start` for that WebSocket connection.
- **Constraint:** one active voice stream per connection at a time (simple and sufficient).

If we ever need concurrent voice streams on one connection, we should introduce a binary envelope that includes a `streamId`.

### New server → client messages

We introduce `stt_*` messages and remove the legacy `transcript_*` messages.

```ts
interface ServerSttPartialMessage {
  type: 'stt_partial';
  sessionId: string;
  itemId?: string;
  text: string;
  mode: 'incremental' | 'full';
}

interface ServerSttFinalMessage {
  type: 'stt_final';
  sessionId: string;
  itemId?: string;
  text: string;
}

interface ServerSttSpeechStartMessage {
  type: 'stt_speech_start';
  sessionId: string;
  itemId?: string;
}

interface ServerSttErrorMessage {
  type: 'stt_error';
  sessionId: string;
  error: string;
}
```

---

## 4) Server runtime integration

### Accept binary mic audio

Replace `SessionRuntime.handleClientBinaryMessage()` behavior:

- Validate + decode incoming `AudioFrame` using `validateAndDecodeMicAudioFrame()`.
- Apply `maxAudioBytesPerMinute` rate limiting for mic bytes.
- If no active `voice_start` binding exists, ignore or error (design choice; recommend error).

### STT stream lifecycle

Per WS connection:

- Maintain `activeVoice: { sessionId, sttStream, inputSampleRate, channels } | null`.
- On `voice_start`:
  - Validate session exists and is subscribed.
  - Stop any prior STT stream.
  - Start a new `SttStream` based on server config + message overrides.
- On binary mic frames:
  - Push PCM bytes into `sttStream.pushAudio()`.
- On `voice_stop`:
  - `sttStream.stop()` and finalize any pending transcript state.

### Feeding transcripts into chat

### Feeding transcripts into chat (UX-driven)

To preserve the existing web-client UX and keep the chat/run loop consistent, **server STT is transcription-only**:

- The server emits `stt_partial` / `stt_final` events.
- The **client** decides when to submit a user message by sending the existing `text_input` message (same as today).
- Partial transcripts are UI-only; they should not trigger tool calls/runs.

This keeps the mic button semantics stable (tap/hold) and avoids turning STT into a second “input channel” with its own server-side turn lifecycle.

(We can later evolve to server-driven voice turns if/when we add a dedicated voice UI and event model.)

### Barge-in

On server STT `speech_started`:

- If the session has active output, call the existing output-cancel path (equivalent to client `control { target:'output', action:'cancel' }`).

This should reuse the logic in:

- `packages/agent-server/src/ws/chatOutputCancelHandling.ts`

---

## 5) Web client changes

### Support two STT backends (toggle)

We should support both:

- **Browser STT (native)**: existing Web Speech API (`SpeechRecognition`).
- **Server STT (streaming)**: mic capture → PCM16 `AudioFrame` streaming → OpenAI Realtime transcription.

This is a **client-side choice** (per user preference), with a recommended default of **server STT** when available.

### Keep the existing mic button UX

The current button behavior in `SpeechAudioController` is:

- **Tap** (short press): start one recognition; on final text, auto-submit.
- **Long-press**: enable continuous listening; after an assistant audio response finishes, automatically re-arm listening.
- If output is active, the button currently prefers “stop output” over “start listening”.

With server STT we keep the same mental model, but we can improve barge-in:

- If output is active and the user taps the mic, **cancel output and start listening** (barge-in).

### Client architecture

Introduce an abstraction used by `SpeechAudioController`:

```ts
interface SpeechInputController {
  start(opts: {
    sessionId: string;
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (err: unknown) => void;
    onEnd: () => void;
  }): Promise<void> | void;

  stop(): Promise<void> | void;
  cancel?(): Promise<void> | void;
}
```

Implementations:

- `BrowserSpeechInputController`: existing logic in `speechInput.ts`.
- `ServerStreamingSpeechInputController`:
  - sends `voice_start`
  - streams binary mic `AudioFrame` messages
  - listens for `stt_partial` / `stt_final` server messages (routed by `sessionId`)

### Timeout-to-send / finalize behavior

Server STT produces segments (`stt_final`), which may arrive as multiple items depending on VAD. To preserve the “one tap → one message” feel, implement a **finalize timer** on the client:

- Maintain `pendingFinalText` for the active speech capture.
- On each `stt_final`:
  - append to `pendingFinalText` with a space separator
  - (re)start `VOICE_FINALIZE_MS` timer (recommended default: **1200ms**)
- When the timer fires:
  - send `text_input { sessionId, text: pendingFinalText.trim() }`
  - clear `pendingFinalText`
  - end the capture (stop streaming)

For **tap mode**, we can also end capture immediately on the first finalize to match current behavior.

For **continuous listening**, after sending the message we stop capture and rely on the existing “auto re-arm after TTS” behavior to start the next capture.

### Barge-in

Barge-in works in two layers:

1. **Client intent**: when user taps the mic while output is active, the client sends `control { target:'output', action:'cancel' }` and immediately starts `voice_start`.
2. **Server detection**: when OpenAI Realtime emits `speech_started`, the server cancels output via the existing output-cancel path (belt-and-suspenders, and covers cases where output becomes active mid-capture).

### Frontend rework required

Yes—server streaming STT requires real frontend work beyond swapping transcription providers:

- Implement mic capture (`getUserMedia`) + resampling to `AUDIO_INPUT_SAMPLE_RATE`.
- Encode PCM16 and wrap in `AudioFrame` with `AUDIO_FLAG_MIC`.
- Add routing in the WebSocket message handler for `stt_*` messages.
- Refactor `SpeechAudioController` to use a backend-agnostic `SpeechInputController` implementation.

---

## 6) Configuration (breaking)

### Environment variables

```bash
# TTS
TTS_BACKEND=elevenlabs|openai|none
TTS_FRAME_DURATION_MS=250

# TTS output rate (recommended to standardize at 24000)
AUDIO_OUTPUT_SAMPLE_RATE=24000

# ElevenLabs
ELEVENLABS_API_KEY=...
ELEVENLABS_TTS_VOICE_ID=...
ELEVENLABS_TTS_MODEL=eleven_multilingual_v2
ELEVENLABS_TTS_BASE_URL=https://api.elevenlabs.io

# OpenAI TTS
OPENAI_API_KEY=...
OPENAI_TTS_MODEL=gpt-4o-mini-tts
TTS_VOICE=alloy
AUDIO_OUTPUT_SPEED=1.0

# STT
STT_PROVIDER=openai|none
STT_OPENAI_API_KEY=...            # defaults to OPENAI_API_KEY
STT_BASE_URL=wss://...            # optional
STT_MODEL=gpt-4o-mini-transcribe
STT_LANGUAGE=en
STT_VAD=server|none
STT_VAD_THRESHOLD=0.5
STT_VAD_PREFIX_MS=300
STT_VAD_SILENCE_MS=500

# Audio input (mic)
AUDIO_INPUT_SAMPLE_RATE=16000

# Debug
STT_DEBUG=0|1
STT_DEBUG_LOG_FILE=/path/to/stt.jsonl
```

Notes:

- Separate input vs output sample rates avoids mislabeling frames.
- If OpenAI TTS output rate is fixed, `AUDIO_OUTPUT_SAMPLE_RATE` must match it.

---

## 7) Implementation plan

### Phase 1: TTS refactor

- Move ElevenLabs client into `src/tts/elevenLabsClient.ts`.
- Introduce backend-specific configs; remove `EnvConfig` coupling.
- Remove fallback behavior.

### Phase 2: STT provider

- Add `src/stt/types.ts` and `src/stt/openaiRealtime.ts` (port from omni-channel-suite).
- Add server config loading for STT.

### Phase 3: Protocol v3 + server audio input

- Add `voice_start/stop/cancel` and `stt_*` messages to `@assistant/shared`.
- Update server to accept binary mic frames and route them to STT.
- Implement barge-in on `speech_started`.

### Phase 4: Web client mic streaming

- Implement mic capture and binary `AudioFrame` sending.
- Render STT events.

---

## 8) Testing strategy

### Unit tests

- `stt/openaiRealtime.ts`: WebSocket message parsing, delta vs full mode, error handling.
- TTS backend factories with focused configs.

### Integration tests

- SessionRuntime: `voice_start` binds session, binary MIC frames are validated and forwarded.
- Rate limiting: rejects/exits when `maxAudioBytesPerMinute` exceeded.
- Barge-in: `speech_started` triggers output cancel and cancels active TTS session.

---

## 9) Security + privacy

- Raw mic audio is sent to OpenAI (third party). Ensure user-visible disclosure.
- API keys must remain server-side; clients never receive OpenAI keys.

---

## Appendix: key reference files

- This repo:
  - `packages/agent-server/src/tts/*`
  - `packages/agent-server/src/ws/sessionRuntime.ts`
  - `packages/agent-server/src/audio.ts` (`validateAndDecodeMicAudioFrame`)
  - `packages/shared/src/protocol.ts`
- omni-channel-suite:
  - `packages/hub/src/tts/elevenLabsClient.ts`
  - `packages/hub/src/stt/openaiRealtime.ts`
