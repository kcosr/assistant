# AQL Query Language Improvements

## Overview

Enhance the AQL (Assistant Query Language) with three improvements:
1. Optional match term (allow standalone `order by` / `show`)
2. `~` operator as a distinct operator for substring matching (case-insensitive)
3. `text` pseudo-field for cross-field text search

## Motivation

- **Optional match term**: Reduce query verbosity when users only want to sort or select columns
- **`~` operator**: More intuitive syntax for users familiar with regex/fuzzy matching conventions
- **`text` pseudo-field**: Enable full-text search across all text fields without enumerating each one

## Current Implementation Analysis

**File**: `packages/shared/src/aql.ts`

### Finding 1: Optional Match Term Already Works! ✅

The parser already supports this. In `parseQuery()`:

```typescript
if (!this.isKeyword('SHOW') && !this.isKeyword('ORDER')) {
  where = this.parseExpression();
  // ...
}
```

The test suite confirms this:
```typescript
it('sorts with ORDER BY', () => {
  const result = parseAql('ORDER BY updated DESC, priority ASC', { customFields });
  // ... works correctly
});
```

**Action**: No code changes needed. May need documentation or UI fixes if users aren't seeing this work.

### Finding 2: `~` Operator Needs Implementation

**Tokenizer** (lines ~130-145): Currently recognizes `!`, `>`, `<`, `:`, `=` but not `~`.

**parseClause()** (lines ~230-250): Maps operators to semantic types:
```typescript
const op = opValue === ':'
  ? 'contains'
  : opValue === '!:'
    ? 'not_contains'
    // ... etc
```

### Finding 3: `text` Pseudo-Field Needs Implementation

**BUILTIN_FIELDS** (lines ~60-72): Defines available fields. Need to add a virtual `text` field.

**compileClause()** (lines ~350+): Resolves fields and compiles clauses. Need special handling to expand `text` to OR of all text fields.

## Proposed Solution

### 1. Add `~` and `!~` Operators

**Changes to tokenizer** (in the operator handling block):

```typescript
if (char === '!' || char === '>' || char === '<' || char === ':' || char === '=' || char === '~') {
  const two = input.slice(i, i + 2);
  if (two === '!=' || two === '>=' || two === '<=' || two === '!:' || two === '!~') {
    tokens.push({ type: 'operator', value: two, start, end: i + 2 });
    i += 2;
    continue;
  }
  tokens.push({ type: 'operator', value: char, start, end: i + 1 });
  i += 1;
  continue;
}
```

**Changes to AqlOperator type**:

```typescript
export type AqlOperator =
  | 'contains'      // : operator
  | 'not_contains'  // !: operator
  | 'similar'       // ~ operator (extensible to fuzzy later)
  | 'not_similar'   // !~ operator
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is_empty' | 'is_not_empty';
```

**Changes to parseClause()** operator mapping:

```typescript
const op = opValue === ':'
  ? 'contains'
  : opValue === '!:'
    ? 'not_contains'
  : opValue === '~'
    ? 'similar'
  : opValue === '!~'
    ? 'not_similar'
    // ... rest unchanged
```

**Changes to evaluateClause()**: Handle `similar` and `not_similar` the same as `contains` and `not_contains` for now:

```typescript
if (op === 'contains' || op === 'similar') {
  // substring case-insensitive match
}
if (op === 'not_contains' || op === 'not_similar') {
  // inverse
}
```

**Changes to opSymbol()** for serialization (optional, for display):

```typescript
// Could keep returning ':' for contains, or add preference tracking
```

### 2. Add `text` Pseudo-Field

**Add to BUILTIN_FIELDS**:

```typescript
{ name: 'text', key: 'text', label: 'Text', type: 'text', kind: 'builtin', displayable: false },
```

**Modify compileClause()** to expand `text` field:

```typescript
const compileClause = (raw: ClauseRaw): AqlClause | AqlExpr => {
  const field = resolveField(raw.field);
  
  // Special handling for 'text' pseudo-field
  if (field && field.key === 'text') {
    // Collect all text fields (builtin + custom)
    const textFields = getTextFields(options.customFields);
    
    // Build OR expression across all text fields
    const clauses = textFields.map(tf => ({
      type: 'clause' as const,
      clause: { field: tf, op: raw.op, value: raw.value, values: raw.values }
    }));
    
    return clauses.reduce((acc, clause) => ({
      type: 'or' as const,
      left: acc,
      right: clause
    }));
  }
  
  // ... existing logic
};
```

**Empty text field set**: built-ins (title/notes/url/tags) mean `textFields` should never be empty.
If we ever allow zero text fields, return a literal-false AQL expr or special-case evaluation to
match nothing.

**Helper function**:

```typescript
function getTextFields(customFields: ListCustomFieldDefinition[]): AqlField[] {
  const textFields: AqlField[] = [];
  
  // Builtin text fields (plus tags)
  for (const entry of BUILTIN_FIELDS) {
    if (entry.type === 'text' || entry.type === 'tag') {
      textFields.push({
        key: entry.key,
        label: entry.label,
        type: entry.type,
        kind: entry.kind,
        displayable: entry.displayable,
      });
    }
  }
  
  // Custom text fields
  for (const field of customFields) {
    if (field.type === 'text') {
      textFields.push({
        key: field.key,
        label: field.label || field.key,
        type: 'text',
        kind: 'custom',
        displayable: true,
      });
    }
  }
  
  return textFields;
}
```

**Note**: This changes the return type of `compileClause` since it can now return an `AqlExpr` (for the OR tree) instead of just `AqlClause`. This requires adjusting `compileExpr` to handle this.

**Text-only operators**: `text` only supports `:` / `!:` / `~` / `!~`. All other operators should throw a validation error.

