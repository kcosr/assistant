# Changelog

## [Unreleased]

### Breaking Changes

- Removed `sessions.mirrorPiSessionHistory`; Pi-backed sessions now always persist canonical Pi JSONL history for replay, reload, and request-group editing.
- Changed the websocket protocol to require protocol version `5` and use `transcript_event` as the only event-stream server message; `chat_event` is no longer emitted or accepted in subscription masks.
- Removed coding-plugin sidecar mode and sidecar-specific config; coding tools now run locally from the session workspace through imported `@mariozechner/pi-coding-agent` tool implementations.
- Changed persisted panel layouts to use explicit `pane` nodes with pane-local tabs instead of leaf `panel` nodes and split-level tab mode, removing the split-view toggle command/tool from the panel workspace API.

### Added

- Added persistent `attachment_send` tool support with assistant-owned attachment storage, replayable attachment bubbles, download routes, HTML blob-open handling, and cleanup on session/history deletion. ([#83](https://github.com/kcosr/assistant/pull/83))
- Added configurable `attachment_send` preview snippet limits plus inline expand/collapse for truncated attachment previews in chat. ([#88](https://github.com/kcosr/assistant/pull/88))
- Added inline attachment copy actions for `attachment_send`, including plain-text copy and markdown plain/raw copy dropdowns in attachment bubbles.
- Added an animated activity bar above chat inputs while a bound session is busy.
- Added inline thumbnail previews and open actions for image attachments sent through `attachment_send`.
- Added in-app overlay viewing for inline image attachments, including thumbnail tap-to-open and a close button.
- Added rooted per-agent `contextFiles` prompt injection with config-relative roots, root-confined glob includes, startup preload caching, fail-fast file validation, and system-prompt insertion after instruction skills.
- Added Android native voice `TTS gain` settings with a 25%-500% playback control, Android PCM software gain, runtime gain reporting, and an Android source-tree `android:test` entrypoint that syncs Capacitor before Gradle tests. ([#87](https://github.com/kcosr/assistant/pull/87))
- Added Android native recognition cues with configurable cue gain and startup pre-roll settings, persistent notification toggles for media-button capture and `Off/Tool/Response` voice mode cycling, and a local spoken `stop` abort path. ([#89](https://github.com/kcosr/assistant/pull/89))
- Added lists item search support for filter-only queries, including normalized search filter inputs when no text query is provided. ([#89](https://github.com/kcosr/assistant/pull/89))
- Added installable PWA icons to the mobile web manifest so the mobile app can be added to a home screen with proper `any maskable` icon sizes from 48px through 512px.

### Changed
- Allowed Pi-backed agents to target custom `provider/model` ids through `chat.config.baseUrl` by
  synthesizing an `openai-responses` model when the provider has no built-in Pi model catalog.
- Changed Android share-intent chat destinations to prefer the configured native voice session
  while keeping the existing share destination modal and falling back to the chat session picker
  when no preferred session is set.
- Changed pane tab strips to use a dedicated horizontal scroll rail so long tab sets remain usable,
  especially on mobile.

- Changed coding plugin execution to source `bash`, `read`, `write`, `edit`, `ls`, `find`, and `grep` directly from `@mariozechner/pi-coding-agent` instead of assistant-local copied tool implementations.
- Changed coding tool registration to use a core `CodingToolHost` in the main tool catalog instead of routing coding tools through the plugin registry wrapper.
- Changed Pi session replay to project transcript events directly from canonical Pi JSONL instead of reconstructing ChatEvent history first.
- Changed live transcript_event delivery to project directly on the server with request-context tracking across batches instead of reusing replay batch projection.
- Changed the web client transcript renderer to consume projected transcript kinds directly instead of reconstructing legacy chat-event wrappers internally.
- Changed canonical Pi custom transcript entries to use explicit `assistant.<event_type>` records instead of the generic `assistant.event` envelope.
- Changed Pi session restore in SessionHub to load canonical Pi replay messages directly instead of reconstructing `chatMessages` through ChatEvent replay.
- Changed server-side Pi transcript persistence helpers to write canonical Pi custom entries directly instead of routing those writes through EventStore mirroring.
- Changed Pi questionnaire recovery to load canonical projected transcript events directly instead of reconstructing questionnaire state from Pi ChatEvent replay.
- Changed SessionHub to restore Pi-backed sessions only through canonical replay messages; `loadSessionEvents` no longer exposes Pi ChatEvent reconstruction on the runtime path.
- Changed Android flavor deploys to build from staged repo-local copies while treating `packages/mobile-web/android` as committed source, keeping tracked native files untouched during packaging. ([#85](https://github.com/kcosr/assistant/pull/85))
- Changed Android voice notifications to use a public lock-screen-visible channel, compact `Voice (State)` titles, and synced session titles for the preferred or active session. ([#86](https://github.com/kcosr/assistant/pull/86))
- Changed Android flavor staging to reuse installed `node_modules` instead of copying them into per-flavor staged builds. ([#86](https://github.com/kcosr/assistant/pull/86))
- Changed attachment MIME inference so files with unknown extensions download as `application/octet-stream` while extensionless text still defaults to `text/plain`. ([#83](https://github.com/kcosr/assistant/pull/83))
- Changed tool scoping so read-only `panels_tree` is treated like the existing always-available panel inspection tools, while mutating panel commands remain gated.
- Changed panel workspace layout and navigation to model tabs at the pane level, so center placement now tabs into the targeted pane directly and the UI exposes explicit pane/tab actions instead of split tab-mode toggles.
- Changed pane tab dragging so tabs can be reordered within a pane, detached into new splits, and dropped onto other panes as tabs.
- Changed pane-local add flows such as pane `+`, panel split actions, and `Ctrl+S` to use a compact in-pane panel picker when placement is already known, and allowed dragging lone pane tabs while leaving an `empty` placeholder behind in the source pane instead of collapsing that area.
- Changed `Ctrl+T` to open the compact add-tab picker for the active pane, and changed the top-row `+` button to use the same inline add-tab flow instead of the full global panel launcher.
- Changed panel keyboard controls so `Ctrl+M` now mirrors drag/drop more closely: it first targets another visible panel, then places the active panel `left/right/top/bottom/center` relative to that target, including center-to-tab moves.
- Changed compact in-pane panel pickers to show the current action in the header, submit directly from the focused row without redundant per-row add buttons, and use that same compact flow for inline panel replacement.
- Changed empty-pane and toolbar replace actions to use explicit compact replace pickers, and suspended background keyboard shortcuts while the compact picker is open so arrow keys and enter stay scoped to the picker.
- Changed compact panel pickers to keep a searchable filter input visible in compact mode, with keyboard navigation staying inside the picker while filtering.
- Changed newly created unbound chat panels to open the session picker without auto-focusing the chat input, and stopped merely selecting an existing chat panel from stealing focus into the composer.
- Changed mobile pane rendering to hide the tabs header when a pane only has a single tab.
- Changed the panels tool contract to be pane-aware, adding explicit window discovery, pane selection metadata, and `tab`/`split`/`header` modes for agent-driven layout commands instead of the older placement-only API.
- Changed user-message panel XML context to include `window-id`, `pane-id`, `pane-tab-count`, and `pane-tab-panel-ids` so agents can target the current pane and tab group directly.

### Fixed

- Fixed chat activity indicators so the input activity bar, chat-log typing dots, session panel busy state, and mic/stop button all derive from a single authoritative request-activity source — seeded from the transcript on the first load for a session and on reconnect, maintained by live WebSocket events afterwards — and no longer stick in a busy state after transcript refreshes, interrupted requests, or transient fetch failures. The mic/stop button stays responsive for voice input instead of trapping the user in a stop state that previously required restarting the app.
- Fixed attachment persistence to enforce the 4 MB size cap in the store as well as the tool layer, preventing oversized writes from non-tool callers. ([#83](https://github.com/kcosr/assistant/pull/83))
- Fixed Pi session sync replay drift that could duplicate persisted assistant reasoning/messages after callback history changes ([#81](https://github.com/kcosr/assistant/pull/81))
- Fixed Pi-backed active session attach/replay so a second client immediately replays the initial in-flight user turn instead of rendering a cut-off streamed transcript until refresh ([#81](https://github.com/kcosr/assistant/pull/81))
- Fixed Pi replay so late raw provider messages already mirrored into explicit app turns no longer get reassigned onto a newer turn during reload ([#82](https://github.com/kcosr/assistant/pull/82))
- Fixed interrupted Pi turns so visible aborted assistant output is synced into the Pi session file before turn close, preserving interrupted reload replay for assistant text, thinking, and tool-call content ([#82](https://github.com/kcosr/assistant/pull/82))
- Fixed direct Pi transcript persistence helpers to fall back cleanly when lightweight SessionHub shims do not expose cached-session accessors.
- Fixed systemd startup for Pi-backed sessions by removing top-level CommonJS requires of ESM-only `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` packages.
- Fixed live Pi transcript updates so normal session activity no longer resets the in-memory transcript revision and clears visible history on each new turn.
- Fixed native Pi tool execution to hydrate `requestId`/`responseId`/`turnId` from the active run at execute time, restoring `attachment_send` and other request-scoped tools.
- Fixed Pi transcript replay dropping visible user turns when canonical `user` messages coexisted with overlay request markers.
- Fixed live Pi submit handling so the sending client immediately receives request-start and user-turn transcript events instead of waiting for assistant output or refresh.
- Fixed refreshed Pi sessions so restored chat bindings are re-subscribed on websocket open and continue receiving live transcript updates without requiring another UI change.
- Fixed refreshed Pi sessions so replay hydration is single-flight and primes the live transcript sequence, preventing post-refresh live turns from wiping visible history or restarting transcript sequencing from zero.
- Fixed Pi coding-tool rendering so imported `bash`, `read`, `edit`, `find`, `grep`, and `ls` results use semantic output views again, including diff rendering for `edit` and actual stdout/file-content display for `bash` and `read`.
- Fixed assistant markdown code blocks to shrink-wrap to their content up to the available message width instead of always stretching full-width.
- Fixed refreshed Pi sessions so the next live turn re-aligns transcript revision and sequence from canonical Pi history before emitting websocket transcript events, preventing post-refresh submits from being dropped as stale.
- Fixed refreshed Pi sessions so a mid-stream reload reconstructs the active in-flight turn from transient live transcript state on the first refresh without persisting streaming chunk noise into the Pi session log.
- Fixed refreshed Pi transcript delivery so pre-runtime live events buffer instead of being dropped and live sequence gaps trigger a forced transcript reload instead of leaving the page stranded on a stale in-flight turn.
- Fixed refreshed Pi subscriptions so `hello` and `subscribe` re-seed live transcript state from canonical Pi history before marking the session ready, preventing mid-stream reloads from attaching to stale sequence state.
- Fixed Pi mid-stream replay after refresh so the sessions replay path shares the same in-flight live transcript overlay state as the websocket runtime, restoring already-streamed chunks on the first reload.
- Fixed native Pi tool streaming so cumulative partial tool output is converted into true deltas instead of duplicating earlier lines until the final tool result arrives.
- Fixed live Pi assistant and request-end transcript emission to bypass the old EventStore gate, restoring immediate in-page rendering of submitted turns instead of only showing them after replay refresh.
- Fixed Pi live transcript revision handling so ordinary session revision bumps no longer make the client reset to only the newest turn during live rendering.
- Fixed Pi request-history replay after middle-request deletion so partial `providers.pi-cli` transcript revision aliases no longer hide the canonical Pi session file and collapse the visible transcript to zero events.
- Fixed canonical Pi replay so duplicate request-start markers no longer orphan the active request/response state or split later tool activity onto a fresh synthetic response.
- Fixed coding-plugin startup under systemd by loading ESM-only `@mariozechner/pi-coding-agent` through its installed runtime entrypoint instead of emitting a top-level CommonJS package require.
- Fixed Pi transcript/session cleanup so clearing a Pi-backed session removes provider transcript metadata entirely, Pi agent subscription failures surface as normal run errors, and mixed-revision buffered replay now forces a reload instead of silently dropping buffered events.
- Fixed refreshed Pi transcript buffering so reset replay treats already-covered buffered events as stale, preventing same-revision overlap from trapping the client in an infinite replay/reload loop and flashing the chat view.
- Fixed refreshed Pi transcript hydration so replay marks hydration complete before flushing buffered live events, preventing `assistant_done` and `request_end` from getting stranded until a later reload.
- Fixed live `agents_message` rendering so Pi tool transcript events keep `tool_call` ahead of `tool_result`, preventing async agent exchanges from showing raw JSON input/output until refresh.
- Fixed live Pi bash tool input streaming so tool input chunks use end offsets consistently, preventing reload-during-run cases from dropping the opening command text and rendering only a trailing fragment like `}`.
- Fixed interrupted Pi transcript sync so late raw provider-tail messages are dropped from canonical replay sync, logged into the Pi transcript as visible warnings, and replayed against the explicit request they still belong to instead of creating a fake new in-flight turn.
- Fixed Pi `openai-codex` OAuth resolution so the native Pi runtime reads `~/.pi/agent/auth.json` directly again, canonicalizes OAuth provider ids, and exposes the resolved key through `pi-agent-core`'s `getApiKey` path instead of depending on `pi-coding-agent` `AuthStorage`.
- Fixed Pi request-history `trim_after` edits so they remove orphan conversational tail entries outside explicit request markers, and clear stale client typing/request state before the forced transcript reload.
- Fixed attachment metadata corruption from concurrent `attachment_send` calls by serializing per-session attachment mutations and writing `metadata.json` atomically, preventing inline preview failures and 500 download/open responses.
- Fixed live tool-input rendering so streamed partial JSON for tools like `bash`, `write`, `read`, `find`, `grep`, and `agents_message` is rendered from semantic partial arguments instead of raw JSON until the final tool call arrives.
- Fixed filesystem-backed `attachment_send` calls to accept relative paths resolved from the session working directory, matching the cwd-oriented behavior of Pi coding tools.
- Fixed Pi-path tool execution to invoke resolved native `AgentTool`s directly during runs and nested `agents_message` flows instead of bouncing back through `ToolHost.callTool(...)`.
- Fixed sender-side session typing indicators so transcript replay no longer re-applies stale optimistic local typing after a turn has already completed.
- Fixed unbound chat panel creation so launcher-created chat panes explicitly auto-open the session picker on mount instead of relying on focus timing.
- Fixed chat tab and session-label hydration so bound chat panels refresh from session names immediately after binding and on page-load session summary sync instead of waiting for a later click-triggered rerender.
- Fixed chat title refresh so routine `session_updated` syncs no longer force a full workspace rerender when a panel title has not actually changed.
- Fixed chat transcript auto-scroll so loading a chat panel, selecting a session, and replaying the latest transcript settle fully to the bottom instead of stopping slightly above the newest messages.
- Fixed workspace panel command handling to understand the pane-aware panel tool payloads for tab insertion, split creation, header pinning, and pane-targeted moves.
- Fixed headless `sessions_message` tool exposure so agent turns now preserve scheduled-sessions and search services when building native agent tools, restoring `scheduled_sessions_*` tool execution in assistant-agent runs.
- Fixed plugin operation tool schemas to preserve advanced JSON Schema fields like `$defs`, `$ref`, and `allOf`, and updated the questions tool manifest to use `$defs` refs so questionnaire tool exposure no longer fails with unresolved `#/definitions/field` references.

### Removed

- Removed legacy Pi session replay support for assistant-specific `assistant.input` and `assistant.turn_*` entries; canonical Pi history now expects request boundaries and model-visible agent inputs as normal `message` records.
- Removed attachment-store `turnId` metadata; attachments are now owned only by `requestId` plus `toolCallId`.
- Removed dead Pi EventStore overlay mirroring; Pi sessions now ignore EventStore persistence on the canonical path instead of duplicating overlay writes into the Pi transcript log.
- Removed the dead Pi `ChatEvent` reconstruction helper and stale Pi history-provider test matrix; Pi replay validation now targets canonical transcript projection only.
- Removed Pi replay support for legacy assistant overlay custom entries; canonical replay now restores only from canonical Pi `message` records plus request-boundary markers.

## [0.17.5] - 2026-04-01

### Breaking Changes

### Added

### Changed

### Fixed

- Fixed PI replay so async questionnaire callback answers persist into later provider requests instead of disappearing after the immediate follow-up turn. ([#80](https://github.com/kcosr/assistant/pull/80))

### Removed

## [0.17.4] - 2026-04-01

### Breaking Changes

### Added

### Changed

- Changed PI replay and history reconstruction to keep interrupted visible user turns, preserve interrupted assistant text when it was shown to the user, and align replay sequencing more closely with upstream PI session behavior.

### Fixed

- Fixed interrupted PI tool turns so replay no longer drops remembered requests, duplicates completed tool activity, or sends orphaned tool results on the next provider request.

### Removed

## [0.17.3] - 2026-03-31

### Breaking Changes

### Added

### Changed

- Changed the new session modal skills picker to add `Select all` and `Select none` bulk actions while preserving the implicit all-skills default when everything is selected. ([#78](https://github.com/kcosr/assistant/pull/78))

### Fixed

### Removed

## [0.17.2] - 2026-03-31

### Breaking Changes

### Added

- Added a live title/agent filter to the scheduled sessions panel. ([#76](https://github.com/kcosr/assistant/pull/76))

### Changed

### Fixed

- Fixed the scheduled sessions panel scrolling and refined it into a flatter compact collapsed-by-default layout. ([#76](https://github.com/kcosr/assistant/pull/76))
- Fixed PI-backed chat runs so backend timeouts/errors close turns durably, sync wrapper timeouts abort the underlying run, and PI replay preserves assistant narration and thinking ordering after refresh. ([#77](https://github.com/kcosr/assistant/pull/77))

### Removed

## [0.17.1] - 2026-03-31

### Breaking Changes

### Added

### Changed

### Fixed

- Fixed mobile session long-press actions so the session context menu no longer closes immediately after opening. ([#75](https://github.com/kcosr/assistant/pull/75))

### Removed

## [0.17.0] - 2026-03-31

### Breaking Changes

- Changed the websocket protocol to require protocol version `3` with structured `hello.subscriptions` and optional per-session subscription masks; legacy v1/v2 hello flows are no longer accepted. ([#73](https://github.com/kcosr/assistant/pull/73))

### Added

- Added masked websocket session subscriptions so clients can subscribe per session with server-side event filtering instead of always receiving the full session stream. ([#73](https://github.com/kcosr/assistant/pull/73))
- Added native voice preferred-session routing so Android can watch multiple sessions, persist a `Voice notification session`, and route notification `Speak` to that preferred session while foreground mic input still targets the current chat. ([#73](https://github.com/kcosr/assistant/pull/73))
- Added per-panel custom rename support with persisted `customTitle` overrides and a panel-menu rename action. ([#73](https://github.com/kcosr/assistant/pull/73))
- Added an opt-in `Auto-title chats, lists, and notes` client preference that synthesizes entity-aware panel titles such as `Test Chat` and `Todo List (Scratch)`. ([#73](https://github.com/kcosr/assistant/pull/73))

### Changed

- Changed panel title resolution so tabs, panel headers, navigator labels, panel inventory/context, and pinned-panel labels share the same resolved display title. ([#73](https://github.com/kcosr/assistant/pull/73))
- Changed turn-history `Delete after` to remove the clicked turn as well as the later turns, matching the chat divider semantics more intuitively. ([#73](https://github.com/kcosr/assistant/pull/73))

### Fixed

- Fixed Codex/CLI session replay so completed turns are not duplicated on reload and aborted or cancelled turns close cleanly instead of leaving replayed typing state stuck. ([#73](https://github.com/kcosr/assistant/pull/73))

### Removed

## [0.16.1] - 2026-03-31

### Breaking Changes

### Added

- Added an Android native cold-start backend chooser with persisted saved backends, last-used selection, and pre-bootstrap backend handoff to the web client. ([#72](https://github.com/kcosr/assistant/pull/72))

### Changed

### Fixed

- Fixed voice settings so the adapter URL field no longer resets to the previous value when it loses focus. ([#72](https://github.com/kcosr/assistant/pull/72))

### Removed

## [0.16.0] - 2026-03-31

### Breaking Changes

### Added

- Added Android native voice playback and recognition support for assistant voice tool prompts and final response playback, including foreground-service runtime handling and mobile voice bridge integration. ([#71](https://github.com/kcosr/assistant/pull/71))
- Added unified voice settings with `Audio Mode`, `Auto-listen`, adapter URL, microphone input selection, and per-request recognition timing controls in the web/mobile client. ([#71](https://github.com/kcosr/assistant/pull/71))
- Added compact Android notification `Speak` and `Stop` actions for the native voice runtime so manual listen and active playback/listening control are available directly from the persistent notification. ([#71](https://github.com/kcosr/assistant/pull/71))

### Changed

- Changed chat rendering and replay so `voice_speak`, `voice_ask`, and `user_audio` render as dedicated voice bubbles, spoken input keeps its typing/interruption state across reloads, and in-progress native/tool turns replay correctly. ([#71](https://github.com/kcosr/assistant/pull/71))
- Changed backend session/audio handling so spoken submits publish `user_audio`, `sessions.message` advertises audio-submit metadata, and replay/projection paths treat spoken input consistently with normal user text. ([#71](https://github.com/kcosr/assistant/pull/71))

### Fixed

### Removed

## [0.15.3] - 2026-03-30

### Breaking Changes

### Added

- Added durable async questionnaires with late submission replay, follow-up callback turns, and dedicated questionnaire submit/cancel websocket flows. ([#70](https://github.com/kcosr/assistant/pull/70))

### Changed

- Changed `questions_ask` to default to async submission flow, simplified the public tool surface, and clarified the agent-facing questionnaire schema guidance for field types and `{ label, value }` option objects. ([#70](https://github.com/kcosr/assistant/pull/70))
- Changed assistant message streaming to progressively re-render markdown again in the active chat renderer while leaving tool output rendering unchanged. ([#70](https://github.com/kcosr/assistant/pull/70))

### Fixed

- Fixed questionnaire replay/rendering so submitted async forms stay disabled with submitted values, show a post-turn submission indicator, and avoid unnecessary questionnaire DOM rebuilds on completion. ([#70](https://github.com/kcosr/assistant/pull/70))
- Fixed lists item action menus to close again after row actions, outside clicks, and Escape following the shared context-menu manager refactor for Pi turn history menus. ([#70](https://github.com/kcosr/assistant/pull/70))

### Removed

- Removed the unused legacy `MessageRenderer` path from the web client now that the unified `ChatRenderer` is the only production chat transcript renderer. ([#70](https://github.com/kcosr/assistant/pull/70))

## [0.15.2] - 2026-03-29

### Breaking Changes

### Added

- Added explicit Pi session `assistant.turn_start` / `assistant.turn_end` markers plus Pi-backed session history edit operations for trimming before/after a turn or deleting a specific turn. ([#69](https://github.com/kcosr/assistant/pull/69))
- Added clickable turn timestamp dividers with chat turn history actions for trimming surrounding turns, deleting a turn, or resetting transcript history. ([#69](https://github.com/kcosr/assistant/pull/69))

### Changed

- Changed chat web/mobile typography to use a 13px shared base size with tighter tool header padding, including an Android-specific tool-header spacing adjustment for WebView. ([#68](https://github.com/kcosr/assistant/pull/68))
- Changed Pi callback and interrupted-run persistence so callback turns and interrupted turns close cleanly inside explicit Pi turn boundaries. ([#69](https://github.com/kcosr/assistant/pull/69))

### Fixed

- Fixed interrupted turn indicators to sit below message content without the old overlap/indent styling. ([#69](https://github.com/kcosr/assistant/pull/69))
- Fixed legacy Pi transcript replay to start a fresh turn for each unmarked user message so older sessions do not collapse multiple user turns under one divider. ([#69](https://github.com/kcosr/assistant/pull/69))
- Fixed chat transcript scrolling regressions by removing the experimental turn-windowing path while keeping tool-output hydration/dehydration and streaming rendering optimizations. ([#68](https://github.com/kcosr/assistant/pull/68))
- Fixed bash tool formatted input rendering to show the shell command as the primary expanded view while keeping the JSON toggle available for the full argument payload. ([#68](https://github.com/kcosr/assistant/pull/68))

### Removed

- Removed the unused chat turn-windowing runtime and DOM wrapper from the web client pending a future revisit. ([#68](https://github.com/kcosr/assistant/pull/68))

## [0.15.1] - 2026-03-29

### Breaking Changes

### Added

- Added Pi-backed session context usage summaries with persisted available-context percentages, compact badges in chat headers and session rows, and warning/error badge colors based on remaining context. ([#67](https://github.com/kcosr/assistant/pull/67))
- Added desktop Tauri webview zoom hotkeys so `Cmd/Ctrl +/-` style zoom shortcuts work in desktop builds. ([#67](https://github.com/kcosr/assistant/pull/67))

### Changed

- Updated the `Dark` theme to use a true neutral dark palette inspired by TermStation, and renamed the previous warm tan-accent variant to `Warm Dark`. ([#67](https://github.com/kcosr/assistant/pull/67))
- Refined the session composer UI on mobile with a slightly shorter modal, a scrollable skills list, and a simpler `Fixed` working-directory badge label. ([#67](https://github.com/kcosr/assistant/pull/67))

### Fixed

- Fixed `write` tool formatted input rendering to show plain file content with preserved newlines instead of the full JSON payload, while keeping the JSON toggle available. ([#67](https://github.com/kcosr/assistant/pull/67))

### Removed

## [0.15.0] - 2026-03-29

### Breaking Changes

- Removed static `agents[].schedules` config; scheduled sessions now load only from the scheduled-sessions plugin store under `data/plugins/scheduled-sessions/default/schedules.json`. ([#66](https://github.com/kcosr/assistant/pull/66))
- Removed legacy `agents[].sessionWorkingDirMode` / `sessionWorkingDirRoots` in favor of a single `agents[].sessionWorkingDir` object with `none`, `fixed`, and `prompt` modes. ([#66](https://github.com/kcosr/assistant/pull/66))

### Added

- Added root `clean` and `build:clean` scripts for maintainers who need a full rebuild from a scrubbed workspace. ([#65](https://github.com/kcosr/assistant/pull/65))
- Added runtime-managed scheduled session CRUD through the scheduled-sessions service plus generated plugin tools, HTTP operations, and CLI commands. ([#66](https://github.com/kcosr/assistant/pull/66))
- Added fixed agent working-directory support through `sessionWorkingDir`, so agents can either prompt for a directory or automatically use a configured path. ([#66](https://github.com/kcosr/assistant/pull/66))
- Added shared `sessionConfig` support for manual session creation and scheduled sessions, covering model, thinking, working directory, and selected skills within agent-defined capability bounds, plus explicit session titles for manual session creation. ([#66](https://github.com/kcosr/assistant/pull/66))
- Added agent `sessionConfigCapabilities` metadata to the agents API so the UI can discover per-agent model, thinking, skill, and working-directory options without conflating capabilities with chosen session config. ([#66](https://github.com/kcosr/assistant/pull/66))
- Added a shared session composer modal for creating one-off sessions or scheduled sessions with the same agent-driven `sessionConfig` options, including working-directory selection, model/thinking overrides, skills, and schedule fields. ([#66](https://github.com/kcosr/assistant/pull/66))
- Added active-session editing through the shared session composer, including title, working directory, model, thinking, and selected skills for existing sessions. ([#66](https://github.com/kcosr/assistant/pull/66))

### Changed

- Changed lists move/copy target menus to follow the current browser sort mode instead of always sorting alphabetically. ([#65](https://github.com/kcosr/assistant/pull/65))
- Changed lists item listing and search defaults to return up to 100 items when no explicit limit is provided. ([#65](https://github.com/kcosr/assistant/pull/65))
- Updated `@mariozechner/pi-ai` in `@assistant/agent-server` to the latest 0.62.x release. ([#65](https://github.com/kcosr/assistant/pull/65))
- Changed Pi-backed OpenAI Responses transcript handling to preserve assistant text `phase` metadata (`commentary`, `final_answer`) across session replay and Pi session writes. ([#65](https://github.com/kcosr/assistant/pull/65))
- Changed scheduled sessions to support `reuseSession`, use generated plugin operations for API/CLI access, and show `sessionTitle` as the primary human-readable name in the panel. ([#66](https://github.com/kcosr/assistant/pull/66))
- Changed scheduled sessions to persist runtime create/update/delete/enable/disable state in the scheduled-sessions plugin data directory, and only start the scheduler when the plugin is enabled. ([#66](https://github.com/kcosr/assistant/pull/66))
- Changed schedule-backed reused sessions to be created up front, keep explicit `sessionTitle` as the session name, and reconcile stored `sessionConfig` back into the backing session on later runs after edits. ([#66](https://github.com/kcosr/assistant/pull/66))
- Changed the agent sidebar, session picker, and scheduled sessions panel to launch the shared session composer instead of using separate create flows. ([#66](https://github.com/kcosr/assistant/pull/66))

### Fixed

- Fixed chat panels to clear stale typing/stop-output state after mobile backgrounding and reconnects, so completed sessions no longer stay stuck busy until the app is fully reopened. ([#66](https://github.com/kcosr/assistant/pull/66))
- Fixed shared session composer skill selection so explicit empty selections persist correctly, agent-default selections stay implicit, and session picker edit actions consistently open the full session editor flow. ([#66](https://github.com/kcosr/assistant/pull/66))
- Fixed lists browser-mode shared search Escape handling so pressing Escape a second time blurs the search input after clearing. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed modal lists panels to close on Escape from list mode instead of switching to browser mode. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed confirm dialog button flows leaving `hasOpenDialog` stuck true, which could disable keyboard shortcuts until refresh. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed lists bulk selection to use a longer hold-without-movement selection mode while preserving short-hold drag, made selected rows more prominent across platforms, and kept bulk Actions menus in sync with the current selection. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed markdown preparation to stop auto-closing unmatched underscore emphasis markers. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed Pi-backed transcript replay and live rendering to keep commentary/final assistant text segments separate without polluting generic summaries or non-Pi replay contexts. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed Pi-backed session reloads to preserve tool-call message boundaries so later syncs do not drop user turns or reorder tool history after a restart/reload. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed Pi-backed chat runs to use the canonical Pi session transcript for replay instead of the flattened generic message projection, and limited final message/sidebar snippet text to the final-answer block rather than merged commentary text. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed Pi-backed chat runs to keep canonical Pi replay messages local to the provider request path instead of overwriting the shared generic session message state. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed interrupted chat runs to persist partial streamed assistant text as interrupted transcript history while still excluding it from replay and generic summary projections. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed session model and thinking changes to apply on the next turn without cancelling the currently running response. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed multiplexed websocket chat runs to resolve tool exposure from the target session on each turn instead of reusing a per-connection primary-session tool cache that could go stale or stay empty after reconnects. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed multiplexed websocket runtimes to stop carrying a mutable primary-session binding for chat turn routing, model updates, and tool debug context now that sessions are handled explicitly by target session id. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed generic chat-message reconstruction to regroup contiguous tool calls from the same response into a single assistant tool-call message instead of replaying them as separate sequential assistant messages. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed canonical Pi replay to preserve all `final_answer` text blocks in order instead of dropping later blocks after the first one. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed Android share-target cold starts to retain the first incoming share until the web app listener is ready. ([#65](https://github.com/kcosr/assistant/pull/65))
- Removed the unused `removeKeydownOnButtonClick` confirm-dialog option and its stale call-site usage. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed Pi/OpenAI debug logging to write redacted request/response payloads to a dedicated JSONL file under the server data directory for easier replay debugging. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed live Pi/Anthropic assistant streaming to stop duplicating final rendered text when streamed deltas were phase-tagged but the closing `assistant_done` event was unphased, and added temporary client/server debug tracing for websocket assistant text events. ([#65](https://github.com/kcosr/assistant/pull/65))
- Added a developer script to verify that replayed Pi/OpenAI request inputs preserve prior request items exactly as prefixes when debugging session history. ([#65](https://github.com/kcosr/assistant/pull/65))
- Added per-request tool-resolution debug metadata to Pi/OpenAI request logs so disappearing tool schemas can be traced to cached-tool reuse, per-turn refreshes, zero visible tools, or tool-host failures. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed CLI-backed chat runs to resolve `${session.workingDir}` in interactive `workdir` and wrapper env config so session-picked working directories reach spawned CLI processes and container wrappers. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed local coding-plugin tools to honor `${session.workingDir}` in `plugins.coding.local.workspaceRoot`, so relative file operations and `bash` commands run from the session-picked working directory in non-sidecar mode. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed Pi session syncing to avoid appending the same completed assistant turn twice when first-turn replay state aliases the live session message array, which could later trigger duplicate replay item id errors. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed scheduled session persistence to store `schedules.json` under the scheduled-sessions plugin `default` instance directory so plugin git versioning snapshots include scheduler changes. ([#66](https://github.com/kcosr/assistant/pull/66))
- Fixed lists keyboard move shortcuts (`t`, `b`, `w`, `s`) to preserve the current row selection across both rerenders and same-list refresh reloads when the move changes item order. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed lists `w`/`s` move shortcuts to use neighboring stored item positions instead of visible row indexes, so moves keep working in lists where completed items or historical reorder drift make those values diverge. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed raw list-search ArrowUp/ArrowDown to blur the shared search input and hand control back to list navigation when tag suggestions are not active. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed list delete shortcuts so `Delete` and `Backspace` trigger the same selected-item delete flow as `d`. ([#65](https://github.com/kcosr/assistant/pull/65))
- Fixed lists keyboard move shortcuts to keep the moved item scrolled into view after rerenders and same-list refresh reloads. ([#65](https://github.com/kcosr/assistant/pull/65))

### Removed

## [0.14.6] - 2026-03-09

### Breaking Changes

### Added

### Changed

- Changed desktop build variants to support an env-configurable default backend URL via `ASSISTANT_DESKTOP_DEFAULT_BACKEND_URL` (default build falls back to `https://assistant`; work build sets `https://assistant/assistant-work`). ([#63](https://github.com/kcosr/assistant/pull/63))

### Fixed

### Removed

## [0.14.5] - 2026-03-08

### Breaking Changes

### Added

### Changed

- Updated `@mariozechner/pi-ai` dependency in `@assistant/agent-server` to `^0.57.1`. ([#62](https://github.com/kcosr/assistant/pull/62))

### Fixed

- Fixed `@assistant/agent-server` startup failures with Pi SDK `0.57.1` by lazy-loading Pi SDK modules in the CommonJS runtime. ([#62](https://github.com/kcosr/assistant/pull/62))

### Removed

## [0.14.4] - 2026-03-07

### Breaking Changes

### Added

### Changed

- Changed list/note item tag chip clicks to apply global AQL with a configurable behavior setting (`Append with AND` or `Replace query`). ([#61](https://github.com/kcosr/assistant/pull/61))

### Fixed

### Removed

## [0.14.3] - 2026-03-07

### Breaking Changes

### Added

- Added reverse proxy sub-path support: auto-detect base path from page URL for API requests, WebSocket connections, and static assets when served behind a proxy at a sub-path (for example `/assistant`). ([#60](https://github.com/kcosr/assistant/pull/60))
- Added a mobile build flavor system (`flavors.json` + `npm run flavor`) to support side-by-side app installs with different app IDs and API hosts. ([#60](https://github.com/kcosr/assistant/pull/60))
- Added automated Android flavor deployment scripts (`android:deploy:flavors`, `android:deploy:default`, `android:deploy:work`) to rebuild/install selected flavors on all connected ADB devices. ([#60](https://github.com/kcosr/assistant/pull/60))

### Changed

- Changed `npm run flavor` to list available flavors when no flavor name is provided. ([#60](https://github.com/kcosr/assistant/pull/60))

### Fixed

- Fixed static asset loading (`config.js`, `client.js`) behind reverse-proxy sub-path deployments by using relative script paths in `index.html`. ([#60](https://github.com/kcosr/assistant/pull/60))
- Fixed `apiFetch` to prepend the detected base path for absolute-path API requests when `ASSISTANT_API_HOST` is not set. ([#60](https://github.com/kcosr/assistant/pull/60))

### Removed

## [0.14.2] - 2026-02-22

### Breaking Changes

- Changed exported plugin skill names and generated plugin CLI executable names to use the `assistant-` prefix (for example `assistant-notes` and `assistant-notes-cli`). ([#66](https://github.com/kcosr/assistant/pull/66))

### Added

### Changed

- Updated `@mariozechner/pi-ai` dependency in `@assistant/agent-server` to `^0.54.0`. ([#66](https://github.com/kcosr/assistant/pull/66))
- Raised the root Node.js engine requirement to `>=20.18.1` to match transitive `undici` runtime requirements. ([#66](https://github.com/kcosr/assistant/pull/66))

### Fixed

- Fixed generated skill/plugin CLIs to preserve path-prefixed `ASSISTANT_URL` values when calling plugin operations. ([#66](https://github.com/kcosr/assistant/pull/66))
- Fixed time tracker timer starts to use the client-local `entry_date` so late-night entries remain visible under "Today" when server and client time zones differ. ([#66](https://github.com/kcosr/assistant/pull/66))

### Removed

## [0.14.1] - 2026-02-09

### Breaking Changes

### Added

- Added session rename mirroring into Pi session JSONL (`session_info`) for Pi-backed sessions (`pi`, `pi-cli`). ([#55](https://github.com/kcosr/assistant/pull/55))

### Changed

### Fixed

- Fixed session model/thinking updates to cancel active chat runs to avoid stuck queued messages. ([#54](https://github.com/kcosr/assistant/pull/54))
- Fixed Android/Capacitor lifecycle to release window profile leases on background and reuse the last-used profile on relaunch. ([#55](https://github.com/kcosr/assistant/pull/55))
- Fixed Android/Capacitor resume to refresh bound chat transcripts without a full page reload. ([#55](https://github.com/kcosr/assistant/pull/55))
- Fixed aborted runs to drop a dangling user message when aborting before assistant output. ([#55](https://github.com/kcosr/assistant/pull/55))

### Removed

## [0.14.0] - 2026-02-04

### Breaking Changes

- Removed `openai` and `openai-compatible` chat providers; use `pi` instead. ([#50](https://github.com/kcosr/assistant/pull/50))
- Removed managed container mode for the coding plugin; sidecar must be externally managed and connected via socket/TCP. ([#51](https://github.com/kcosr/assistant/pull/51))
- Removed `sessionId` from the coding sidecar API and executor interface; all operations use the workspace root. ([#51](https://github.com/kcosr/assistant/pull/51))

### Added

- Added Pi SDK-backed `pi` chat provider for in-process completions. ([#50](https://github.com/kcosr/assistant/pull/50))
- Added Pi SDK session mirroring to the pi-mono JSONL format for CLI resume. ([#50](https://github.com/kcosr/assistant/pull/50))
- Added Pi SDK debug logging for requests/responses when `DEBUG_CHAT_COMPLETIONS` is enabled. ([#50](https://github.com/kcosr/assistant/pull/50))
- Added configurable Pi tool-iteration limit (default 100) with an error when exceeded. ([#50](https://github.com/kcosr/assistant/pull/50))
- Added automatic OAuth credential reuse from `~/.pi/agent/auth.json` for `anthropic` and `openai-codex` providers. ([#50](https://github.com/kcosr/assistant/pull/50))
- Added connect-only coding sidecar configuration (Unix socket or TCP) with optional auth. ([#51](https://github.com/kcosr/assistant/pull/51))
- Added rename/clear/delete actions to the session picker (desktop hover icons; touch sub-menu). ([#52](https://github.com/kcosr/assistant/pull/52))
- Added per-agent instruction skills discovery + prompt inclusion via `agents[].skills` (Pi-style `<available_skills>` + inline `<skill>` blocks). ([#52](https://github.com/kcosr/assistant/pull/52))
- Added per-agent working directory picker options for new session creation. ([#53](https://github.com/kcosr/assistant/pull/53))

### Changed

- Changed default chat provider to `pi` and pass model/thinking selection through to Pi. ([#50](https://github.com/kcosr/assistant/pull/50))
- Made Pi session mirror files configurable via `sessions.mirrorPiSessionHistory` (default true). ([#50](https://github.com/kcosr/assistant/pull/50))
- Changed coding-sidecar build to emit a bundled server artifact. ([#51](https://github.com/kcosr/assistant/pull/51))
- Changed Pi provider (`pi`) reload/history replay to use Pi session JSONL (and mirror overlay/callback/interrupt events) instead of verbose EventStore logs. ([#52](https://github.com/kcosr/assistant/pull/52))
- Changed working directory picker to list immediate subfolders and show folder names; selection adds project directory to the system prompt. ([#53](https://github.com/kcosr/assistant/pull/53))

### Fixed

- Fixed Pi SDK history replay to preserve reasoning items for OpenAI Responses tool calls. ([#50](https://github.com/kcosr/assistant/pull/50))
- Fixed Pi SDK session mirroring to include aborted/canceled turns for pi-mono resume. ([#50](https://github.com/kcosr/assistant/pull/50))
- Fixed Pi session mirroring to avoid orphan tool results that break Pi-native session replay. ([#52](https://github.com/kcosr/assistant/pull/52))
- Fixed Pi session `/events` replay returning an empty transcript before Pi session metadata exists. ([#52](https://github.com/kcosr/assistant/pull/52))
- Fixed OpenAI Responses history replay to avoid reusing `function_call` item ids without their paired `reasoning` item. ([#52](https://github.com/kcosr/assistant/pull/52))
- Fixed coding executor absolute path handling when paths already point within the workspace root. ([#53](https://github.com/kcosr/assistant/pull/53))
- Fixed lists panel flashing "Loading list" placeholder on load. ([#53](https://github.com/kcosr/assistant/pull/53))
- Fixed session history replay/cancel handling (skip aborted turns, avoid logging interrupts without output). ([#53](https://github.com/kcosr/assistant/pull/53))
- Fixed session clear to drop provider history metadata and reset Pi JSONL replay. ([#53](https://github.com/kcosr/assistant/pull/53))
- Fixed time tracker range picker to use click-based start/end selection with reset-on-next-click behavior for desktop and mobile. ([#58](https://github.com/kcosr/assistant/pull/58))
- Fixed toolbar dropdown menus to stay within viewport height and scroll when content is long. ([#58](https://github.com/kcosr/assistant/pull/58))
- Fixed mobile header toolbar alignment so the right-side icon group remains right-aligned when the global AQL center section is hidden. ([#58](https://github.com/kcosr/assistant/pull/58))

### Removed

## [0.13.0] - 2026-02-01

### Breaking Changes

### Added

- Added favorites for lists and notes with a heart indicator and `/favorites` command palette view. ([#46](https://github.com/kcosr/assistant/pull/46))
- Added build-service configuration for TypeScript remote builds. ([#46](https://github.com/kcosr/assistant/pull/46))
- Added `build:parallel` and `build:remote` scripts for parallel/remote builds. ([#46](https://github.com/kcosr/assistant/pull/46))
- Added keyboard shortcut registry with panel-scoped resolution and per-device binding overrides. ([#47](https://github.com/kcosr/assistant/pull/47))
- Added core services keyboard shortcut registration for panel plugins. ([#47](https://github.com/kcosr/assistant/pull/47))
- Added chat panel shortcuts for session picker/model/thinking selectors when input is not focused. ([#47](https://github.com/kcosr/assistant/pull/47))
- Added a generic instance/profile selector shortcut for the active panel header. ([#47](https://github.com/kcosr/assistant/pull/47))
- Added last-used panel shortcuts for artifacts/chat/diff/files/lists/notes/sessions/time tracker (Ctrl+A/C/D/F/L/N/S/T), persisted locally, and opens a modal panel if none exist. ([#47](https://github.com/kcosr/assistant/pull/47))
- Added a global command palette FAB on mobile/Capacitor layouts. ([#48](https://github.com/kcosr/assistant/pull/48))
- Added a global Ctrl+X shortcut to close or remove the active panel. ([#48](https://github.com/kcosr/assistant/pull/48))
- Added support for multiple window profiles with window-aware panel routing. ([#49](https://github.com/kcosr/assistant/pull/49))
- Added a global AQL header bar for window-scoped filtering. ([#49](https://github.com/kcosr/assistant/pull/49))

### Changed

- Changed lists and notes panels to register shortcuts through the shared registry. ([#47](https://github.com/kcosr/assistant/pull/47))
- Changed time tracker dialogs to register Escape handling through the shortcut registry. ([#47](https://github.com/kcosr/assistant/pull/47))
- Changed shortcut binding overrides to support stable binding ids for per-plugin keybinding preferences. ([#47](https://github.com/kcosr/assistant/pull/47))
- Changed Ctrl+I to toggle chat input focus instead of always focusing. ([#47](https://github.com/kcosr/assistant/pull/47))
- Changed active chat panels to use the same selection highlight as other panels. ([#47](https://github.com/kcosr/assistant/pull/47))
- Changed split shortcut to Ctrl+S and removed Ctrl+S sessions focus. ([#48](https://github.com/kcosr/assistant/pull/48))

### Fixed

- Fixed instance dropdown keyboard focus after selecting items with Enter. ([#47](https://github.com/kcosr/assistant/pull/47))
- Fixed focus history to ignore modal-only panels. ([#47](https://github.com/kcosr/assistant/pull/47))
- Fixed time tracker dialog escape handlers to clean up on unmount. ([#47](https://github.com/kcosr/assistant/pull/47))
- Fixed lists AQL toolbar layout to avoid squeezing the search input on mobile. ([#48](https://github.com/kcosr/assistant/pull/48))
- Fixed panel selection highlight to appear on mobile. ([#48](https://github.com/kcosr/assistant/pull/48))

### Removed

## [0.12.0] - 2026-01-27

### Breaking Changes

### Added

- Added reference custom field type for list items with a picker and navigation. ([#40](https://github.com/kcosr/assistant/pull/40))
- Added time tracker reported flag and XLSX export with artifacts upload. ([#42](https://github.com/kcosr/assistant/pull/42))
- Added client-side note search filtering in the time tracker panel. ([#42](https://github.com/kcosr/assistant/pull/42))
- Added AQL `~` operator and `text` pseudo-field for cross-field text search. ([#44](https://github.com/kcosr/assistant/pull/44))
- Added `a` keyboard shortcut to toggle AQL in lists. ([#44](https://github.com/kcosr/assistant/pull/44))
- Added Android back button handling for Capacitor overlays and modal navigation. ([#45](https://github.com/kcosr/assistant/pull/45))

### Changed

- Changed AQL status hint copy when clearing a query. ([#44](https://github.com/kcosr/assistant/pull/44))
- Changed Escape to close pinned or modal chat panels without canceling active chat operations. ([#45](https://github.com/kcosr/assistant/pull/45))
- Changed Android back button fallback to open the command palette when nothing else is open. ([#45](https://github.com/kcosr/assistant/pull/45))

### Fixed

- Fixed review-mode custom field listener handling when inputs are missing. ([#41](https://github.com/kcosr/assistant/pull/41))
- Fixed time tracker created-at date formatting showing the year instead of day. ([#41](https://github.com/kcosr/assistant/pull/41))
- Fixed artifacts instance listing to include configured instances. ([#42](https://github.com/kcosr/assistant/pull/42))
- Fixed list drag-and-drop reorder positions and cross-list insert hinting. ([#43](https://github.com/kcosr/assistant/pull/43))
- Fixed lists panel to clear prior AQL input and apply list defaults when switching lists. ([#44](https://github.com/kcosr/assistant/pull/44))

### Removed

## [0.11.0] - 2026-01-26

### Breaking Changes

### Added

- Added AQL search mode for lists with structured filters, ordering, column visibility overrides, and saved queries with defaults. ([#37](https://github.com/kcosr/assistant/pull/37))
- Added server-side AQL queries and panel apply tooling for lists. ([#39](https://github.com/kcosr/assistant/pull/39))
- Added list item editor review mode with report-style layout, markdown previews, inline field edits, and a default mode setting. ([#38](https://github.com/kcosr/assistant/pull/38))

### Changed

- Changed list view preferences to persist per-panel instead of `/preferences`. ([#37](https://github.com/kcosr/assistant/pull/37))
- Changed list item single-click setting to a dropdown (none/select/open edit modal/open review). ([#38](https://github.com/kcosr/assistant/pull/38))
- Changed list item review mode inline edits to replace previews with inline editors, allow canceling text edits, use shared markdown rendering with collapsible sections, and render markdown custom fields full-width; renamed Quick edit to Edit. ([#38](https://github.com/kcosr/assistant/pull/38))

### Fixed

### Removed

## [0.10.0] - 2026-01-25

### Breaking Changes

### Added

- Added list item drag export blocks for external drop targets. ([#27](https://github.com/kcosr/assistant/pull/27))
- Added Cmd/Ctrl+X/C/V cut/copy/paste shortcuts for list items across lists. ([#27](https://github.com/kcosr/assistant/pull/27))
- Added interactive tool approvals and questionnaires with an interactive-mode toggle. ([#28](https://github.com/kcosr/assistant/pull/28))
- Added Ctrl+S split placement shortcut for panels (arrows/WASD selection, empty placeholder). ([#29](https://github.com/kcosr/assistant/pull/29))
- Added questions plugin with schema-driven questionnaires, including initial values and required indicators. ([#30](https://github.com/kcosr/assistant/pull/30))
- Added first-class interaction pending events for interactive tools. ([#30](https://github.com/kcosr/assistant/pull/30))
- Added quick-add (+) action in the lists dropdown to add items without switching lists. ([#31](https://github.com/kcosr/assistant/pull/31))

### Changed

- Changed CLI providers to inject `ASSISTANT_SESSION_ID` and default plugin CLIs to read it when `--session-id` is omitted. ([#30](https://github.com/kcosr/assistant/pull/30))
- Changed questionnaire inputs to use themed styling. ([#30](https://github.com/kcosr/assistant/pull/30))
- Changed questionnaire blocks to match tool output width, improve checkbox alignment, and allow flexible input sizing. ([#32](https://github.com/kcosr/assistant/pull/32))
- Changed questionnaire UX to auto-focus pending inputs on render (desktop), return focus to the main input on submit/cancel, and submit on Enter with Shift+Enter newline in textareas. ([#32](https://github.com/kcosr/assistant/pull/32))
- Changed list item custom fields to use a responsive grid layout in the add/edit dialog. ([#33](https://github.com/kcosr/assistant/pull/33))
- Changed new unbound chat panels to auto-open the session picker. ([#33](https://github.com/kcosr/assistant/pull/33))
- Changed list metadata custom field rows to align actions in a compact layout. ([#33](https://github.com/kcosr/assistant/pull/33))

### Fixed

- Fixed HTTP plugin operations to allow interactive requests when a session id is provided. ([#30](https://github.com/kcosr/assistant/pull/30))
- Fixed interactive tool rendering/grouping/pending-state handling, including refresh replay for approvals/questionnaires. ([#30](https://github.com/kcosr/assistant/pull/30))
- Fixed CLI interactive tool replay ordering/persistence by aligning overlay interactions with CLI tool calls when response/turn ids are missing. ([#30](https://github.com/kcosr/assistant/pull/30))
- Fixed CLI questionnaire/approval rendezvous between HTTP interactions and CLI tool calls. ([#30](https://github.com/kcosr/assistant/pull/30))
- Fixed mobile WebSocket reconnection getting stuck after backgrounding by forcing a resume reconnect. ([#34](https://github.com/kcosr/assistant/pull/34))

### Removed

## [0.9.0] - 2026-01-24

### Breaking Changes

### Added

- Added inline editing for select and checkbox custom fields in list rows. ([#24](https://github.com/kcosr/assistant/pull/24))
- Added custom field reorder controls in the list metadata dialog. ([#24](https://github.com/kcosr/assistant/pull/24))
- Added mobile lists search FAB that opens the command palette. ([#25](https://github.com/kcosr/assistant/pull/25))
- Added optional description field for notes with UI support and search matching. ([#26](https://github.com/kcosr/assistant/pull/26))
- Added list item move up/down shortcuts (w/s) in list view. ([#26](https://github.com/kcosr/assistant/pull/26))
- Added command palette sort/group modes for search results. ([#26](https://github.com/kcosr/assistant/pull/26))

### Changed

- Changed command palette list item results to use a check icon distinct from list titles. ([#24](https://github.com/kcosr/assistant/pull/24))
- Changed pinned icon to 📍. ([#26](https://github.com/kcosr/assistant/pull/26))
- Changed list title sorting to prioritize pinned items. ([#26](https://github.com/kcosr/assistant/pull/26))
- Changed panel navigation shortcuts to Ctrl+P / Ctrl+H. ([#26](https://github.com/kcosr/assistant/pull/26))
- Changed Ctrl+P/Ctrl+H to work even when no panel is active. ([#26](https://github.com/kcosr/assistant/pull/26))
- Changed command palette shortcut to support Ctrl+K on macOS alongside Cmd+K. ([#26](https://github.com/kcosr/assistant/pull/26))
- Changed header panel navigation so ArrowDown confirms selection. ([#26](https://github.com/kcosr/assistant/pull/26))
- Changed notes panel to support `f` as a search focus shortcut. ([#26](https://github.com/kcosr/assistant/pull/26))

### Fixed

- Fixed markdown fade/preview affordance not recalculating after list column resize. ([#24](https://github.com/kcosr/assistant/pull/24))
- Fixed notes search input not blurring on Escape when empty. ([#26](https://github.com/kcosr/assistant/pull/26))
- Fixed Ctrl+P/Ctrl+H not toggling while panel navigation mode is active. ([#26](https://github.com/kcosr/assistant/pull/26))
- Fixed shared search input arrow keys moving list/note items while focused. ([#26](https://github.com/kcosr/assistant/pull/26))
- Fixed command palette Escape handling to prevent closing underlying modal panels. ([#26](https://github.com/kcosr/assistant/pull/26))

### Removed

## [0.8.0] - 2026-01-23

### Breaking Changes

### Added

- Added temporary pinned behavior for lists, list items, and notes using the pinned tag (icons, shortcuts, /pinned palette entry). ([#22](https://github.com/kcosr/assistant/pull/22))
- Added markdown rendering for text custom fields (metadata toggle, multiline editor input, notes-style preview popup). ([#23](https://github.com/kcosr/assistant/pull/23))

### Changed

- Changed command palette to open with the command list (no auto `/`) and added tag-only search syntax for lists/notes. ([#22](https://github.com/kcosr/assistant/pull/22))
- Changed palette-launched lists/notes to avoid auto-focusing the panel search input. ([#22](https://github.com/kcosr/assistant/pull/22))

### Fixed

- Fixed palette-launched list items to select the target row and open the correct profile. ([#22](https://github.com/kcosr/assistant/pull/22))
- Fixed pinned shortcut updates to avoid reloading the entire list view. ([#22](https://github.com/kcosr/assistant/pull/22))

### Removed

## [0.7.0] - 2026-01-22

### Breaking Changes

### Added

- Added floating add-item button in lists view for Capacitor builds and small viewports. ([#21](https://github.com/kcosr/assistant/pull/21))
- Added browser-mode keyboard navigation for list/note collections (arrow keys/Enter, Escape to return). ([#21](https://github.com/kcosr/assistant/pull/21))
- Added sticky list column headers during list scrolling. ([#21](https://github.com/kcosr/assistant/pull/21))
- Added list column resizing with per-panel column width persistence. ([#21](https://github.com/kcosr/assistant/pull/21))

### Changed

- Changed list arrow-key navigation to stop at the first/last item. ([#21](https://github.com/kcosr/assistant/pull/21))
- Changed list and note dialog sizing to sit higher and allow taller content before scrolling. ([#21](https://github.com/kcosr/assistant/pull/21))
- Changed list/note browser list view selection to show an outline on the active item. ([#21](https://github.com/kcosr/assistant/pull/21))

### Fixed

- Fixed list/note browser focus to stay on the active item when returning from detail view. ([#21](https://github.com/kcosr/assistant/pull/21))

### Removed

## [0.6.0] - 2026-01-22

### Breaking Changes

### Added

- Added list keyboard navigation and shortcuts (selection, edit, complete, add, move, delete, search focus). ([#20](https://github.com/kcosr/assistant/pull/20))

### Changed

- Added global setting for list single-click selection and refined click behavior. ([#20](https://github.com/kcosr/assistant/pull/20))

### Fixed

- Fixed notes/lists context to use the active item instance id. ([#20](https://github.com/kcosr/assistant/pull/20))

### Removed

## [0.5.0] - 2026-01-22

### Breaking Changes

- Require non-default plugin instances to be declared in `profiles`. ([#19](https://github.com/kcosr/assistant/pull/19))

### Added

- Added shared profiles config plus multi-profile selection (with instance badges) in notes and lists panels. ([#19](https://github.com/kcosr/assistant/pull/19))
- Added search plugin wrapper exposing global search via tools/CLI. ([#19](https://github.com/kcosr/assistant/pull/19))
- Added profile selector to list and note editors when multiple profiles are selected. ([#19](https://github.com/kcosr/assistant/pull/19))
- Added lists move operation for moving lists between profiles. ([#19](https://github.com/kcosr/assistant/pull/19))
- Added "Open modal" option to panel Add dropdown for opening panels as modals. ([#19](https://github.com/kcosr/assistant/pull/19))

### Changed

- Search API now accepts `profiles` and `plugin` query parameters. ([#19](https://github.com/kcosr/assistant/pull/19))
- Instance dropdown multi-select now keeps the menu open for additions and uses per-row clear/exclusive selection behavior. ([#19](https://github.com/kcosr/assistant/pull/19))
- Instance badges now sit inline with item titles and use a distinct style from tags. ([#19](https://github.com/kcosr/assistant/pull/19))
- Command palette `/search` flow now selects profile first, then plugin, with plugin lists filtered by profile. ([#19](https://github.com/kcosr/assistant/pull/19))
- Command palette opens with Search preselected and "All" labels for profile/plugin pickers. ([#19](https://github.com/kcosr/assistant/pull/19))

### Fixed

- Fixed lists edit modal not removing custom field values when cleared (select set to "Select...", text/number cleared, checkbox unchecked).

### Removed

## [0.4.1] - 2026-01-21

### Added

- Added cross-list drag-and-drop moves for list items. ([#18](https://github.com/kcosr/assistant/pull/18))

## [0.4.0] - 2026-01-21

### Added

- Added mobile web Capacitor icon generation using the desktop app icon for Android/iOS builds. ([#17](https://github.com/kcosr/assistant/pull/17))
- Added artifacts plugin for sharing files between agents and users, including panel UI, CLI, and server operations. ([#17](https://github.com/kcosr/assistant/pull/17))
- Added custom plugin CLI bundling support for plugins that ship a `bin/cli.ts` entry point. ([#17](https://github.com/kcosr/assistant/pull/17))

### Changed

- Added `extraHttpRoutes` for operations-based plugins to support binary download endpoints alongside JSON operations. ([#17](https://github.com/kcosr/assistant/pull/17))
- Artifacts file download endpoint now supports inline viewing by default with `?download=1` to force attachment. ([#17](https://github.com/kcosr/assistant/pull/17))
- Added Tauri native save dialog and Capacitor filesystem/share support for artifact downloads. ([#17](https://github.com/kcosr/assistant/pull/17))
- Artifacts panel selection now contributes context to chat input (cmd/ctrl-click or long press). ([#17](https://github.com/kcosr/assistant/pull/17))
- Disabled text selection on touch for artifacts rows to allow long-press selection. ([#17](https://github.com/kcosr/assistant/pull/17))

### Fixed

- Fixed artifacts panel theme colors to use shared `--color-*` variables for light/dark themes. ([#17](https://github.com/kcosr/assistant/pull/17))

## [0.3.2] - 2026-01-20

### Changed

- List rows can now be dragged from the row surface while keeping title text and tag badges selectable.

### Fixed

- Chat panel model/thinking selectors now wrap with other header controls in compact layouts.
- Prevented text selection during list row drag and avoided touch selection when dragging.
- List drag reorder now inserts correctly when dragging upward and keeps client positions aligned.

## [0.3.1] - 2026-01-20

### Changed

- ESC now stops streaming in chat header/modals before closing panels. ([#15](https://github.com/kcosr/assistant/pull/15))

### Fixed

- Notes search now matches note titles as well as content. ([#15](https://github.com/kcosr/assistant/pull/15))
- Chat panels auto-scroll to the most recent messages when opened. ([#15](https://github.com/kcosr/assistant/pull/15))
- Chat panels reset busy indicators when switching sessions. ([#15](https://github.com/kcosr/assistant/pull/15))
- Fixed release script to include desktop version files in the release commit. ([#14](https://github.com/kcosr/assistant/pull/14))

## [0.3.0] - 2026-01-19

### Added

- Added CLI model selection plus thinking controls for Pi/Codex with provider-aware Pi model parsing. ([#13](https://github.com/kcosr/assistant/pull/13))

### Fixed

- Fixed session list updates for sessions created via the sessions plugin. ([#12](https://github.com/kcosr/assistant/pull/12))

## [0.2.0] - 2026-01-18

### Added

- Added Pi session history provider with chat replay/refresh support and default Pi session file lookup. ([#9](https://github.com/kcosr/assistant/pull/9))
- Added Claude session history provider with chat replay from Claude session files. ([#10](https://github.com/kcosr/assistant/pull/10))

### Changed

- Changed history persistence routing to be provider-agnostic for external history providers. ([#9](https://github.com/kcosr/assistant/pull/9))

### Fixed

- Fixed notes search launches to switch instances before opening a note. ([#11](https://github.com/kcosr/assistant/pull/11))
- Fixed Pi history tool call extraction to show tool names and inputs from Pi session logs. ([#9](https://github.com/kcosr/assistant/pull/9))
- Fixed Pi tool output streaming to surface incremental tool updates in chat. ([#9](https://github.com/kcosr/assistant/pull/9))
- Code blocks in markdown now have proper contrast in all light themes via CSS variables for syntax highlighting. ([#8](https://github.com/kcosr/assistant/pull/8))
- Note edit textarea now expands to fill available panel space instead of fixed small height. ([#8](https://github.com/kcosr/assistant/pull/8))
- Synced Tauri version files (Cargo.toml, tauri.conf.json) to 0.1.3. ([#8](https://github.com/kcosr/assistant/pull/8))

### Removed

- Removed legacy conversation transcript store in favor of event logs. ([#9](https://github.com/kcosr/assistant/pull/9))
- Removed `pi-cli` sessionDir/sessionDirCli config options in favor of default Pi session directories. ([#9](https://github.com/kcosr/assistant/pull/9))

## [0.1.3] - 2026-01-16

### Added

- Global search command palette with scoped search and modal/pin launch actions. ([#7](https://github.com/kcosr/assistant/pull/7))
- Search providers for notes and lists, including list name matches and scoped title browse. ([#7](https://github.com/kcosr/assistant/pull/7))
- Modal panel overlay support. ([#7](https://github.com/kcosr/assistant/pull/7))

## [0.1.2] - 2026-01-15

### Changed

- Time tracker "Stop & Save" button now uses red styling to indicate a destructive action. ([#5](https://github.com/kcosr/assistant/pull/5))
- Time tracker entries now display creation timestamp (MM/YY HH:mm) alongside notes. ([#5](https://github.com/kcosr/assistant/pull/5))
- Roll out shared panel chrome rows across panels and plugins. ([#6](https://github.com/kcosr/assistant/pull/6))

## [0.1.1] - 2026-01-13

### Changed

- Start continuous listening as soon as the long-press threshold is reached. ([#4](https://github.com/kcosr/assistant/pull/4))

### Fixed

- Reduce TTS scheduling churn by sending larger PCM frames to clients. ([#4](https://github.com/kcosr/assistant/pull/4))
- Stream TTS playback through an AudioWorklet ring buffer to avoid long-response choppiness. ([#4](https://github.com/kcosr/assistant/pull/4))
- Delay continuous listening re-arm until TTS playback completes (with a short grace window). ([#4](https://github.com/kcosr/assistant/pull/4))
- Avoid blocking Tauri startup on proxy config and add HTTP proxy timeouts. ([#4](https://github.com/kcosr/assistant/pull/4))
- Set the API host during mobile sync so Capacitor builds do not fall back to localhost. ([#4](https://github.com/kcosr/assistant/pull/4))

## [0.1.0] - 2026-01-13

### Added

- Support environment variable substitution (`${VAR}`) in all config string values, not just specific fields. ([#1](https://github.com/kcosr/assistant/pull/1))
- Add scheduled sessions for cron-driven agent runs with plugin UI, API, and configurable auto titles. ([#2](https://github.com/kcosr/assistant/pull/2))
- Added the desktop/Tauri package with local proxy and plugin asset sync support. ([#3](https://github.com/kcosr/assistant/pull/3))

### Changed

- Updated web-client proxy normalization and plugin bundle loading for desktop/Tauri. ([#3](https://github.com/kcosr/assistant/pull/3))

### Fixed

- Fixed drag/drop drop-target indicators and focus marker reordering in desktop webviews. ([#3](https://github.com/kcosr/assistant/pull/3))
- Fixed speech recognition permission errors to disable input cleanly on desktop. ([#3](https://github.com/kcosr/assistant/pull/3))
- Fixed sessions panel rendering when mounted as a standard panel in web/Tauri layouts. ([#2](https://github.com/kcosr/assistant/pull/2))

## [0.0.1] - 2026-01-11

### Added

- Added multi-instance support for the lists plugin.
