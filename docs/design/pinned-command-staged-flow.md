# Pinned Command Staged Flow

## Status

**Draft** - January 2026

## Summary

Modify the `/pinned` command to follow the same staged input flow as `/search`, allowing users to filter pinned items by profile and plugin while automatically applying `tag:pinned`.

## Problem

Current `/pinned` behavior:
- `/pinned` → immediately shows all pinned items across all profiles/plugins

Desired behavior:
- `/pinned` → profile selection → plugin selection → query input
- Results always filtered by `tag:pinned`

This would allow:
- `/pinned work notes` — show pinned notes in work profile
- `/pinned default lists` — show pinned lists in default profile
- `/pinned work notes meeting` — search pinned notes for "meeting"

## Proposed Solution

### Unified Command Handling

Refactor the command parsing to treat `/pinned` as a variant of `/search` with `tag:pinned` implicitly added to queries:

```typescript
type CommandType = 'search' | 'pinned';

// Track which command is active
private activeCommand: CommandType | null = null;
```

### Parse Input Changes

```typescript
if (isPinnedCommand) {
  if (normalizedCommand !== 'pinned') {
    return { mode: 'command', commandQuery: commandToken };
  }
  // Pinned command confirmed but no trailing space yet
  if (!hasTrailingSpace && !rest.trim()) {
    return { mode: 'command', commandQuery: commandToken };
  }
  this.activeCommand = 'pinned';
  // Fall through to use same staged flow as search...
}

if (isSearchCommand) {
  // ...existing search logic...
  this.activeCommand = 'search';
}

// Use same staged parsing for both commands
// The difference is handled in query execution
```

### Query Execution

When executing the search, prepend `tag:pinned` for pinned mode:

```typescript
private buildSearchQuery(state: ParsedState): string {
  const userQuery = state.query?.trim() ?? '';
  if (this.activeCommand === 'pinned') {
    return userQuery ? `tag:pinned ${userQuery}` : 'tag:pinned';
  }
  return userQuery;
}
```

### Ghost Text Update

Show appropriate placeholder for pinned mode:

```
/pinned <profile>          — profile selection
/pinned work <plugin>      — plugin selection  
/pinned work notes <query> — query input (tag:pinned auto-applied)
```

### Input Value Handling

When selecting options in pinned mode, maintain `/pinned` prefix:

```typescript
if (option.type === 'profile') {
  if (option.id === '__all__') {
    this.profileSkipped = true;
    this.setInputValue(this.activeCommand === 'pinned' ? '/pinned ' : '/search ');
    return;
  }
  const prefix = this.activeCommand === 'pinned' ? '/pinned' : '/search';
  this.setInputValue(`${prefix} ${option.id} `);
}
```

## Implementation Details

### State Tracking

Add `activeCommand` field to track whether we're in search or pinned mode:

```typescript
private activeCommand: 'search' | 'pinned' | null = null;
```

Reset in `open()`:
```typescript
this.activeCommand = null;
```

### Option Selection Handler Updates

Update `handleOptionSelection` to use `activeCommand`:

```typescript
if (option.type === 'command') {
  if (option.id === 'pinned') {
    this.activeCommand = 'pinned';
    this.setInputValue('/pinned ');
    return;
  }
  if (option.id === 'search') {
    this.activeCommand = 'search';
    this.setInputValue('/search ');
    return;
  }
}
```

### Backspace Handling

Update backspace to restore correct command prefix:

```typescript
if (this.activeMode === 'profile' && !(this.cachedState.profileQuery ?? '').trim()) {
  this.profileSkipped = false;
  this.setInputValue(this.activeCommand === 'pinned' ? '/pinned' : '/search');
  return true;
}
```

## Files to Update

- `packages/web-client/src/controllers/commandPaletteController.ts`:
  - Add `activeCommand` state field
  - Modify `parseInput` to handle `/pinned` with staged flow
  - Update `handleOptionSelection` to maintain command context
  - Update `handleBackspace` for pinned mode
  - Update `buildSearchQuery` or `scheduleSearch` to add `tag:pinned`
  - Update ghost text rendering for pinned placeholders

- `packages/web-client/src/controllers/commandPaletteController.test.ts`:
  - Add tests for `/pinned` staged flow
  - Add tests for query building with `tag:pinned`

- `docs/design/global-search-command-palette.md`:
  - Update documentation to describe pinned command's staged flow

## Open Questions

None - the feature mirrors `/search` behavior, just with `tag:pinned` filter applied.
