# Gemini Feedback: Pi Native Agent Core Migration Review

A comprehensive review of the `feat/pi-native-agent-core` branch was conducted against the implementation plan (`PLAN.md` and `implementation-checklist.md`), test suite, and type/lint checkers.

Here is a summary of the design issues, fragility, and bugs found in the current state of the branch:

## 1. Design & Architectural Deviations

### Incomplete "Strip" Phase & Lingering Shared Abstraction
- **Issue:** The `PLAN.md` identifies the "shared abstraction tax" between providers as a key problem and dictates that `pi-cli`, `claude-cli`, `codex-cli`, and legacy TTS should be removed entirely during the cutover. A new, greenfield `piNativeChat.ts` module was planned to encapsulate the `@mariozechner/pi-agent-core` `Agent` class.
- **Reality:** Instead of deleting `chatRunCore.ts` and isolating the native path, `chatRunCore.ts` was mutated to host the new `Agent` loop *inline* with the legacy CLI paths (e.g., `resolveChatProvider`, `resolveCliModelForRun`, `claudeCliChat`, etc.). This violates the "clean separation" goal and keeps the legacy shared abstraction active.

### EventStore Cutover Incomplete
- **Issue:** The checklist specifies removing the `EventStore` dependency for pi-native sessions.
- **Reality:** Test files such as `packages/plugins/core/agents/server/index.test.ts` still instantiate and assign `eventStore`, resulting in unused variable linting errors. This indicates that while it might be removed from the main execution path, the teardown of the old replay dependency is incomplete.

## 2. Bugs & Test Failures

Running `npm run test` revealed three failing tests directly related to the migration changes:

### `clearSession` Metadata Leak
- **Location:** `packages/agent-server/src/sessionHub.test.ts` (`SessionHub clearSession > clears provider history metadata and Pi session file`)
- **Issue:** The test expects the session's provider history metadata (`attributes.providers`) to be completely `undefined` after clearing a session. However, it receives `{ pi: { transcriptRevision: 2 }, 'pi-cli': { ... } }`. The migration to `piSessionWriter.clearSession` logic is failing to properly wipe out these attributes from the `SessionIndex`.

### `agents_message` Protocol Break (`exchangeId` Leak)
- **Location:** `packages/plugins/core/agents/server/index.test.ts`
  - `triggers a new turn in the calling session on async callback when caller is idle`
  - `queues async callbacks when the calling session is busy`
- **Issue:** The new design introduces a durable cross-session `exchangeId` for `agents_message` invocations. However, this causes tests to fail because `agentMessageContext.callbackEvent` now unexpectedly contains `exchangeId` alongside `messageId`. Either the test suite needs to be updated to expect this structural change, or the `exchangeId` is leaking into the callback payload when it shouldn't be.

## 3. Code Quality & Fragility

Running `npm run lint` flagged 56 errors, heavily clustered around the migration paths:

- **Dead Code Accumulation:** There are significant `@typescript-eslint/no-unused-vars` warnings for variables that belonged to the old loop. For instance, `chatCompletionTools` and `handleChatToolCalls` in `chatRunCore.ts`, and `DEFAULT_PI_REQUEST_TIMEOUT_MS`.
- **Type Safety Degradation:** There is an increase in `@typescript-eslint/no-explicit-any` usage within `chatRunCore.ts`, `piAgentAuth.ts`, and `piSdkProvider.ts`.
- **Missing NPM Script:** There is no `npm run typecheck` script configured in the root `package.json`, making it difficult to run fast, project-wide TypeScript assertions without doing a full multi-package build (`npm run build:parallel`). Adding `"typecheck": "tsc -b"` or similar would improve CI stability.

## Conclusion
The core runtime integration with `@mariozechner/pi-agent-core` compiles successfully and most of the tests pass. However, the branch currently sits in an intermediate state where legacy systems (`chatRunCore.ts`, CLI providers) have not been fully stripped, leading to architectural debt, dead code, and broken session teardown/messaging tests.
