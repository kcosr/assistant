# Tool Output Windowing And Hydration

## Problem

The chat UI becomes slow when many tool calls are present in the transcript, even while idle.

Current behavior keeps a large amount of tool DOM mounted at once:

- tool input and output sections are fully rendered for every tool block
- rendered markdown/code blocks stay in the DOM even when the tool block is collapsed
- large transcripts keep old tool blocks mounted indefinitely
- group summary updates rescan existing DOM repeatedly

Disabling tool rendering makes the UI fast again, which indicates the main problem is mounted DOM size and DOM complexity, not only streaming update cost.

## Goals

- Keep the chat fast while idle, even with large transcripts containing many tool calls
- Preserve current tool-call semantics and grouping behavior
- Avoid a framework rewrite
- Reuse the current non-React renderer/controller architecture

## Success Metrics

Define explicit success criteria for the first implementation:

- large transcript idle interactions should remain visually responsive, with no obvious click lag
- collapsed tool blocks should not mount `.tool-output-input-body` or `.tool-output-output-body`
- mounted hydrated tool bodies should scale with viewport visibility, not transcript length
- transcript replay must still produce the same visible ordering and content as before
- auto-scroll behavior for active turns must remain stable

Prefer adding measurable checks where possible:

- mounted tool body count in large transcript fixtures
- total mounted row count under windowing
- scroll-to-bottom correctness in active sessions
- replay parity against existing transcript fixtures

## Non-goals

- No transcript data migration
- No protocol change for chat/tool events
- No line-level virtualization inside a single large tool output in phase one
- No change to how tool results are stored in memory or transcript history

## Requirements And Constraints

### Scroll Management

This work must integrate with the existing chat scroll behavior rather than layering around it.

In particular:

- auto-scroll and "user scrolled away" logic must remain correct under spacer-based windowing
- bottom detection cannot rely on naive `scrollHeight` assumptions once rows are mounted/unmounted
- active-turn streaming must keep the newest tail stable without jitter

### Accessibility And Search

Windowing and dehydration change what exists in the DOM.

Requirements:

- keyboard focus must never be lost when collapsing, dehydrating, or evicting rows
- expanded/collapsed state must remain screen-reader discoverable for mounted rows
- the design must explicitly accept that browser native find-in-page will only work on mounted DOM

Follow-up work may add custom transcript search, but phase one does not require it.

### Dual Renderer Scope

Both renderers are in scope for this design:

- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/messageRenderer.ts`

The plan should not improve one renderer while leaving the other on the old DOM-heavy path.

## Current Hot Paths

Primary files:

- `packages/web-client/src/utils/toolOutputRenderer.ts`
- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/messageRenderer.ts`
- `packages/web-client/src/chatScroll.ts`

Current expensive behavior:

- `updateToolOutputBlockContent()` rebuilds output sections with `innerHTML = ''` and re-renders markdown for full accumulated output
- `setToolOutputBlockInput()` rebuilds input sections and toggle UI
- `applyMarkdownToElement()` reparses markdown, sanitizes HTML, highlights code, replaces DOM, and rebinds code-copy UI
- old tool blocks remain mounted even when collapsed and far offscreen

## Design Summary

Use a three-layer approach:

1. Replace fully rendered collapsed tool blocks with cheap shell views
2. Lazily hydrate tool block bodies only when expanded or in view
3. Window top-level transcript rows so old offscreen rows are not mounted

The critical rule is:

Collapsed or offscreen tool blocks must be structurally cheap, not merely visually hidden.

## Proposed Rendering Model

### 1. Stable Tool Block Shell

Each tool call gets a persistent shell element:

- header
- status
- summary label
- optional lightweight preview text
- expand/collapse control

The shell is cheap and always mounted when the row itself is mounted.

The shell does not require:

- rendered markdown output body
- rendered input body
- syntax highlighted code
- JSON toggle body

Those heavy nodes are mounted only when the block is hydrated.

### 2. Tool Block Body Hydration

Each tool block has two states:

- `shell`
- `hydrated`

In `shell` state:

- keep raw input and raw output in memory on the view/controller object
- render only the header and a short preview
- no heavy markdown subtree exists in DOM

In `hydrated` state:

- build the input/output body nodes on demand
- render markdown or code formatting only once per hydrated version
- preserve toggle state only while hydrated

Hydration triggers:

- user expands the tool block
- tool block enters the viewport and user preference requests auto-expanded tool output

Dehydration triggers:

- user collapses the tool block
- row scrolls sufficiently far out of view
- transcript window manager evicts old rows

### 3. Row-Level Windowing

Window the top-level transcript rows, not the internal lines of a tool block.

A row is one of:

- user message
- assistant text segment
- thinking segment
- tool-call group
- standalone tool block
- interaction block
- system/info row

The renderer keeps:

- visible rows
- small overscan above and below
- a recent tail of newest rows always mounted
- top and bottom spacer elements to preserve scroll height

Rows outside the window are represented only by spacer height, not live DOM.

This mirrors the key pattern from the React app: old history is not kept mounted.

