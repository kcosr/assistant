# Changelog

## [Unreleased]

### Breaking Changes

### Added
### Changed

- Start continuous listening as soon as the long-press threshold is reached. ([#000](<pr-url>))

### Fixed

- Reduce TTS scheduling churn by sending larger PCM frames to clients. ([#000](<pr-url>))
- Stream TTS playback through an AudioWorklet ring buffer to avoid long-response choppiness. ([#000](<pr-url>))
- Delay continuous listening re-arm until TTS playback completes (with a short grace window). ([#000](<pr-url>))
- Avoid blocking Tauri startup on proxy config and add HTTP proxy timeouts. ([#000](<pr-url>))

### Removed

## [0.1.0] - 2026-01-13

### Breaking Changes

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
### Removed

## [0.0.1] - 2026-01-11

### Breaking Changes

### Added

- Added multi-instance support for the lists plugin. ([#000](<pr-url>))

### Changed

### Fixed

### Removed
