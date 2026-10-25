# Built-in `web_search` Tool (Codex CLI Research)

## Purpose

Provide current public-web research to Assistant text agents and Realtime voice sessions through a single built-in tool. The agent supplies a natural-language question; a dedicated headless Codex process researches it and returns an answer with Markdown source links.

This tool uses a research-only permission profile. The general `codex-cli` chat provider, Codex Threads tools, in-app `search_*` plugin, and URL metadata tools remain separate features.

Codex supplies public-web search and page research. It does not supply Grok’s native X/Twitter account, keyword, or thread-search tools. Public X pages may appear in ordinary web results, but native X research is not part of this tool’s contract.

## Tool contract

Name: `web_search`

| Argument   | Type    | Required | Meaning                                                                                         |
| ---------- | ------- | -------- | ----------------------------------------------------------------------------------------------- |
| `query`    | string  | yes      | Nonempty natural-language research question or follow-up.                                       |
| `continue` | boolean | no       | Resume the last successful research session for this Assistant conversation. Defaults to false. |

The JSON schema rejects additional properties. The implementation validates and trims the query before starting a process. The calling agent never selects a binary, working directory, Codex model configuration, security profile, or raw session ID.

Successful result:

```json
{
  "text": "The researched answer, with [source links](https://example.com).",
  "continued": false
}
```

Keep this public contract unchanged when replacing the research backend. Remove the obsolete Grok invocation and parser rather than maintaining provider fallbacks.

## Registration and access

`registerBuiltInSessionTools` registers `createWebSearchToolDefinition()` with the shared tool host. Existing tool scoping controls access:

- Text agents opt in by including `web_search` in `agents[].toolAllowlist`.
- Realtime opts in by including `web_search` in `voice.realtime.toolAllowlist`.

The same handler serves both paths. `ToolContext.sessionId` identifies the Assistant conversation; the shared `voice:` session-key prefix selects the speech-oriented answer instructions. Both paths have a 100-second wall-clock execution limit.

## Host configuration

| Setting                    | Resolution                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| CLI binary                 | `ASSISTANT_CODEX_BIN`, otherwise `codex` on `PATH`.                                                                                       |
| Codex home                 | `CODEX_HOME`, otherwise the service user’s `~/.codex`.                                                                                    |
| Native executable          | Optional `ASSISTANT_CODEX_RUNTIME_PATH`: an exact native executable path needed when the configured binary is a wrapper.                  |
| Research model             | Fixed `gpt-6.1-sol` with low reasoning effort on fresh and resumed invocations; the configured Codex default is not used.                 |
| Research working directory | `<dataDir>/codex-web-search/<sha256 conversation key>`, using configured storage outside every Git checkout; missing storage is an error. |

Codex home contains host-managed authentication and persisted sessions. Resolve it before isolating `HOME` to the conversation’s research directory, then pass it explicitly as `CODEX_HOME`. Keep it outside the model’s research working directory and outside the permission profile’s readable/writable research paths. Codex’s own authentication and session operations use this home outside the tool sandbox; the model’s filesystem tools do not gain access to it.

Resolve the configured CLI binary to its real path and allow read access only to that exact executable file. If a wrapper launches a native Codex executable outside minimal runtime paths, `ASSISTANT_CODEX_RUNTIME_PATH` names that exact absolute file path for an additional read grant. Do not grant an entire installation directory; an npm-installed Codex wrapper under `~/.local` is an example that needs the native-path setting.

The server’s service user must have a Codex CLI supporting named native permission profiles and valid file-based credentials in the selected Codex home before calls run. `CODEX_HOME` must be an existing absolute directory. Reject configurations where the home and research working directory contain one another. The worker receives an allowlist of runtime/network environment settings, its isolated `HOME`, and the selected `CODEX_HOME`; API-key environment variables and unrelated server secrets are not forwarded. Missing binaries, expired authentication, unsupported flags, and invalid permission settings produce tool errors. There is no interactive permission or login flow inside a tool invocation.

A workspace inside a Git checkout is rejected to avoid inheriting repository development skills. The caller must supply configured data storage; there is no predictable shared temporary-directory fallback. No Codex CLI version is pinned; capability, isolation, and live-search checks must be repeated after upgrades.

Every invocation uses `--ignore-user-config`, `--ignore-rules`, and `--strict-config` together with explicit research configuration and the fixed `gpt-6.1-sol` model. Fresh and resumed runs use the same model and restrictions. There is no arbitrary model override or fallback to another model when access fails.