## View Objects

Introduce explicit view objects instead of querying and rebuilding DOM subtrees repeatedly.

### `ToolCallView`

Owns:

- root shell element
- header button
- status element
- preview element
- optional body container
- hydration state
- raw input text
- raw output text
- tool metadata
- cached rendered mode flags

Methods:

- `setHeaderLabel(label)`
- `setStatus(state, label?)`
- `setInputText(text, options)`
- `appendOutputChunk(chunk)`
- `setFinalOutput(text, options)`
- `hydrateBody()`
- `dehydrateBody()`
- `setExpanded(expanded)`
- `dispose()`

Important constraints:

- no repeated `querySelector()` on hot paths
- no repeated `innerHTML = ''` for unchanged sections
- no re-registering toggle listeners on every update

`dispose()` is responsible for:

- removing event listeners owned by the view
- detaching hydrated body subtrees
- releasing cached DOM references that are no longer needed after row eviction
- leaving canonical raw input/output data ownership to the controller/model layer

### `ToolCallGroupView`

Owns:

- group root
- group header
- count
- summary
- state
- ordered child `ToolCallView`s

Methods:

- `appendCall(view)`
- `removeCall(view)`
- `refreshFromIncrementalState()`

Group metadata should be updated incrementally instead of rescanning all child blocks on every tool output update.

### `TranscriptWindowManager`

Owns:

- full logical row list
- visible row range
- top spacer
- bottom spacer
- mounted row map
- cached row heights

Methods:

- `setRows(rows)`
- `onScroll(scrollTop, viewportHeight)`
- `mountRange(start, end)`
- `unmountRange(start, end)`
- `measureRow(rowId, height)`

## Row Construction

Build a lightweight logical transcript model separate from DOM:

```ts
interface TranscriptRow {
  id: string;
  kind:
    | 'user-message'
    | 'assistant-text'
    | 'thinking'
    | 'tool-group'
    | 'tool-standalone'
    | 'interaction'
    | 'info';
  estimatedHeight: number;
  stickyTail?: boolean;
  render: () => HTMLElement;
  dehydrate?: () => void;
}
```

The current controllers already maintain enough identity and buffering state to construct this model.

Replay must use the same row model and windowing path as live rendering so transcript replay and live sessions do not diverge.

## Tool Output Formatting Rules

Do not treat all tool input/output as markdown by default.

Preferred rendering:

- `bash`/`shell`/`sh`: plain `<pre>` while streaming, optional syntax highlighting after hydrate/finalize
- `read`/`write`/`edit`: structured path/content display, content in `<pre>`
- JSON-like tool results: pretty-printed JSON in `<pre>`
- markdown-native tools such as note readers: markdown render only when hydrated
- `agents_message`: markdown only for the actual exchanged prose, not for all metadata scaffolding

This reduces DOM size and parsing cost even before windowing.

## Idle Performance Strategy

The design targets idle-time slowness directly:

- offscreen rows are not mounted
- collapsed tool blocks do not keep full rendered bodies in DOM
- only visible expanded tool output remains hydrated
- old hydrated blocks can be dehydrated when they leave the viewport

This means the browser does not need to style/layout/paint thousands of nested code blocks and markdown nodes on every click.

## Scroll And Measurement Strategy

Use approximate heights first:

- message rows: estimate by text length
- tool shell rows: fixed compact height
- hydrated tool rows: estimate from preview and known output length

Then correct with measured height after mount.

Rules:

- keep the newest tail fully mounted to avoid scroll jitter during active turns
- preserve scroll position when offscreen rows mount/unmount
- measure only mounted rows

## Phase Plan

### Phase 1: Cheap Collapsed Tool Blocks

Scope:

- add `ToolCallView`
- convert `toolOutputRenderer.ts` to create stable shell nodes
- keep collapsed blocks shell-only
- hydrate full body only on expand

Expected impact:

- large idle improvement with minimal architecture change

Files:

