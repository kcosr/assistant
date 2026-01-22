# Changelog

## [Unreleased]

### Breaking Changes
- Require non-default plugin instances to be declared in `profiles`. ([#000](<pr-url>))

### Added
- Added shared profiles config plus multi-profile selection (with instance badges) in notes and lists panels. ([#000](<pr-url>))
- Added search plugin wrapper exposing global search via tools/CLI. ([#000](<pr-url>))
- Added profile selector to list and note editors when multiple profiles are selected. ([#000](<pr-url>))
- Added lists move operation for moving lists between profiles. ([#000](<pr-url>))
- Added "Open modal" option to panel Add dropdown for opening panels as modals. ([#000](<pr-url>))

### Changed
- Search API now accepts `profiles` and `plugin` query parameters. ([#000](<pr-url>))
- Instance dropdown multi-select now keeps the menu open for additions and uses per-row clear/exclusive selection behavior. ([#000](<pr-url>))
- Instance badges now sit inline with item titles and use a distinct style from tags. ([#000](<pr-url>))
- Command palette `/search` flow now selects profile first, then plugin, with plugin lists filtered by profile. ([#000](<pr-url>))
- Command palette opens with Search preselected and "All" labels for profile/plugin pickers. ([#000](<pr-url>))

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
