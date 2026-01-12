# Desktop – Tauri Build

This package contains the Tauri scaffolding to build the AI Assistant web client (`packages/web-client/public`) as a native desktop application for macOS, Windows, and Linux.

## Table of Contents

- [Layout](#layout)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Development](#development)
- [Production Build](#production-build)
- [Configuration](#configuration)
- [Icons](#icons)

## Layout

- `desktop/` – Tauri project root
- `desktop/src-tauri/` – Rust backend and Tauri configuration
- `desktop/src-tauri/icons/` – App icons for all platforms

## Prerequisites

- Node.js 20+ and npm
- Rust toolchain (stable) – install via [rustup](https://rustup.rs/)
- Platform-specific dependencies:

### macOS

- Xcode Command Line Tools: `xcode-select --install`

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Windows

- Microsoft Visual Studio C++ Build Tools
- WebView2 (usually pre-installed on Windows 10/11)

## Initial Setup

First, build the web client:

```bash
cd packages/web-client
npm run build
```

Then install Tauri CLI dependencies:

```bash
cd packages/desktop
npm install
```

## Development

Run in development mode with hot reload:

```bash
npm run tauri:dev
```

This will:

1. Build the web client into `packages/web-client/public`
2. Build plugin bundles into `dist/plugins` for the backend
3. Copy plugin bundles into `packages/web-client/public/plugins` for local loading
4. Start the Tauri development server
5. Open the desktop app window
6. Watch for changes in `web-client/public`

## Production Build

Build the production app bundle:

```bash
npm run tauri:build
```

This runs the web client build first, then packages the desktop app.
It also rebuilds plugin bundles into `dist/plugins` so panel bundles match the frontend API logic.
Plugin bundles are copied into `packages/web-client/public/plugins` so Tauri loads them locally.

Output locations:

- **macOS**: `src-tauri/target/release/bundle/macos/Assistant.app`
- **Windows**: `src-tauri/target/release/bundle/msi/` or `nsis/`
- **Linux**: `src-tauri/target/release/bundle/deb/` or `appimage/`

## Configuration

### Backend URL

The desktop app can connect to any Assistant backend. Configure via:

1. **Default**: Uses `window.ASSISTANT_API_HOST` from `web-client/public/config.js`
2. **Runtime**: The app persists settings to `~/.local/share/com.assistant.desktop/settings.json` (Linux) or equivalent platform paths

`window.ASSISTANT_API_HOST` can be either a host (`assistant`) or a full URL (`https://assistant/api`).
To force HTTP/WebSocket (no TLS) for local development, set:

```javascript
window.ASSISTANT_API_HOST = 'localhost:3000';
window.ASSISTANT_INSECURE = true;
```

The Rust backend exposes these Tauri commands:

- `get_backend_url()` – Get current backend URL
- `set_backend_url(url)` – Set and persist backend URL
- `get_settings()` – Get all app settings

In desktop builds, the Rust proxy overrides the frontend config at runtime and
sets `window.ASSISTANT_API_HOST`, `window.ASSISTANT_INSECURE`, and `window.ASSISTANT_WS_PORT`
to the local proxy values. Use the settings UI or the Tauri commands above to
change the upstream backend the proxy connects to.

### Integrating with Web Client

To use the Tauri-persisted backend URL, add this to your web client initialization:

```javascript
// Check if running in Tauri
if (window.__TAURI__) {
  const { invoke } = window.__TAURI__.core;
  const backendUrl = await invoke('get_backend_url');
  if (backendUrl) {
    window.ASSISTANT_API_HOST = backendUrl;
  }
}
```

## Icons

App icons are generated from `icon.svg`. To regenerate after modifying the SVG:

```bash
npm run icons:generate
```

This creates all required formats in `src-tauri/icons/`:

- PNG sizes: 32x32, 128x128, 256x256, 512x512
- Windows: icon.ico + Square\*Logo.png variants
- macOS: icon.icns

Alternatively, generate from any source image using Tauri CLI:

```bash
npm run tauri:icon path/to/source-icon.png
```

## Notes

- Web assets are loaded directly from `../web-client/public` as configured in `tauri.conf.json`
- The `src-tauri/target/` and `src-tauri/gen/` directories are gitignored
- For local development with a local backend, run `agent-server` separately and configure the URL
- On macOS, the app requests Microphone and Speech Recognition permissions when you use voice input
