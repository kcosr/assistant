# Shared instance scopes across plugins

## Overview

Plugins today define **instances** independently (e.g., `notes: default`, `notes: work`). There is no shared meaning for instance IDs across plugins. This document sketches approaches for introducing **cross-plugin profiles** so a shared concept like `work` or `personal` can be reused consistently across plugins (and treated as an overlay on `default`).

**Decision:** instance IDs *are* profile IDs. Plugins instantiate a subset of the shared profiles by listing instances whose `id` matches a profile. There is no separate profile field on instances.

Core idea: **`default` remains global** and profile instances (like `work`) overlay global data. The UI and APIs support **multi-profile selection** for views and search.

Example tag selection behavior:

```
Selected profiles = [default, work] -> tags(default) + tags(work)
Selected profiles = [work]          -> tags(work)
```

## Goals

- Allow cross-plugin features (tags, preferences, search filters) to share a scope identity.
- Preserve existing behavior when only `default` exists.
- Keep UX simple: default is global; scopes are overlays.
- Allow multi-profile selection (include or exclude global/default explicitly).

## Profile selection model

- **Views/search accept multiple profiles** (instances) to broaden scope.
- **Items belong to a single profile** (their instance) for edits/tagging.
- UI defaults to selecting **[default + current profile]**, but users can toggle to any subset.
- When multiple profiles are selected, list UIs should show a **profile badge** per item.
- Tag pickers should only allow **global + item profile** tags (no cross-profile tagging).
- Tag filter UIs should union tags across selected profiles and **dedupe by name**.

## Option A: Convention-only shared instance IDs (legacy idea)

**Model:** Treat instance IDs as shared profiles by convention, with no global profile registry.

Example config (convention only):

```json
{
  "plugins": {
    "notes": { "instances": [{ "id": "default" }, { "id": "work" }] },
    "lists": { "instances": [{ "id": "default" }, { "id": "work" }] }
  }
}
```

**Behavior:**
- Any plugin instance with ID `work` is assumed to be in profile `work`.
- Tag lookups use the selected profiles (e.g., `[default, work]` or `[work]`).

**Pros**
- Zero new configuration types.
- Fastest to adopt.

**Cons**
- Fragile: IDs can drift or diverge across plugins.
- No canonical registry of profiles or labels.
- Hard to enforce consistency or show a unified UI.

**Status:** not planned; kept for reference.

## Option B: Explicit profile registry (chosen)

**Model:** Introduce top-level shared profiles and require plugin instances to use **profile IDs** as their instance IDs.

Example config:

```json
{
  "profiles": [
    { "id": "default", "label": "Global" },
    { "id": "work", "label": "Work" },
    { "id": "personal", "label": "Personal" }
  ],
  "plugins": {
    "notes": {
      "instances": [
        { "id": "default" },
        { "id": "work" }
      ]
    },
    "lists": {
      "instances": [
        { "id": "default" },
        { "id": "work" }
      ]
    }
  }
}
```

**Behavior:**
- Instance IDs *are* profile IDs.
- `default` remains global.
- Scoped data is determined by the selected profiles (e.g., `[default, work]`).

**Pros**
- Explicit, consistent, and UI-friendly.
- Enables profile metadata (labels, icons) in one place.
- Avoids duplicate instance/profile keys.

**Cons**
- Adds a new config concept.
- Requires plumbing in config parsing and instance resolution.

## Recommendation

- **Adopt Option B** (explicit profile registry).
- **Instance IDs must match profile IDs.**

## Open questions

- Should `default` be treated as a special profile internally or just another profile?
- Do we want profile metadata beyond `id`/`label` (icon, color, priority)?
- Should plugins allow multiple profiles per instance (likely no)?
- Do we standardize profile selection behavior (e.g., order, defaults) across all panels?
- Do we keep Option A as legacy reference or remove it entirely?

## Related docs

- `docs/design/global-search-command-palette.md`
