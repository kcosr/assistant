# Agent config: instruction skills (Pi-style discovery + prompt inclusion)

## Goal
Add a **backend-only** way to configure an agent with “instruction skills” that are:

- **Discovered** by recursively scanning one or more directories for `SKILL.md`.
- **Identified** by YAML frontmatter (`name`, `description`) inside each `SKILL.md`.
- **Included in the agent’s system prompt** either as:
  - a Pi-style reference listing (`<available_skills>…</available_skills>`), or
  - Pi-style inline blocks (`<skill name="…">…</skill>`).

No UI and no per-message selection: the config fully determines what the agent sees.

This feature mirrors the behavior patterns used in `~/worktrees/pi-mono/packages/coding-agent` (discover skills from `SKILL.md`, warn on mismatches/collisions, reference listing format, and inline `<skill>` format).

## Non-goals
- Building any web-client UI for choosing skills.
- Replacing the existing plugin/manifest-driven “CLI skills” in `packages/agent-server/src/skills.ts`.
- Providing a generic “skills marketplace” or remote discovery.

## Proposed config shape
Extend each agent definition in `config.json` with a new `skills` field:

```jsonc
{
  "agentId": "coding",
  "displayName": "Coding",
  "description": "Writes and edits code.",

  "skills": [
    { "root": "~/skills", "available": ["*"], "inline": ["my-critical-*"] },
    { "root": "worktrees/assistant/skills" }
  ]
}
```

### Semantics
- `skills` is an array of “sources” processed in order.
- Each source object has:
  - `root` (string, required): directory to recursively scan for `SKILL.md`.
  - `available` (string[], optional): glob patterns over skill `name` to include in the **reference listing**.
  - `inline` (string[], optional): glob patterns over skill `name` to include as **inline literal content**.
- Defaulting:
  - If **both** `available` and `inline` are omitted for a source, treat it as:
    - `available: ["*"]`
    - `inline: []`
  - If the entire `skills` field is omitted for an agent, no discovery or prompt inclusion occurs.

### Path resolution
- `root` supports `~` as the first character (e.g. `~/skills`).
- Relative `root` paths resolve relative to `process.cwd()`.

### Pattern matching
- Patterns match against the skill frontmatter `name`.
- Use the same glob semantics as other allow/deny patterns in this repo (i.e. `*`/`?` style wildcards; treat patterns as case-sensitive).
- Recommended skill naming convention is Pi-style kebab case: `lowercase-with-hyphens`.

## Discovery

### What counts as a skill
A skill is a directory containing a `SKILL.md` file.

Discovery rule:
- Recursively scan under each `root` and find files named exactly `SKILL.md`.

Recommended scan behavior (Pi-like):
- Skip dot-directories and dot-files.
- Skip `node_modules/` directories.
- Follow symlinks (skip broken symlinks).

### Parsing `SKILL.md` frontmatter
Frontmatter is expected to be at the top of the file:

```md
---
name: lists
description: Structured lists with items, tags, and custom fields.
---

# Lists
...
```

Parsing rules:
- If the first line is `---`, parse until the next `---` and parse YAML using the existing `yaml` dependency.
- Extract:
  - `name` (string)
  - `description` (string)

Validation behavior (Pi-like):
- If `description` is missing/empty: warn and do **not** load/include the skill.
- If `name` is missing: fall back to the parent directory name and warn.
- If `name` exists but does not equal the parent directory name: warn but still load/include the skill.

### Collisions / duplicates (Pi-like)
If multiple discovered skills resolve to the same `name`:
- Warn and keep the first discovered skill as the “winner” for that root.
- Optionally, de-duplicate exact files by realpath so the same file loaded via symlink doesn’t collide with itself.

## Selection and precedence

### Selection per source
For each configured `skills[]` source:
- Discover all skills under `root`.
- Evaluate `available` patterns against discovered skill names → select for reference listing.
- Evaluate `inline` patterns against discovered skill names → select for inline inclusion.

### Overlap
If a skill name matches both `available` and `inline` in the same source:
- Inline wins (warn).

### Same name across sources
If the same skill `name` is selected from multiple sources:
- Allow but warn.
- Include both (system prompt order determines which instructions appear later).

## System prompt output
The system prompt inclusion is appended during `buildSystemPrompt(...)` so it applies to:
- New sessions (initial system message).
- Any prompt rebuilds (e.g. when tool context changes).

### Reference listing (`available`)
All skills selected via `available` patterns across all sources are listed in a single combined Pi-style block:

```text
<available_skills>
  <skill>
    <name>lists</name>
    <description>Structured lists with items, tags, and custom fields.</description>
    <location>/abs/path/to/lists/SKILL.md</location>
  </skill>
</available_skills>
```

Notes:
- This is a reference list: it does not inline file contents.
- Do not include the configured `root` in the prompt; only include the absolute `location`.

### Inline inclusion (`inline`)
All skills selected via `inline` patterns are appended as Pi-style blocks containing the SKILL body (frontmatter removed):

```text
<skill name="lists" location="/abs/path/to/lists/SKILL.md">
References are relative to /abs/path/to/lists.

...SKILL.md content with YAML frontmatter removed...
</skill>
```

Notes:
- Do not include `root` in the prompt.
- Include the “References are relative to …” line to mirror Pi’s behavior and give stable relative-path guidance for instructions inside the skill.

### Ordering
Deterministic ordering:
- Process sources in config order.
- Within a source, process selected skills in a stable order (recommend: by skill name).
- Emit the single `<available_skills>` block first, then emit all inline `<skill …>` blocks.

## Caching
Cache discovered skill metadata and (for inline skills) stripped file content at server startup:
- Avoid re-reading files on every prompt build.
- Cache invalidation via process restart only (no live watching in scope).

## Logging
Warnings should include:
- Root not found / unreadable.
- Invalid YAML frontmatter.
- Missing/empty `description` (skill skipped).
- `name` mismatch vs parent directory name.
- Name collisions (include both winner/loser paths).
- Overlap of available+inline (inline wins).
- Same name selected from multiple sources.

## Security considerations
- Only scan and read files under the configured `root` directories.
- (Optional hardening) Ensure symlink resolution does not escape `root`.

## Files to update (implementation)
- `packages/agent-server/src/agents.ts` (extend `AgentDefinition` to include the new `skills` field)
- `packages/agent-server/src/config.ts` (parse/validate the new config shape)
- `packages/agent-server/src/systemPrompt.ts` (append the `<available_skills>` and inline `<skill>` blocks)
- New module under `packages/agent-server/src/skills/` for:
  - recursive discovery
  - frontmatter parsing + stripping
  - selection by glob patterns
  - caching
- `packages/agent-server/src/systemPrompt.test.ts` (verify prompt output and ordering)