**Alternative approach** (simpler): Instead of expanding at compile time, add special handling in `evaluateClause()`:

```typescript
// In evaluateClause, if field.key === 'text':
if (field.key === 'text') {
  const textFields = getTextFields(customFields); // Need to pass customFields
  return textFields.some(tf => {
    const value = getFieldValue(item, tf);
    // ... apply contains/not_contains logic
  });
}
```

This approach is simpler but requires threading `customFields` through to evaluation.

### 3. Web Client: "Press Enter" Hint When Clearing Filter

**Issue**: When user clears the AQL input while a filter is active, no hint is shown. The user may not realize they need to press Enter to apply the clear.

**Current behavior**:
- Adding query: shows "press enter or apply" hint ✅
- Clearing query: no hint shown ❌

**Desired behavior**: If `currentAppliedFilter !== ""` AND `inputValue === ""`, show the same hint.

**File**: `packages/web-client/src/controllers/listPanelController.ts` (or wherever AQL input is handled)

**Logic**:
```typescript
const showHint = inputValue !== appliedFilter;
// This covers both:
// - inputValue has content, appliedFilter is empty (adding)
// - inputValue is empty, appliedFilter has content (clearing)
```

**File**: `packages/plugins/official/lists/web/index.ts`

**Current logic** in `updateAqlStatusMessage()`:
```typescript
if (aqlDirty) {
  sharedSearchController.setStatusMessage('Press Enter or Apply to run.');
  return;
}
```

**Expected behavior**: `aqlDirty` should be `true` when clearing (since `aqlAppliedQueryText !== aqlQueryText`). If the hint isn't showing, investigate why `aqlDirty` might be `false` when it shouldn't be.

**Verification**: Check `handleSearchInputChange()` to ensure `aqlDirty` is set correctly when input is cleared:
```typescript
aqlDirty = (aqlAppliedQueryText ?? '') !== aqlQueryText;
// If aqlAppliedQueryText = "foo" and aqlQueryText = ""
// Then aqlDirty = "foo" !== "" = true ✓
```

### 4. List Switch: Reset AQL to Default

**Requirement**: When switching lists in a panel, clear any previous AQL entry and apply the new list's default query (if one exists).

**Expected behavior**:
- Selecting a new list resets `aqlQueryText` / `aqlAppliedQueryText` / `aqlAppliedQuery`.
- If the target list has a default saved query, switch to AQL mode and apply it.
- If no default query exists, AQL stays empty (no carry-over from the previous list).

## Files to Update

| File | Changes |
|------|---------|
| `packages/shared/src/aql.ts` | Tokenizer, AqlOperator type, parseClause, evaluateClause, text field handling |
| `packages/shared/src/aql.test.ts` | Add tests for `~`, `!~`, and `text` pseudo-field |
| `packages/plugins/official/lists/web/index.ts` | Fix hint display when clearing filter (if needed); reset AQL on list switch + apply list default |
| `packages/web-client/src/controllers/listPanelController.ts` | Show hint when clearing filter |
| `docs/AQL.md` | Document `~` and `text` pseudo-field |

## Implementation Steps

1. **Add `~` operator support** (low risk)
   - Update tokenizer to recognize `~` and `!~`
   - Map to new `similar`/`not_similar` operators
   - Handle in evaluateClause same as contains for now
   - Add tests

2. **Add `text` pseudo-field** (medium complexity)
   - Add to BUILTIN_FIELDS with `displayable: false`
   - Decide: compile-time expansion vs evaluation-time check
   - Implement text field expansion/search logic
   - Add tests

3. **Verify optional match term** (already works)
   - Confirm existing tests cover this
   - Add explicit test if needed: `SHOW title, notes`

4. **Web client: hint on clear** (low risk)
   - Update hint logic: show when `inputValue !== appliedFilter`
   - Covers both adding and clearing scenarios

## Decisions

1. **`~` as separate operator**: `:` and `~` should be **distinct operators internally** (not aliases). This allows `~` to be extended later for fuzzy/approximate matching while `:` remains simple substring contains.
   - Add new `AqlOperator` values: `'similar'` and `'not_similar'` for `~` and `!~`
   - Keep existing `'contains'` and `'not_contains'` for `:` and `!:`
   - Currently both behave identically (substring case-insensitive match)
   - Future: `~` can be enhanced for fuzzy matching, Levenshtein distance, etc.

2. **`text` field operators**: **Contains only** - `text` pseudo-field only supports `:` and `~` (contains/not_contains/similar/not_similar). Exact match (`=`, `!=`) not supported.

3. **`text` + tags**: **Yes** - `text : "foo"` searches tag values in addition to title, notes, url, and custom text fields.

4. **Empty result**: **Match nothing** - If no text fields exist, `text : "foo"` matches nothing rather than throwing an error.

## Alternatives Considered

### For `text` pseudo-field:

**Option A: Compile-time expansion** (recommended)
- Pros: Clean separation, reuses existing evaluation logic
- Cons: Changes return type of compileClause, larger AST

**Option B: Evaluation-time handling**
- Pros: Simpler changes to parser/compiler
- Cons: Requires threading customFields to evaluator, special case in evaluation

**Option C: Preprocessor**
- Expand `text : "foo"` to `(title : "foo" OR notes : "foo" OR ...)` before parsing
- Pros: Zero changes to parser
- Cons: Brittle, doesn't handle custom fields dynamically

Recommendation: **Option A** for cleaner architecture, but note it may need a small "match nothing" escape hatch if the text field list is empty.

## Out of Scope

- Fuzzy/approximate matching (Levenshtein distance)
- Regex matching
- Stemming or linguistic analysis
- Performance optimization for large datasets
