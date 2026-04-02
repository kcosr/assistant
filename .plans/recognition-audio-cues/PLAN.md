# Recognition Audio Cues Plan

## Goal

Add native Android recognition audio cues to the assistant app so the user gets clear audible feedback for speech-recognition lifecycle events.

This work should target the assistant's **native Android background voice runtime**, not the web UI path.

## Outcome

Implement cue playback in assistant's native Android voice service with behavior modeled on the `agent-voice-adapter` Android app:

- positive cue when recognition is ready/listening
- positive cue on successful recognition completion
- negative cue on timeout / no usable speech
- negative cue on recognition error
- negative cue on manual stop / cancel if applicable
- configurable enable/disable and gain

The desired result is **strong behavioral parity** with the other app's recognition-cue experience, while fitting assistant's own native runtime architecture.

---

## User Decisions Captured

These decisions were provided by the user and should be treated as requirements unless superseded:

- Cue events:
  - start recognition
  - successful recognition completion
  - timeout / no usable speech
  - generic recognition error
- Timeout / no-speech should sound **failure-like**, not success-like.
- Sound parity should be **same style**, not necessarily bit-for-bit exact.
- Scope is **Android native only**.
- Config mode should be **on/off + gain**.
- Start cue should play when the app is **actually ready/listening**.
- Manual stop can use the same stop/failure cue.

Recommended final cue mapping:

- **Recognition ready/listening** → positive cue
- **Recognition success** → positive cue
- **Timeout / no speech** → negative cue
- **Recognition error** → negative cue
- **Manual stop / cancel** → negative cue

---

## Why This Belongs in Native Android

The recognition flow of interest is handled by assistant's native Android background voice runtime, not by the web UI.

That means the cue implementation should live in assistant's native Android service, near the microphone / STT / playback lifecycle, so it can reflect true runtime state transitions.

This is important because:

- recognition readiness is a native runtime state
- recognition completion / failure arrives through the native runtime
- audio playback and mic coordination are already managed there
- we want cue behavior even when the UI is not the primary execution surface

---

## Relevant Assistant Code

Investigate and work primarily in the assistant repo worktree:

- `/home/kevin/worktrees/assistant-recognition-audio-cues`

Key native files identified during investigation:

- `packages/mobile-web/android/app/src/main/java/.../AssistantVoiceRuntimeService.java`
- `packages/mobile-web/android/app/src/main/java/.../AssistantVoicePcmPlayer.java`
- `packages/mobile-web/android/app/src/main/java/.../AssistantVoiceMicStreamer.java`
- `packages/mobile-web/android/app/src/main/java/.../AssistantVoiceConfig.java`

Important assistant insertion points identified by investigation:

- `startRecognition()`
  - cue should play after recognition is actually active/ready
- `handleSttResult()`
  - success branch
  - canceled branch
  - timeout/no-usable-speech branch
  - generic error branch
- `stopCurrentInteraction()`
  - for manual stop/cancel while listening

No cue support exists today in assistant's native voice runtime.

---

## Reference Implementation in agent-voice-adapter

Reference repo:

- `/home/kevin/worktrees/agent-voice-adapter`

Key files:

- `android/app/src/main/java/com/agentvoiceadapter/android/VoiceAdapterService.kt`
- `android/app/src/main/java/com/agentvoiceadapter/android/PcmAudioPlayer.kt`
- `android/app/src/main/java/com/agentvoiceadapter/android/CuePlayer.kt`
- `android/app/src/main/java/com/agentvoiceadapter/android/AdapterConfig.kt`

### Important Findings from the Reference App

#### 1. Recognition cues are synthesized, not audio files

In `PcmAudioPlayer.kt`, recognition cues are generated as PCM tone data at runtime.

Relevant function:
- `generateCueProbePcmData(sampleRate: Int, success: Boolean)`

This uses a two-segment tone pattern with a short silence gap.

#### 2. There are effectively two recognition cue tones

Recognition cues are essentially:

- **positive / success cue**
  - ascending two-tone
- **negative / failure cue**
  - descending two-tone

The separate `CuePlayer.kt` ringtone-based implementation is for wake-intent notification sounds, not the recognition completion tones we are targeting here.

#### 3. Positive cue details

From `PcmAudioPlayer.kt`:

- 523.25 Hz for 95 ms at amplitude 0.14
- 55 ms silence
- 659.25 Hz for 140 ms at amplitude 0.16

This is the ascending / positive cue.

#### 4. Negative cue details

From `PcmAudioPlayer.kt`:

- 659.25 Hz for 105 ms at amplitude 0.14
- 55 ms silence
- 493.88 Hz for 140 ms at amplitude 0.16

This is the descending / negative cue.

#### 5. Completion cue playback path

In `VoiceAdapterService.kt`:

- `handleRecognitionCompletionCue(...)`
- `maybePlayRecognitionCue(...)`
- `playRecognitionCue(turnId, success)`
- `playRecognitionCueWithRetry(success, attempt)`

Important behavior:

- cues are played on the same media playback path as TTS
- capture is stopped before completion cue playback if needed
- playback may retry if focus/playback is temporarily unavailable
- a short delay is used after cue playback before returning to the next state

