# Time Tracker Export Task Description

## Overview

Enhance the time-tracker XLSX export so each exported task row can include the task description as a leading summary paragraph, followed by entry-level notes when they exist. The export remains grouped by task and keeps the existing XLSX columns, totals, artifact upload, and reported-entry behavior.

## Motivation

The current export Description column is built only from entry notes, so task-level context is omitted unless repeated on each entry. Including the task description makes exported reports more readable while preserving detailed notes as supporting bullets.

## Scope

In scope:

- Build each exported row description from `Task.description` and unique `Entry.note` values.
- Preserve grouping by task, total-minute aggregation, task-name labels, note normalization, note de-duplication, sorting, and reported-entry marking.
- Preserve the current `export_xlsx` operation shape and server XLSX generation path.
- Add or update tests around the combined description format.

Out of scope:

- Database schema changes or migrations.
- New task or entry fields.
- New UI controls or export options.
- Compatibility aliases, fallback readers, or dual-shape operation inputs.
- Implementing the feature in this design-summary pass.

## Contract

For each exported task row:

- `item` remains the task name from `getTaskById(entry.task_id)`, or `Unknown task` when the task cannot be found.
- `total_minutes` remains the sum of `entry.duration_minutes` for that task.
- `description` is constructed as follows:
  - Trim `task.description`.
  - Trim each `entry.note`.
  - Normalize each non-empty note by removing one leading bullet marker from `[-*•–—]` plus following whitespace.
  - Ignore notes that become empty after normalization.
  - De-duplicate notes case-insensitively while preserving first observed spelling and order.
  - If both task description and notes exist, emit:

    ```text
    <task description>

    Notes:
    • <note 1>
    • <note 2>
    ```

  - If only task description exists, emit just the task description.
  - If only notes exist, preserve the current notes-only shape:

    ```text
    • <note 1>
    • <note 2>
    ```

  - If neither exists, emit an empty string.

The `export_xlsx` operation continues to accept `rows: [{ item, total_minutes, description }]` and writes the Description column from `row.description` through the existing server formatter. This is a hot-cut behavior change for future exports only.

## Surface Inventory

| Name | Disposition | Layers | Symmetric peers | Removal twin |
|---|---|---|---|---|
| XLSX `Description` column | Changed | Web export row builder constructs combined text; server `export_xlsx` writes column E | Task `Description` field and entry `Note` field | None |
| `Notes:` label inside Description cell | Added | Web export row builder emits it only when a task description and one or more entry notes are both present | Entry notes rendered as bullets below task summary | None |

## Schema

_No schema changes._

The time-tracker store already has `tasks.description` and `entries.note` fields with empty-string defaults.

## Impact Surface

| File | Responsibility | Existing tests |
|---|---|---|
| `packages/plugins/official/time-tracker/web/index.ts` | Defines `Task.description`, `Entry.note`, `ExportRow.description`; groups entries by task; currently builds row descriptions from entry notes only; forwards rows to `export_xlsx`; handles mark-reported updates. | `packages/plugins/official/time-tracker/web/index.test.ts` covers panel behavior and operation mocks; it can be extended, or export-row construction can be extracted for focused tests. |
| `packages/plugins/official/time-tracker/server/index.ts` | Validates export rows, formats Description cell text, writes XLSX columns/formulas/wrapping/row heights, and returns the artifact payload. | `packages/plugins/official/time-tracker/server/index.test.ts` checks XLSX column widths and bullet formatting. |
| `packages/plugins/official/time-tracker/server/store.ts` | Persists task descriptions and entry notes; confirms no schema migration is required. | `packages/plugins/official/time-tracker/server/store.test.ts` covers task, entry, timer, and note persistence behavior. |

## Higher-Level Implementation Steps

- Update the export row aggregation record in `buildExportRows` to retain trimmed task description alongside item, total minutes, and note map.
- Reuse `getTaskById(entry.task_id)` to read `task.description`; default to an empty description for unknown tasks.
- Keep the current `normalizeExportNote` behavior and case-insensitive note de-duplication.
- Add a small formatter in the web export path that combines task description and note bullets according to the contract.
- Leave `exportXlsx` and its mark-reported loop unchanged.
- Leave the server `export_xlsx` input contract unchanged.
- Add tests for description-plus-notes, description-only, notes-only, duplicate note normalization, and empty cases.
- Update changelog/docs if this is treated as user-facing export behavior under repository conventions.

## Diagrams

_No diagrams applicable._

## Risks

- Server-side bullet normalization could alter lines that start with bullet-like characters; the task description should be passed as plain text and tests should cover expected multi-line output if necessary.
- Some existing users may have duplicated task summaries in entry notes. This design de-duplicates notes only against other notes, not against the task description, to avoid silently dropping user-entered detail.
- Entries whose task cannot be found should keep the current `Unknown task` behavior and simply omit task-description text.
- Reported-entry marking could regress if row construction is mixed with post-export updates; keep the existing post-export update loop isolated.

## Test Strategy

Recommended tests:

- Web/export row test for task description plus two unique notes:
  - description appears first,
  - a blank line separates it from notes,
  - `Notes:` appears,
  - notes are `•` bullets.
- Web/export row test for description-only rows.
- Web/export row test for notes-only rows preserving the current notes-only bullet shape.
- Web/export row test for duplicate note normalization and case-insensitive de-duplication.
- Server XLSX test, if needed, for a multi-line description containing a summary, `Notes:`, and bullets in cell `E2`.

Commands:

```bash
npm run lint
npm test -- packages/plugins/official/time-tracker
npm run build:plugins
```

Run broader `npm test` if feasible before merging.

## Open Assumptions

- The task description is intended to be the exported high-level summary for a row.
- `Task.description` is available in the panel state whenever export rows are built.
- The `Notes:` label should appear only when both a task description and at least one note exist.
- No migration or compatibility fallback is required because both source fields already exist.