- `packages/web-client/src/utils/toolOutputRenderer.ts`
- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/messageRenderer.ts`

### Phase 2: Auto-Dehydrate Offscreen Tool Bodies

Scope:

- use `IntersectionObserver` or scroll-based visibility checks
- dehydrate expanded but offscreen tool bodies after they leave the viewport
- rehydrate on re-entry or re-expand

Expected impact:

- further idle improvement in long sessions with many previously expanded blocks

Notes:

- this phase is intentionally a standalone improvement before full transcript windowing exists
- once phase 3 lands, phase 2 visibility tracking may be replaced by the row window manager
- hydration/dehydration behavior survives; only the viewport bookkeeping may change

### Phase 3: Row-Level Transcript Windowing

Scope:

- add `TranscriptWindowManager`
- move transcript rendering to logical rows + mounted range
- keep a recent tail mounted
- represent old rows with spacers

Expected impact:

- biggest long-transcript win
- reduces DOM size across all message types, not only tool output

### Phase 4: Streaming-Specific Optimizations

Scope:

- batch tool/output DOM updates on `requestAnimationFrame`
- stop reparsing full markdown for streaming tool output
- stop reparsing full markdown for assistant text chunks

Expected impact:

- lower CPU during active streaming
- not the primary fix for the current idle problem, but still worthwhile

## Implementation Plan

### Step 1: Introduce `ToolCallView`

Create a small view class or factory module that:

- creates the block shell once
- stores raw input/output strings
- keeps direct references to header/status/preview/body nodes
- supports explicit hydrate/dehydrate methods

Suggested location:

- `packages/web-client/src/utils/toolCallView.ts`

### Step 2: Move tool body rendering behind hydration

Refactor `toolOutputRenderer.ts` so:

- `createToolOutputBlock()` builds only the shell
- input/output renderers build body content only in `hydrateBody()`
- collapse destroys or detaches the body subtree
- expand rebuilds it from stored raw text plus tool metadata

### Step 3: Add compact preview generation

For shell state, compute a lightweight preview:

- first line of command
- file path
- first line of output
- changed file count
- truncation badge

No markdown rendering in shell state.

### Step 4: Replace DOM rescans with incremental group state

Track group state in `ToolCallGroupView`:

- increment count on append
- update summary from latest child
- update group state when child status changes

Remove repeated `querySelectorAll(':scope > .tool-output-block')` scans from hot paths.

### Step 5: Add viewport-driven body dehydration

Add a lightweight visibility manager that:

- tracks visible tool shells
- dehydrates bodies that move well outside viewport
- skips dehydration for actively streaming blocks

Define the transition explicitly:

- streaming blocks are never dehydrated
- finalized blocks become eligible for dehydration only after terminal tool result state is applied
- rehydration must always reconstruct from canonical raw input/output buffers, not DOM state

### Step 6: Add transcript row windowing

Introduce a window manager around the chat container:

- maintain logical rows separate from mounted DOM
- mount only visible range + overscan
- keep a fixed newest tail mounted
- cache measured heights per row id

This should wrap existing renderers rather than rewriting event ingestion.

The window manager must integrate with the existing scroll manager so:

- bottom anchoring still works for active sessions
- replay and initial transcript load preserve expected scroll position
- upward scrolling into old history does not produce visible jumps beyond normal measurement correction

## Testing Plan

### Unit Tests

- `ToolCallView` shell/hydrate/dehydrate lifecycle
- compact preview generation per tool type
- group incremental state updates
- row window range calculation
- row height cache updates
- scroll-state calculations under spacer-based windowing

### Integration Tests

- collapsed tool blocks do not contain `.tool-output-input-body` or `.tool-output-output-body`
- expanding a block hydrates bodies with correct content
- collapsing dehydrates bodies but preserves status and preview
- offscreen hydrated blocks are dehydrated after scroll
- visible blocks rehydrate correctly on return
- transcript windowing mounts only visible rows plus overscan
- scroll position remains stable as rows mount/unmount
- replay uses the same rendering model and preserves transcript ordering/content
- both `chatRenderer.ts` and `messageRenderer.ts` follow the same shell/hydration behavior
- rapid expand/collapse during streaming does not corrupt tool output state
- JSON toggle state survives dehydrate/rehydrate when state retention is enabled

### Performance Checks

Add browser-level checks for:

- mounted `.tool-output-output-body` count in large transcripts
- total `.tool-output-block` descendant node count before and after windowing
- click latency in transcripts with many tool calls
- auto-scroll correctness while a long transcript is mounted

## Risks

- scroll-position bugs while rows mount/unmount
- hydration flicker when expanding or scrolling quickly
- losing UI state for JSON toggle or expanded sections on dehydrate
- complexity from keeping both legacy renderer paths aligned
- browser find-in-page only searching mounted rows
- screen-reader behavior degrading if eviction/focus rules are incomplete

## Mitigations

- keep newest tail always mounted
- make hydration idempotent and driven from canonical raw buffers
- preserve per-block UI state in the view object, not in DOM
- move shared behavior behind one new view module before broader rollout

## Recommended Order

Recommended order of execution:

1. Phase 1: cheap collapsed tool blocks
2. Phase 2: offscreen body dehydration
3. Phase 3: row-level windowing
4. Phase 4: streaming update optimizations

This order matches the reported pain:

- the current dominant issue is idle slowness from too much mounted tool DOM
- phase 1 and phase 2 attack that directly
- phase 3 removes the remaining long-history DOM cost
- phase 4 is useful, but secondary to the user-visible idle problem

## Open Questions

- Should auto-expanded tool output hydrate immediately when mounted, or only when the user explicitly expands?
- Should dehydrate preserve JSON-vs-formatted toggle state across scroll eviction?
- Should transcript windowing treat a tool group as one row even when one child is expanded, or should expanded tool calls become standalone rows?
- Is `IntersectionObserver` sufficient for offscreen hydration, or is a scroll-driven range manager simpler given the eventual row windowing work?

Current design decision:

- phase 2 may use `IntersectionObserver` as a temporary visibility signal
- phase 3 row windowing becomes the long-term viewport authority