#### 6. Manual cue test

In `VoiceAdapterService.kt`:

- `playManualCue()` calls `playRecognitionCue(turnId = "manual", success = true)`

This confirms the positive cue is treated as the default recognition-completion/test cue.

---

## Architecture Comparison

The assistant native runtime is similar enough to the reference app that this should be implemented natively with close parity.

### Similarities

- foreground/background Android service
- native microphone streaming
- native PCM playback path
- `AudioTrack`-based media playback
- main-thread event dispatch
- native recognition lifecycle handling

### Differences

- assistant uses Java rather than Kotlin
- assistant's player/runtime are simpler than the adapter's
- assistant may not currently have the same audio focus handling sophistication
- assistant likely has a simpler one-request-at-a-time recognition model

### Conclusion

This is not just a conceptual match. It is a good candidate for a **direct native adaptation** of the recognition cue approach from `agent-voice-adapter`.

---

## Functional Requirements

### Required cue events

Implement cue playback for:

1. **Recognition ready/listening**
   - play positive cue once recognition is actually active and ready

2. **Recognition success**
   - play positive cue when STT succeeds with non-empty recognized text

3. **Timeout / no usable speech / empty transcript**
   - play negative cue

4. **Recognition error**
   - play negative cue

5. **Manual stop / cancel**
   - play negative cue when the active recognition flow is canceled/stopped by user action, if this event path is distinguishable and user-visible

### Config requirements

Add configuration for:

- `recognitionCueEnabled: boolean`
- `recognitionCueGain: float`

Behavior:

- if disabled, no cues should play
- gain should be bounded to a safe range
- default should be enabled with a sensible default gain

---

## Non-Goals

Do not implement in this task unless required by the discovered code path:

- web UI cue playback
- iOS cue playback
- wake-intent ringtone cues
- a large settings UI redesign
- per-event custom sound selection
- multiple cue modes beyond on/off + gain

---

## Recommended Implementation Shape

### 1. Add a native cue player class

Create a new native class, likely something like:

- `AssistantVoiceCuePlayer.java`

Responsibilities:

- synthesize positive and negative cue PCM
- play cue data on the native media path
- apply gain scaling
- optionally retry playback if the underlying player is temporarily unavailable

Preferred design:

- keep the cue generator self-contained
- port the tone-generation math directly from `agent-voice-adapter`'s `generateCueProbePcmData`
- preserve the same tone durations/frequencies unless a small adaptation is needed

### 2. Decide playback path

Two candidate approaches:

#### Option A: add cue support to `AssistantVoicePcmPlayer`

Add a method such as:

- `playCueProbe(boolean success)`

Pros:

- closest parity with `agent-voice-adapter`
- same playback path as speech audio
- less risk of device-specific route differences

Cons:

- touches the existing PCM player internals
- may require careful coordination with TTS / playback state

#### Option B: separate short-lived cue audio track

Let `AssistantVoiceCuePlayer` create/play a short-lived `AudioTrack` dedicated to cues.

Pros:

- more isolated
- simpler conceptual separation

Cons:

- less parity with reference app
- greater risk of route/focus inconsistencies
- may sound different on some devices

### Recommendation

Prefer **Option A** if practical: add a cue playback path to `AssistantVoicePcmPlayer` so cues use the same media output path as TTS, mirroring the reference app.

If that proves too invasive, fall back to Option B.

---

## Event Wiring Plan

### Recognition ready/listening cue

Hook in `startRecognition()`.

Requirement:
- play the positive cue only after the runtime has successfully entered the listening/ready state
- do not fire the cue before the mic/recognition setup has actually succeeded

### Recognition success cue

Hook in `handleSttResult()` success branch.

Requirement:
- only for successful, non-empty transcript results
- if mic capture is still active, stop capture before playing completion cue if necessary

### Timeout / no usable speech cue

Hook in `handleSttResult()` failure branch for:
- `no_usable_speech`
- `empty_transcript`
- timeout-equivalent result if present in assistant's native flow

Requirement:
- use the negative cue

### Generic recognition error cue

Hook in the error path in `handleSttResult()`.

Requirement:
- use the negative cue
- avoid double-playing if error and cancellation paths can both run for the same request

### Manual stop / cancel cue

Hook in `stopCurrentInteraction()` and/or canceled result path.

Requirement:
- use the negative cue
- ensure it plays once per stop/cancel outcome

---

## State and Deduplication Considerations

The reference app has more complexity because it tracks many turn ids and delayed cue playback states.

Assistant appears simpler, but we still need to prevent duplicates.

Add lightweight guard logic such as:

- a per-active-request cue state
- or a boolean that prevents both stop and result handlers from each playing a completion cue for the same recognition cycle

Questions implementation should resolve:

- Can `stopCurrentInteraction()` and `handleSttResult()` both run for the same stop path?
- Can success/error be emitted after the runtime has already transitioned away from listening?
- Do we need to defer cue playback until capture is fully stopped?

The final implementation should ensure exactly one completion cue per recognition attempt.

---

## Audio Coordination Considerations

### Mic / cue overlap

Completion cues should not fight with active capture.

