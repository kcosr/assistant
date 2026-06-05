# Desktop

This package is the canonical desktop app for Assistant. It uses Electron and
bundles Chromium so the desktop runtime does not depend on the platform WebView.

During the migration, the previous Tauri implementation remains buildable from
`packages/desktop-tauri`.

## Development

```bash
cd packages/desktop
npm run electron:dev
```

This builds the web client, builds plugin bundles, copies plugin web assets into
`packages/web-client/public/plugins`, builds the Electron main/preload scripts,
and opens the desktop window.

## Production Build

```bash
cd packages/desktop
npm run electron:build
```

The default Electron build uses the canonical desktop identity:

- Product name: `Assistant`
- App ID: `com.assistant.desktop`
- Default backend URL: `https://assistant`

Packaged output is written to `packages/desktop/release/default`.

## Work Variant

```bash
cd packages/desktop
npm run electron:dev:work
npm run electron:build:work
```

The work variant uses:

- Product name: `Assistant Work`
- App ID: `com.assistant.desktop.work`
- Default backend URL: `https://assistant/assistant-work`

Packaged output is written to `packages/desktop/release/work`.

## Native Bridge

The preload script exposes a narrow `window.assistantDesktop` bridge. The web
client uses it through `packages/web-client/src/utils/desktop.ts` for:

- Persisted backend settings
- Local HTTP and WebSocket proxy ports
- Native save dialogs and file writes
- Opening temporary HTML attachments
- Opening external URLs in the system browser

The web client installs a desktop-only link handler that routes ordinary
`http`, `https`, and `mailto` anchors through the native shell so clicked links
do not navigate the Electron app window. Download-specific links should keep a
`download` attribute and use the save-dialog bridge when the renderer needs to
write bytes itself.

The Electron main process keeps the same local proxy behavior as the former
desktop wrapper, including skipped backend certificate validation by default.
