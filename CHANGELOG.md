# Changelog

## [0.1.3] - 2026-01-16

### Breaking Changes

### Added

- Global search command palette with scoped search and modal/pin launch actions. ([#7](https://github.com/kcosr/assistant/pull/7))
- Search providers for notes and lists, including list name matches and scoped title browse. ([#7](https://github.com/kcosr/assistant/pull/7))
- Modal panel overlay support. ([#7](https://github.com/kcosr/assistant/pull/7))

### Changed

### Fixed

### Removed

## [0.1.2] - 2026-01-15

### Breaking Changes

### Added

### Changed

- Time tracker "Stop & Save" button now uses red styling to indicate a destructive action. ([#5](https://github.com/kcosr/assistant/pull/5))
- Time tracker entries now display creation timestamp (MM/YY HH:mm) alongside notes. ([#5](https://github.com/kcosr/assistant/pull/5))
- Roll out shared panel chrome rows across panels and plugins. ([#6](https://github.com/kcosr/assistant/pull/6))

### Fixed

### Removed

## [0.1.1] - 2026-01-13

### Breaking Changes

### Added
### Changed

- Start continuous listening as soon as the long-press threshold is reached. ([#4](https://github.com/kcosr/assistant/pull/4))

### Fixed

- Reduce TTS scheduling churn by sending larger PCM frames to clients. ([#4](https://github.com/kcosr/assistant/pull/4))
- Stream TTS playback through an AudioWorklet ring buffer to avoid long-response choppiness. ([#4](https://github.com/kcosr/assistant/pull/4))
- Delay continuous listening re-arm until TTS playback completes (with a short grace window). ([#4](https://github.com/kcosr/assistant/pull/4))
- Avoid blocking Tauri startup on proxy config and add HTTP proxy timeouts. ([#4](https://github.com/kcosr/assistant/pull/4))
- Set the API host during mobile sync so Capacitor builds do not fall back to localhost. ([#4](https://github.com/kcosr/assistant/pull/4))

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

- Added multi-instance support for the lists plugin.

### Changed

### Fixed

### Removed
