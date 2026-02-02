# Pi Agent OAuth Credential Reuse

## Overview

Enable assistant to automatically use OAuth credentials from an external Pi process
(pi-mono CLI) without implementing its own OAuth login flows. This allows users who
have already authenticated via `pi login` to use those credentials for providers
like Anthropic (Claude Pro/Max) and OpenAI Codex (ChatGPT Plus/Pro) in assistant.

## Goals

- Reuse OAuth tokens from `~/.pi/agent/auth.json` for supported providers.
- Automatically refresh expired OAuth tokens and persist updated credentials.
- Require no agent config changes for users who already have valid OAuth credentials.
- Support both `anthropic` and `openai-codex` providers.

## Non-Goals

- Implementing interactive OAuth login flows in assistant.
- Supporting OAuth for providers other than `anthropic` and `openai-codex`.
- Replacing the existing `chat.config.apiKey` mechanism (it remains as an override).

## Background

### Pi Credential Storage

The pi-mono CLI stores credentials in `~/.pi/agent/auth.json` (or
`$PI_CODING_AGENT_DIR/auth.json` if set). The file contains per-provider entries:

```json
{
  "anthropic": {
    "type": "oauth",
    "access": "<access-token>",
    "refresh": "<refresh-token>",
    "expires": 1769983062422
  },
  "openai-codex": {
    "type": "oauth",
    "access": "<access-token>",
    "refresh": "<refresh-token>",
    "expires": 1770574020968,
    "accountId": "<account-id>"
  }
}
```

Credentials can be:
- `type: "oauth"` — OAuth tokens with refresh capability
- `type: "api_key"` — Static API keys

### Pi SDK Provider Auth

The `@mariozechner/pi-ai` SDK resolves API keys in this order:
1. Explicit `options.apiKey` passed to `streamSimple()`
2. Environment variables (e.g., `ANTHROPIC_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`)

By passing an explicit `apiKey`, we can override env var lookup entirely.

## Design

### New Module: `piAgentAuth.ts`

Location: `packages/agent-server/src/llm/piAgentAuth.ts`

Exports a single function:

```ts
export async function resolvePiAgentAuthApiKey(options: {
  providerId: string;
  log?: (...args: unknown[]) => void;
}): Promise<string | undefined>;
```

Behavior:
1. Only attempts resolution for `anthropic` and `openai-codex` providers.
2. Reads `~/.pi/agent/auth.json` (or `$PI_CODING_AGENT_DIR/auth.json`).
3. For `type: "api_key"`: returns the `key` field directly.
4. For `type: "oauth"`:
   - Calls `getOAuthApiKey()` from `@mariozechner/pi-ai` which handles refresh if expired.
   - Writes updated credentials back to `auth.json` (preserving extra fields like `accountId`).
   - Returns the access token.
5. Returns `undefined` if no credentials found or on error.

### Integration Point: `chatRunCore.ts`

Before the Pi SDK chat iteration loop, resolve auth:

```ts
const piAgentAuthApiKey = await resolvePiAgentAuthApiKey({
  providerId: resolvedModel.providerId,
  log,
});

const apiKey = providerMatchesConfig 
  ? piConfig?.apiKey ?? piAgentAuthApiKey 
  : piAgentAuthApiKey;
```

### Auth Resolution Precedence

For a given provider (e.g., `anthropic`):

1. **Explicit `chat.config.apiKey`** — If set and provider matches `chat.config.provider`
2. **`~/.pi/agent/auth.json`** — OAuth token or API key from file
3. **Environment variable** — Handled by Pi SDK when no `apiKey` passed (e.g., `ANTHROPIC_API_KEY`)

This means:
- Users with existing OAuth credentials need no config changes.
- Explicit config always wins (for advanced use cases).
- Env vars still work as fallback.

### Supported Providers

Only these providers are supported for auth.json lookup:

| Provider ID    | OAuth Provider Name              | Models                          |
|----------------|----------------------------------|---------------------------------|
| `anthropic`    | Anthropic (Claude Pro/Max)       | `anthropic/claude-*`            |
| `openai-codex` | ChatGPT Plus/Pro (Codex)         | `openai-codex/gpt-*`            |

Other providers (e.g., `openai`, `google`) are not supported because:
- They don't have OAuth flows in pi-mono, or
- Their auth model differs significantly.

### Agent Configuration

To use OAuth-backed providers, agents should use provider-prefixed models:

```json
{
  "chat": {
    "provider": "pi",
    "models": [
      "anthropic/claude-sonnet-4-5",
      "openai-codex/gpt-5.1-codex-mini"
    ]
  }
}
```

The provider prefix (`anthropic/`, `openai-codex/`) determines which auth.json
entry is used. No `chat.config.apiKey` is needed.

### Token Refresh

OAuth tokens expire. The `getOAuthApiKey()` function from `@mariozechner/pi-ai`:
1. Checks if the token is expired (`Date.now() >= expires`).
2. If expired, calls the provider's `refreshToken()` method.
3. Returns updated credentials.

We persist the refreshed credentials back to `auth.json` immediately after refresh.

**Note:** This implementation does not use file locking. For single-instance assistant
deployments this is fine. If multiple processes might refresh simultaneously, consider
adopting `proper-lockfile` as pi-mono's `AuthStorage` does.

### Error Handling

- File not found: return `undefined` (fall through to env var)
- Parse error: return `undefined`
- Refresh failure: log warning, return `undefined`
- Unknown provider: return `undefined` immediately (no file read)

Errors are non-fatal; the system falls back to env var auth or fails at the Pi SDK
level with a clear "no API key" error.

## Files Changed

| File | Change |
|------|--------|
| `packages/agent-server/src/llm/piAgentAuth.ts` | New module for auth.json resolution |
| `packages/agent-server/src/chatRunCore.ts` | Import and call `resolvePiAgentAuthApiKey()` before chat loop |

## Dependencies

No new dependencies. Uses existing `@mariozechner/pi-ai` exports:
- `getOAuthApiKey()`
- `OAuthCredentials` type

## Testing

Manual testing:
1. Run `npx @mariozechner/pi-ai login anthropic` to populate auth.json.
2. Configure agent with `anthropic/claude-sonnet-4-5` model.
3. Verify assistant uses OAuth token (check debug logs or network).
4. Let token expire and verify refresh works.

Unit tests (future):
- Mock `fs.readFile` to return various auth.json shapes.
- Verify correct provider matching (case-insensitive).
- Verify refresh is called when `expires < Date.now()`.
- Verify credentials are written back after refresh.

## Future Considerations

- **File locking**: Add `proper-lockfile` if multi-process refresh races become an issue.
- **Additional providers**: Could extend to `github-copilot`, `google-gemini-cli` if needed.
- **Cache in memory**: Currently re-reads auth.json per chat run; could cache with TTL.
- **Login UI**: Could add OAuth login to assistant's web UI in the future.