User configuration is ignored, `HOME` is isolated, and `project_doc_max_bytes=0` disables automatic project-document loading. These settings reduce inherited instructions. There is no generic skill-disable toggle: bundled discovery under the selected `CODEX_HOME` may still expose skills. Do not describe the invocation as having no discoverable skills or only web tools.

## Native research permission profile

Explicitly enable `features.code_mode_host=true` for GPT-6.1's tool-dispatch runtime. This host is separate from shell execution, which stays disabled. The filesystem and network profile still applies to model tool operations and helper agents.

Explicitly select live web search. Cached-only search does not satisfy the contract for current information.

Use the named native profile below, rather than `--sandbox` or legacy sandbox configuration:

```toml
approval_policy = "never"
default_permissions = "research"

[permissions.research]
[permissions.research.filesystem]
":root" = "deny"
":minimal" = "read"
":tmpdir" = "deny"
":slash_tmp" = "deny"

[permissions.research.network]
enabled = false
```

The implementation also adds an explicit read grant for the dedicated research working directory and exact read grants for the resolved executable files. Root access and broad temporary-directory access are denied; only minimal runtime reads and those explicitly resolved files are allowed elsewhere. Codex authentication and persisted sessions stay outside that directory. Command-process networking is disabled; web access is supplied by Codex’s live research tools.

Disable optional coding and integration feature flags, including shell, app, memory, and multiagent features, and ignore configured MCP integrations. Model metadata can still expose helper controls despite disabled multiagent flags and agent-depth settings. Research instructions prohibit using helper agents, but that instruction is not an enforcement boundary. The enforced boundaries are the native filesystem/network permission profile and the shared process-group deadline. Any helper must inherit that same permission profile; verify its effective access rather than relying on feature flags or tool inventory.

Native `apply_patch` may remain available, but the filesystem profile has no write grants. Model tools cannot persist instructions or skills in the research directory, which is also their `HOME`. Fixed research instructions also forbid file edits. Do not claim the process has no tools besides web search or that the entire host process is sandboxed.

Prompt instructions reinforce the restrictions but do not establish the permission boundary. Do not use full-access or general coding profiles, and do not retry a failed restrictive invocation with weaker settings. Noninteractive approval behavior must fail instead of waiting for a prompt.

Treat fetched page text and returned model text as untrusted research content. Source links support the answer; they do not authorize local commands, file access, or other Assistant tool calls.

## Execution and parsing

1. Validate arguments and obtain the Assistant conversation key.
2. If `continue` is true, look up that conversation’s recorded Codex session ID. Return `no_prior_search` when none exists.
3. Resolve the trusted host binary, Codex home, research working directory, and explicit research configuration.
4. Start Codex with an argv-array spawn and `shell: false`. Pass the prompt through stdin with the CLI’s `-` prompt argument; never interpolate the query into shell syntax.
5. Run a fresh headless research session, or resume the exact recorded ID. Never use “latest session” or a working-directory-based implicit continuation.
6. Parse the Codex JSONL event stream. Track `thread.started` and final assistant messages, and require `turn.completed` terminal success.
7. Return the answer only after successful termination. Update the conversation mapping only for a successful run with a valid session ID.

Codex JSONL output is not a Grok-style final JSON object. Parse the selected supported Codex event contract directly. A `turn.failed` event is fatal. Top-level `error` events can be reconnect notices, and `item.completed` errors can be recoverable tool failures; neither alone overrides a successful terminal `turn.completed` and process exit. Reject malformed output, missing `turn.completed`, nonzero exit, and empty answers. A fresh search must include a completed `web_search` item; a continued session may reuse its prior research. Do not reinterpret an incomplete turn as successful research merely because an assistant message appeared before failure.

The fixed research instructions require current information, useful Markdown source links, and no shell commands, file edits, or helper agents. Reject opaque citation markers that cannot be rendered as source links by Assistant. A legitimate no-results answer may contain no link, so parsing does not require every answer to include a URL. Realtime adds a request for a short speakable answer unless the user asks for detail. Preserve links in the returned text even when speech omits reading URLs aloud.

## Continuation

Serialize calls per Assistant conversation before looking up the session mapping. Waiting calls honor cancellation; cancelling a queued call must not allow later calls to overtake an active predecessor. Independent conversations remain parallel.

