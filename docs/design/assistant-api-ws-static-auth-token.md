# Static auth token for Agent Server HTTP API + WebSocket

## Summary
Add an **optional, statically configured bearer token** that can be used to protect the Agent Server’s **HTTP API** endpoints (e.g. `/api/**`, `/external/**`) and the **WebSocket** endpoint (`/ws`).

When enabled, clients (web-client, assistant-cli, and plugin CLIs) must present the token on every request/connection.

This is intended as a lightweight hardening mechanism for local/LAN deployments (not a full user auth system).

## Goals
- Allow operators to configure a static token on the server.
- Require the token for:
  - HTTP API routes (`/api/**`)
  - external agent callback routes (`/external/**`)
  - WebSocket endpoint (`/ws`)
- Update first-party clients to send the token:
  - `packages/web-client` (browser UI)
  - `packages/assistant-cli` (shared CLI runtime)
  - any official plugin CLIs that talk to the server over HTTP
- Provide an env-var based configuration for CLIs, with an optional CLI flag override.

## Non-goals
- Multi-user auth, sessions, refresh tokens, OAuth, etc.
- Fine-grained authorization per operation.
- Transport security. (Operators should still prefer HTTPS/WSS for non-local deployments.)

## Design decisions (resolved)
From questionnaire answers:
- **Server token env var:** reuse `ASSISTANT_TOKEN`.
- **Browser WS transport:** query param (e.g. `/ws?auth=<token>`).
- **Protect `/external/**`:** yes, same token as `/api` and `/ws`.
- **Static assets auth:** no (protect only API + WS).
- **CLI flag override:** `--token`.

## Proposed configuration

### Server (agent-server)
Env-config fields:
- `ASSISTANT_TOKEN` (string): expected bearer token.
- `ASSISTANT_REQUIRE_AUTH` (bool, default `false`):
  - if `true` and token is missing/blank, fail fast at startup.

Behavior:
- If `ASSISTANT_TOKEN` is **unset**: allow all requests (backwards compatible).
- If `ASSISTANT_TOKEN` is **set**:
  - Require a valid token for:
    - `/api/**`
    - `/external/**`
    - `/ws`
  - Static assets remain unauthenticated:
    - `/`, `/index.html`, `/client.js`, `/styles.css`, `/plugins/**`

### Web client
Add an optional token configuration to `packages/web-client/public/config.js`:
- `window.ASSISTANT_AUTH_TOKEN = '...'` (string)

Usage:
- For HTTP: include `Authorization: Bearer <token>` on all `apiFetch()` calls.
- For WS (browser limitation: cannot set headers): append token as a query parameter when configured.

### CLI / HTTP clients
Standardize on:
- Env var: `ASSISTANT_TOKEN`
- Flag override (yargs): `--token <token>`

Notes:
- `packages/assistant-cli` already supports `ASSISTANT_TOKEN` via `loadConfig()`, but does not currently expose a `--token` override in `runPluginCli`.
- Some official plugin CLIs bypass `assistant-cli` and do raw `fetch()`; these need to be updated to include the token header.

## Protocol / transport

### HTTP
Preferred and required when token auth is enabled:
- `Authorization: Bearer <token>`

### WebSocket
Token presentation mechanisms:
- Browser: `wss://<host>/ws?auth=<token>`
- Non-browser clients (Node ws) may also send `Authorization: Bearer <token>` (server should accept both).

## Implementation sketch

### 1) EnvConfig
Update `packages/agent-server/src/envConfig.ts`:
- extend `EnvConfig` with:
  - `authToken?: string`
  - `authRequired: boolean`
- parse env vars:
  - `ASSISTANT_TOKEN`
  - `ASSISTANT_REQUIRE_AUTH`
- validation:
  - if `ASSISTANT_REQUIRE_AUTH=true` and token is missing -> throw error at startup

### 2) HTTP auth gate in `createHttpServer`
In `packages/agent-server/src/http/server.ts`, add an early auth gate **before routing**:
- allow unauthenticated access to static assets (`/`, `/index.html`, `/client.js`, `/styles.css`, `/plugins/**`)
- require auth for:
  - paths starting with `/api/`
  - paths starting with `/external/`

On failure:
- return `401` JSON `{ error: "Unauthorized" }`

### 3) WebSocket auth
In `packages/agent-server/src/index.ts`:
- use the `connection` callback signature `(ws, req)` to inspect the upgrade request
- validate token using either:
  - `Authorization` header (`Bearer <token>`) (Node clients)
  - URL query param `auth` (browser)
- if invalid:
  - close immediately with `1008` (policy violation)
  - do not construct `MultiplexedConnection`

(Optionally improve by moving to `noServer: true` + manual `upgrade` handling so HTTP 401 can be returned on failed upgrade, but closing with 1008 is sufficient for v1.)

### 4) Web-client changes
In `packages/web-client/src/utils/api.ts`:
- add a helper to read `window.ASSISTANT_AUTH_TOKEN`
- update `apiFetch()` to inject `Authorization` when token is configured (without overwriting caller-provided Authorization)
- update `getWebSocketUrl()` to append `?auth=<token>` when configured

Also update the TS global typings in that file to include `ASSISTANT_AUTH_TOKEN?: string`.

### 5) CLI changes
- In `packages/assistant-cli/src/pluginRuntime.ts`, add a global yargs option:
  - `--token <token>`
  - (optionally also `--url <baseUrl>`)
- Ensure `httpRequest()` includes the header (already does when `config.token` is set).
- Update any official plugin CLIs that implement their own HTTP client (e.g. `packages/plugins/official/artifacts/bin/cli.ts`) to:
  - read `ASSISTANT_TOKEN`
  - accept `--token` override
  - and set `Authorization: Bearer <token>`

## Security considerations
- Query-string tokens can leak via logs, proxy traces, browser history, etc.
  - This is the tradeoff to support browser WebSocket auth.
  - Recommend using HTTPS/WSS and keeping deployments local.
- Static token is not a replacement for proper authentication.

## Backwards compatibility
- Default remains **no auth** unless `ASSISTANT_TOKEN` is configured.
- Web-client remains compatible when token is unset.

## Testing
- Add unit tests for:
  - HTTP auth gate: `/api/*` and `/external/*` require auth, static assets do not.
  - WS auth: connection without token is closed.
  - web-client URL builder appends auth query param when configured.

## Files to update
- `packages/agent-server/src/envConfig.ts`
- `packages/agent-server/src/http/server.ts`
- `packages/agent-server/src/index.ts`
- `packages/web-client/public/config.js`
- `packages/web-client/src/utils/api.ts`
- `packages/assistant-cli/src/pluginRuntime.ts`
- `packages/plugins/official/**/bin/*.ts` (any CLIs doing raw fetch without auth)
- Docs: `packages/agent-server/README.md` and/or top-level `docs/CONFIG.md`
