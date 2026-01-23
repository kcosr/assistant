# Notes description field

## Summary
Add an optional description field to notes metadata (frontmatter) and expose it in tools and panel updates, mirroring the lists plugin description pattern.

## Goals
- Support storing a short description alongside notes (frontmatter metadata).
- Expose description in notes tool responses (`list`, `read`) and panel update payloads.
- Allow tools/CLI/UI to set or clear the description explicitly.

## Non-goals
- Auto-generating descriptions from note content.
- Changing note search ranking or preview rendering unless explicitly needed.

## Data model
- Extend `NoteMetadata` / `Note` with `description?: string`.
- Parse `description` from frontmatter and serialize it when present.
- Write semantics:
  - If `description` is omitted, preserve the existing description (like tags today).
  - If `description` is an empty string, clear it (similar to list updates).
  - Match list behavior: description is editable in the list edit modal and can be cleared.

## Operations / tools
- `write`: accept optional `description` string; empty string clears.
- `list` + `read`: include `description` in returned metadata when present.
- `search`: include `description` in search results and match against description text.
- `panel_update` payloads: include `note.description` when present.
- Update `packages/plugins/official/notes/manifest.json` input schema for `write`.

## UI
- Add a Description input in the note editor (aligned with the list edit modal pattern).
- Show description under the title in note view (subtle text style).
- Browser cards can keep existing content preview; description is optional to surface.

## Backwards compatibility
- Notes without a description remain valid; no migration required.
- Frontmatter parsing should ignore missing or non-string description values.

## Tests
- `packages/plugins/official/notes/server/store.test.ts`: verify description is parsed/serialized and preserved on write/append/rename.
- `packages/plugins/official/notes/server/index.test.ts`: verify `write`/`read`/`list` include description.
- `packages/plugins/official/notes/web/index.test.ts`: if UI is updated, verify description renders and is sent on save.

## Decisions
- UI-visible now (editor + header) in the notes panel.
- `search` includes description in results and matches description text.
- Write semantics match lists: preserve when omitted; clear on empty string.