Store the last successful Codex session ID in a process-memory map keyed by the complete Assistant tool session ID. Codex persists the underlying session in the selected Codex home; Assistant holds only the conversation-to-session association.

- A new search starts a fresh Codex session and replaces that conversation’s mapping after success.
- A successful follow-up resumes the stored exact ID and retains that mapping; a returned different session ID is an error.
- A failed call does not replace a successful mapping with a partial or unrelated session.
- A server restart clears the map. A later `continue: true` returns `no_prior_search` until a new search succeeds.
- A change of binary, Codex home, native runtime, or research working directory invalidates continuation and returns `no_prior_search`.
- A missing or invalid persisted session produces an error. The CLI’s known missing-rollout error maps to `no_prior_search`. Do not fall back to a fresh conversation or another session.

Different Assistant conversations must never share a mapping merely because they use the same research working directory. Authentication, persistence, and permission isolation apply equally to resumed sessions.

## Cancellation, limits, and errors

Both text and Realtime runs have a 100-second wall-clock cap and honor `ctx.signal`. On POSIX the Codex worker starts in its own process group. Terminate that group on cancellation or timeout, escalate to a forced kill when necessary, and clean up listeners and timers. Helpers do not receive independent deadlines beyond the enclosing research request. Clean up surviving owned descendants even when the process leader exits successfully. Bound captured stdout and stderr so an unexpectedly verbose child cannot consume unbounded server memory.

Return structured `ToolError` results with short useful messages:

| Condition                                                                                                       | Code                  |
| --------------------------------------------------------------------------------------------------------------- | --------------------- |
| Missing or empty query                                                                                          | `invalid_arguments`   |
| Missing Assistant session key                                                                                   | `session_unavailable` |
| Continuation without a recorded prior session, changed execution identity, or a known missing saved rollout     | `no_prior_search`     |
| Invalid data storage, native runtime path, or Codex home (including directory overlap)                          | `configuration_error` |
| Caller cancellation                                                                                             | `cancelled`           |
| Wall-clock deadline exceeded                                                                                    | `timeout`             |
| Missing binary, authentication/configuration failure, nonzero exit, failed turn, malformed stream, or no answer | `execution_failed`    |

Realtime timeout and failure messages should be short enough to speak. Keep bounded stderr diagnostics server-side with the exit code and failure reason; return short generic errors to model callers.

## Verification

Unit and fake-process tests cover:

- Stable tool name, argument validation, result shape, and explicit continuation semantics.
- Fresh and resumed argv, stdin prompt handling, explicit live search, pinned model, config/rule isolation, and the complete native permission profile.
- Codex event parsing, final answer and exact session ID extraction, terminal success, completed live-search items for fresh calls, malformed/empty output, failed/incomplete turns, and recoverable tool errors.
- Conversation isolation, missing prior-session errors, unchanged successful mappings after failure, and no automatic fresh-session retry.
- Binary and native-executable resolution, isolated `HOME`, authenticated `CODEX_HOME`, and separate working directories per conversation.
- Text and Realtime’s shared 100-second cap, voice answer instructions, cancellation, process termination, and bounded output.

The native filesystem profile was checked locally with Codex 0.162.1 and controlled loopback model responses. GPT-6.1 Sol helper probes confirmed inherited root-deny/minimal-runtime/read-only-workspace permissions, disabled command networking, denied outside/auth-home/symlink patches, and rejection of an unsupported command-execution call. Native patch attempts inside the workspace, `.codex/skills`, and `.agents/skills` were also denied; all disposable sentinels remained unchanged.

A live `gpt-6.1-sol` smoke test authenticated through the native Codex home, completed a fresh web search, and returned an ordinary Markdown link to the official OpenAI permissions documentation. An exact-ID continuation with the speech-oriented instructions returned a concise answer and source URL using the same native thread ID. A complete Realtime WebRTC session was not exercised.

Before deployment, perform live acceptance checks for current web research with working source links, one exact-ID continuation, and a Realtime answer. Verify that the configured research run and any helpers cannot read or write host files outside their allowed paths, including through symlinks, and cannot use command networking or configured external integrations. Check actual agent-control behavior for the installed model rather than relying only on tool inventory. Any exposed patch tool must be denied writes to the research directory, including skill files. An unsupported restrictive configuration is a deployment failure rather than a reason to weaken the profile.

Configuration reference: `docs/CONFIG.md`, “Built-in `web_search` tool.”
