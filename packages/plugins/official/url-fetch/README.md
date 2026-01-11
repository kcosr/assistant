# URL Fetch Plugin

The url-fetch plugin retrieves content from external URLs and can extract readable text
or lightweight metadata for saving links.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Operation (HTTP)](#operation-http)
- [Tool](#tool)
- [Modes](#modes)

## Configuration

Enable the plugin in `config.json`:

```json
{
  "plugins": {
    "url-fetch": { "enabled": true }
  }
}
```

## Source files

- `packages/plugins/official/url-fetch/manifest.json`
- `packages/plugins/official/url-fetch/server/index.ts`

## Operation (HTTP)

- `POST /api/plugins/url-fetch/operations/fetch`

## Tool

- `url_fetch_fetch`: Fetch content from a URL.
  - Args: `url` (string, required), `mode` (string, optional: `extracted`, `raw`, `metadata`).

### Modes

- `extracted` (default): readable text extraction.
- `raw`: raw HTML.
- `metadata`: title/description extraction for lightweight previews.
