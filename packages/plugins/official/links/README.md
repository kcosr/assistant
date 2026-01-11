# Links Plugin

The links plugin opens URLs on connected clients (web, Android, or Capacitor mobile builds).
It can optionally rewrite Spotify web URLs to the native `spotify:` URI scheme.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Operation (HTTP)](#operation-http)
- [Tool](#tool)
- [Notes](#notes)

## Configuration

Enable the plugin in `config.json`:

```json
{
  "plugins": {
    "links": {
      "enabled": true,
      "spotify": {
        "rewriteWebUrlsToUris": true
      }
    }
  }
}
```

## Source files

- `packages/plugins/official/links/manifest.json`
- `packages/plugins/official/links/server/index.ts`

## Operation (HTTP)

- `POST /api/plugins/links/operations/open`

## Tool

- `links_open`: Open a URL on the connected client.
  - Args: `url` (string, required), `raw` (boolean, optional).

## Notes

- Set `raw: true` per-call to skip Spotify rewriting.
- `links_open` requires a session id and an active WebSocket connection.
