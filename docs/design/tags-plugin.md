# Central Tags Plugin (metadata + scopes)

## Overview

This document sketches a **central tags plugin** that owns tag metadata (color, description, etc.) and exposes a shared tag repository across plugins. Unlike a tag aggregator, this plugin is the **source of truth** for tag metadata.

It supports **global tags** (`default`) plus **profile-scoped tags** (e.g., `work`, `personal`) that overlay global values, with an option for **profile-only** queries. Profile IDs match plugin instance IDs.

## Current direction (2026-01-22)

- **Tag records remain per-profile** (one record per profile, as in the original design).
- **Tags panel supports multi-profile selection**, but tags are still scoped to a single profile.
- UI will show **profile badges** on tag rows when multiple profiles are selected.
- To manage cross-profile usage, the panel will expose explicit actions:
  - **Add to profile** (clone a tag into another profile)
  - **Move to profile** (move a tag record to another profile)
  - **Remove from profile** (delete from a specific profile)

## Goals

- Single source of truth for tag metadata (color, description, aliases).
- Global tags + profile overlays (default + profile), with a profile-only option.
- Optional integration with other plugins (notes/lists) for tag normalization and usage tracking.

## Non-goals

- Full search across plugin data (belongs to SearchService).
- Forcing every plugin to adopt tags immediately.

## Data model (sketch)

```ts
type TagRecord = {
  name: string;            // canonical tag name (lowercase)
  profile: string;         // "default" or a shared profile id (instance id)
  color?: string;          // #RRGGBB
  description?: string;
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
  usageCount?: number;     // optional, if we track usage
};
```

## Operations (sketch)

| Operation | Purpose | Notes |
| --- | --- | --- |
| `list` | List tags for profiles | `profiles[]`, `limit`, `query`, `dedupeByName?` |
| `get` | Get a tag by name | `name`, `profile` |
| `upsert` | Create/update tag metadata | `name`, `profile`, `color`, `description`, `aliases` |
| `delete` | Delete a tag | `name`, `profile` |
| `touch` | Track usage (optional) | `name`, `profile`, `delta` |
| `profiles` | List known profiles | `default` + profiles |

## Profile resolution

Effective tags for a selection of profiles are merged as:

```
result = union(tags(profile) for profile in profiles[])
```

If a tag exists in multiple profiles, the UI should **dedupe by name** and prefer non-`default` metadata when available.

## Integration patterns

### 1) Soft integration (read-only)
- Notes/lists keep their own tag strings.
- UI merges tag metadata from tags plugin for display.
- Lowest risk, minimal changes.

### 2) Hard integration (enforced)
- Notes/lists call the tags plugin on write to **ensure tags exist** and normalize names.
- Optional usage tracking via `touch`.
- Requires plugin dependency ordering.

**Cross-plugin call example:**

```ts
await ctx.baseToolHost?.callTool(
  'tags_upsert',
  JSON.stringify({ name: tagName, profile: 'work' }),
  ctx,
);
```

## UI behavior (multi-profile)

- **Tag picker for an item** uses `profiles=[default, itemProfile]`.
- **Tag filter UI** uses `profiles=[selectedProfiles]` (multi-select) and dedupes by name.
- Items should only accept tags from their own profile + global (no cross-profile tagging).

## Plugin dependencies

If hard integration is used, notes/lists should declare:

```json
"server": { "dependsOn": ["tags"] }
```

## Storage (sketch)

- File-backed store in `dataDir/plugins/tags/`
- Start with JSONL + in-memory index (similar to notes/lists stores)
- Consider `shared` collection utilities for indexing

## Source files (planned)

- `packages/plugins/official/tags/manifest.json`
- `packages/plugins/official/tags/server/index.ts`
- `packages/plugins/official/tags/server/store.ts`

## Open questions

### Implementation questions to resolve

- **List view behavior:** When multiple profiles are selected, should tags be **deduped by name** (single row with profile badges) or shown as **one row per profile**?
- **Edit surface:** If deduped, how should edits target a specific profile (profile picker in editor vs. per-row action)?
- **Canonicalization:** Should tags always be **stored in lowercase** but display a user-facing label, or always display the canonical name?
- **Legacy tag manager:** Remove the current settings-based tag color manager entirely, or leave a link that opens the Tags panel?
- **Migration:** Should we migrate existing **tag color preferences** into the tags plugin store on first run?

### Original open questions

- Should `profile` be `default` or `global`? (consistency with instance model)
- Do we want tag IDs separate from names?
- Should tag colors be validated with a shared schema?
- Do we need aliases or category/grouping now?