Follow the reference pattern conceptually:

- if capture is still active, stop/finish capture first
- then play the completion cue

### TTS / cue overlap

Based on user feedback, this likely should not happen often because recognition is entered after TTS playback. Still, code should be defensive.

Preferred behavior:

- if TTS is still active, either ensure it has already transitioned out before recognition starts, or suppress/serialize cue playback cleanly

### Focus / route issues

Investigate whether assistant's current player already manages enough focus behavior for cues.

If not, consider:

- modest audio focus handling for cue playback
- retry behavior if immediate playback fails

Reference app behavior to mirror if needed:

- retry up to a few times with short backoff
- short post-cue delay before final state transition

---

## Configuration Plan

Add config fields in `AssistantVoiceConfig.java`.

Proposed fields:

- `recognitionCueEnabled`
- `recognitionCueGain`

Recommended defaults:

- enabled: `true`
- gain: `1.0`

Recommended bounds:

- clamp gain to something like `0.25f` to `5.0f`, matching the reference app unless assistant has a better established convention

Also ensure these values can flow through whatever config load/save path assistant already uses for native voice settings.

If there is a native settings UI or bridge surface already handling voice runtime config, update it too.

---

## Concrete Porting Guidance

### Code to port/adapt from agent-voice-adapter

#### Port directly or near-directly

From `PcmAudioPlayer.kt`:

- cue PCM generation logic
- gain resolution logic if useful
- fade envelope logic

From `VoiceAdapterService.kt`:

- the idea of stopping capture before playing completion cue
- the retry approach for playback failures
- the post-cue transition delay concept

#### Do not port wholesale

- turn-id map complexity for many simultaneous turns
- wake-intent ringtone cue logic unless explicitly wanted later
- media-inactive-only mode and other adapter-specific config unless justified

---

## Suggested Implementation Steps

1. **Inspect assistant native runtime in the worktree**
   - confirm exact package/class paths
   - confirm the success/error/cancel/no-speech flow in `AssistantVoiceRuntimeService.java`
   - confirm whether `AssistantVoicePcmPlayer` is the right extension point

2. **Add cue config fields**
   - extend `AssistantVoiceConfig.java`
   - load/save/propagate values as needed

3. **Implement cue synthesis**
   - port the positive/negative tone generation from `agent-voice-adapter`
   - keep code isolated and testable if possible

4. **Add cue playback support**
   - preferably in `AssistantVoicePcmPlayer`
   - return success/failure so the service can retry if needed

5. **Wire start cue**
   - only after recognition is truly active/ready

6. **Wire completion cues**
   - success → positive
   - timeout/no-speech → negative
   - error → negative
   - manual stop/cancel → negative

7. **Add dedupe/guard logic**
   - ensure one completion cue per recognition attempt

8. **Add retry/backoff if needed**
   - only if playback may fail transiently

9. **Validate on device**
   - ready cue audible
   - success cue audible
   - no-speech cue audible
   - error cue audible
   - manual stop cue audible
   - no duplicate cues
   - no broken TTS/mic behavior

10. **Document behavior**
   - note cue mapping and config fields
   - mention parity source in code comments if helpful

---

## Validation Checklist

### Functional

- [ ] Start/listening cue plays once when recognition is actually ready
- [ ] Success cue plays on successful speech recognition
- [ ] No-speech/empty-transcript cue plays and is negative
- [ ] Error cue plays and is negative
- [ ] Manual stop/cancel cue plays and is negative if that path is supported
- [ ] Disabled mode suppresses all cues
- [ ] Gain setting affects cue loudness

### Robustness

- [ ] No duplicate completion cues
- [ ] No crash if playback path unavailable
- [ ] No stuck state after cue playback
- [ ] No regression in TTS playback
- [ ] No regression in mic capture lifecycle

### UX

- [ ] Positive cue clearly sounds different from negative cue
- [ ] Start cue feels like “ready” not “success complete” in a confusing way
- [ ] Timeout/no-speech clearly sounds like failure/needs retry

---

## Open Questions for Implementer

These should be answered during implementation, but they should not block starting the work:

1. Should start and success use the exact same positive cue, or should start eventually get a distinct shorter ready cue?
   - For now, using the same positive cue is acceptable.

2. Does assistant already expose native voice config to a UI/settings surface?
   - If yes, add cue settings there.
   - If not, implement backend config support first.

3. Is cue playback best integrated into `AssistantVoicePcmPlayer`, or should it live in a separate playback helper?
   - Prefer the existing PCM player path if practical.

4. Are there any assistant-specific runtime transitions that would accidentally play both stop and error cues for the same event?
   - Add dedupe guards if needed.

---

## Recommendation

Implement this as a **native Android voice-runtime feature** in assistant, using the reference app's recognition cue design as the primary model.

Do not implement this first in the web layer.

Primary design recommendation:

- reuse the **same cue vocabulary** as the reference app
- port/adapt the **synthesized tone generation** directly
- wire cues to assistant's **native recognition lifecycle**
- expose **enabled + gain** config
- keep the implementation simple and native-service-centered

This gives the closest match to the desired UX and the cleanest architectural fit.
