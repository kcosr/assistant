# Command Palette: Plugin Selection for All Profiles

## Status

**Draft** - January 2026

## Summary

When using `/search` and selecting "All" profiles, the command palette should show plugin selection before jumping to query mode, matching the behavior when a specific profile is selected.

## Problem

Current behavior:
1. `/search` → profile options (All, default, etc.)
2. Select "All" → **jumps directly to query mode** (skipping plugin selection)
3. Select a specific profile → shows plugin options → then query mode

The inconsistency makes it impossible to search all profiles but filter by plugin type (e.g., search all profiles but only notes).

## Proposed Behavior

Consistent staged flow regardless of profile selection:

1. `/search` → profile options (All, default, etc.)
2. Select any profile (including "All") → **show plugin options** (All, notes, lists, etc.)
3. Select any plugin (including "All") → enter query mode

## Code Changes

### `commandPaletteController.ts`

#### 1. Add `findScope` helper (match scope by plugin ID without profile filtering)

```typescript
private findScope(token: string): SearchableScope | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return this.scopes.find((scope) => scope.pluginId.toLowerCase() === normalized) ?? null;
}
```

#### 2. Modify `parseInput` to show scope selection when profile is skipped

Replace the early return when `profileSkipped` is true:

```typescript
// Before (current):
if (this.profileSkipped) {
  return { mode: 'query', profileId: null, scopeId: null, query: rest.trimStart() };
}

// After (proposed):
if (this.profileSkipped) {
  if (this.pluginSkipped) {
    return { mode: 'query', profileId: null, scopeId: null, query: rest.trimStart() };
  }
  // Show scope selection for "all profiles" case
  const scopeInfo = splitTokens(rest);
  if (scopeInfo.tokens.length === 0) {
    return { mode: 'scope', profileId: null, scopeQuery: '' };
  }
  const scopeToken = scopeInfo.tokens[0] ?? '';
  const scope = this.findScope(scopeToken);
  const scopeConfirmed = scope && (scopeInfo.tokens.length > 1 || scopeInfo.hasTrailingSpace);
  if (!scopeConfirmed) {
    return { mode: 'scope', profileId: null, scopeQuery: scopeToken };
  }
  return {
    mode: 'query',
    profileId: null,
    scopeId: scope.pluginId,
    query: scopeInfo.tokens.slice(1).join(' '),
  };
}
```

## Files to Update

- `packages/web-client/src/controllers/commandPaletteController.ts` — Add `findScope` helper and modify `parseInput`
- `packages/web-client/src/controllers/commandPaletteController.test.ts` — Add tests for all-profiles + plugin selection flow
- `docs/design/global-search-command-palette.md` — Update Stage 3 description to remove "Only shown if a specific profile was selected"

## Open Questions

None - this is a straightforward consistency fix.
