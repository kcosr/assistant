# Time tracker reported field + XLSX export

## Summary
Add a `reported` boolean on time entries (editable in the entry editor and available via operations), plus an XLSX export of time by task with a notes summary and formulas.

## Goals
- Persist a `reported` flag on each entry to mark work as reported/exported.
- Expose `reported` in entry create/update/list/get responses and inputs.
- Add an XLSX export from the panel that outputs one row per task with total duration and a notes summary, including formula columns.

## Non-goals
- Implementing a full reporting dashboard or recurring export schedules.
- Changing the timer workflow beyond adding the `reported` field.
- Adding new permissions or auth around exports.

## Data model
- Extend `Entry` with `reported: boolean`.
- Storage: add `reported` column to `entries` with default `false`.
- Backfill: existing rows default to `false` via migration.

## Operations / API / CLI
- `entry_create`: accept optional `reported` boolean (default `false`).
- `entry_update`: accept optional `reported` boolean (preserve existing when omitted).
- `entry_list`/`entry_get`: include `reported` in returned entries.
- Update `manifest.json`, `SPEC.md`, and README documentation.

## UI/UX
- Entry edit dialog: add a checkbox labeled "Reported".
- The checkbox writes `reported` on save; when unchecked, `reported=false`.
- Optional: display a small badge or icon in the entry row (if desired later); not required for this scope.
- Entries filter bar: add a "Show reported" checkbox; default unchecked. This controls list + totals + export.
- Export action opens a modal with a summary (counts + totals) and a checkbox: "Mark exported entries as reported" (default on).

## XLSX export
- Add an "Export XLSX" action in the Entries area (near range total or filter controls).
- Export is scoped to the current date range filter in the panel and respects the "Show reported" toggle.
- Export matches the current view scope: instance, selected task (if any), date range, and "Show reported".
- Upload the generated XLSX to the Artifacts plugin for download.
- Rows are grouped by task id; each row includes:
  - Item (task name)
  - Hours (integer, floor of total minutes / 60)
  - Minutes (integer remainder of total minutes % 60)
  - Hours (Decimal) (formula: `=Hours + Minutes/60`)
  - Description (bullet list of unique non-empty notes; case-insensitive uniqueness)
- Notes list formatting: `- note` per line in the Description cell (wrap text).
- Tasks with zero entries in range are omitted.
- Totals row at bottom with SUM formulas for Hours, Minutes, and Hours (Decimal).
- Highlight the Hours (Decimal) total cell with a green fill.
- Export parameter: `include_reported` boolean (default `false`) to include reported entries.
- If "Mark exported entries as reported" is checked, update only the exported entries after the XLSX is successfully generated and delivered.

## Storage / migrations
- Add migration version 2:
  - `ALTER TABLE entries ADD COLUMN reported INTEGER NOT NULL DEFAULT 0`.
- Update TypeScript `Entry` types and store read/write paths to map `reported` to boolean.

## Tests
- `packages/plugins/official/time-tracker/server/store.test.ts`: verify default `reported=false`, update sets it, list/get include it.
- `packages/plugins/official/time-tracker/server/index.ts` (or new tests if present): validate `entry_create`/`entry_update` accept boolean and reject non-boolean.
- UI: if feasible, add a lightweight test around entry editor payload (if a test harness exists for the panel).

## Files to update
- `packages/plugins/official/time-tracker/server/store.ts`
- `packages/plugins/official/time-tracker/server/index.ts`
- `packages/plugins/official/time-tracker/manifest.json`
- `packages/plugins/official/time-tracker/web/index.ts`
- `packages/plugins/official/time-tracker/SPEC.md`
- `packages/plugins/official/time-tracker/README.md`
- `packages/plugins/official/time-tracker/server/store.test.ts`
- `CHANGELOG.md`

## Open questions
- None.
