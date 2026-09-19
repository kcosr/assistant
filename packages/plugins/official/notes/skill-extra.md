Use these tools to create, read, update, search, and tag markdown notes stored by the Notes plugin.

- Pass `instance_id` to target a non-default notes instance when multiple instances are configured.
- Use `notes_list` or `notes_search` to discover note titles.
- Use `notes_read` to fetch full content and its `revision`.
- Use `notes_append` with `title` and `text` to add to an existing note without reading it first. Text is exact: include desired newlines. It returns the new revision and accepts optional `expectedRevision`. Missing notes fail; retries can duplicate text, so read first if a previous request’s outcome is uncertain.
- Use `notes_patch` with `expectedRevision` and `edits: [{oldText, newText}]` for targeted changes. Each old passage must match exactly once; all edits are checked against the original body and must not overlap. Empty `newText` deletes a passage.
- Use `notes_write` for creation or full replacement. Omit `expectedRevision` only for a new note; existing notes require the revision from `notes_read` or your last successful mutation.
- Successful writes and patches return the next revision. On `note_conflict`, reread and reconcile; do not blindly fetch a fresh token and overwrite intervening changes.
- Use `notes_rename` to rename a note within an instance.
- Use `notes_move` to move a note between instances.
- Use `notes_tags_add` and `notes_tags_remove` to adjust tags without rewriting the content.
