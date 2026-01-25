# Changelog

## [Unreleased]

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
