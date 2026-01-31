# AQL (Assistant Query Language)

AQL is a structured query mode for list items. It is available in the Lists panel when you
switch the search input to **AQL** (list mode only). Queries are applied explicitly with
Enter or the **Apply** button. Raw search mode still applies live as you type.

Saved queries:
- Use the Saved dropdown + Save/Delete controls to store and reuse AQL per list + instance.
- A single saved query can be marked as the default view for that list; it auto-applies when the list opens.

## Global query bar

The main header includes a **global query bar** that filters across panels (lists, notes,
and collection browsers).

- **Raw mode:** live text search with `@tag` / `!@tag` shortcuts (same tag dropdown behavior).
- **AQL mode:** applied explicitly with Enter or **Apply** (no live apply).
- **Shortcut:** `Ctrl+G` focuses the global query bar.

Global AQL uses the same grammar, with a smaller allowed field set and no `ORDER BY` / `SHOW`.

Allowed fields:
- `tag` / `tags`
- `instance` / `profile`
- `text`
- `favorite`
- `pinned`

Unsupported fields are treated as non-matching clauses for that item.

## Syntax

```
<expr>     := <term> ( (AND | OR) <term> )*
<term>     := NOT <term> | '(' <expr> ')' | <clause>
<clause>   := <field> <op> <value> | <field> IS EMPTY | <field> IS NOT EMPTY
<op>       := : | !: | ~ | !~ | = | != | > | >= | < | <= | IN
<orderBy>  := ORDER BY <field> (ASC|DESC)? ( , <field> (ASC|DESC)? )*
<show>     := SHOW <field> ( , <field> )*
```

Notes:
- `:` and `~` are case-insensitive contains; `!:` / `!~` are not-contains.
- `IN` accepts a comma-separated list in parentheses.
- `SHOW` controls which columns are visible and their order while AQL is active.
- `ORDER BY` controls list sorting while AQL is active.

## Fields

Built-ins:
- `text` (pseudo-field: searches title, notes, url, tags, and custom text fields)
- `title`, `notes`, `url`
- `tag`
- `added`, `updated`, `touched`
- `completed`, `position`

Custom fields:
- Use the custom field key or label (labels must be unique).
- `text` only supports `:` / `!:` / `~` / `!~`.

## Examples

```
status = "Ready" AND NOT title : "wip"
```

```
priority >= 2 AND tag IN (urgent, "needs-review")
ORDER BY updated DESC
SHOW title, status, priority
```

```
text ~ "on-call"
```
