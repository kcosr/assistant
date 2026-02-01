# CLI Process Orphan on Disconnect

## Problem

When a user clicks stop/cancel or reloads the page, the WebSocket connection closes but the active CLI process (pi-cli, claude) may continue running in the background. When the user reconnects and sends a new message, a second CLI process can start for the same session, resulting in:

1. Multiple CLI executables running simultaneously
2. One agent working in the background without user visibility
3. Potential race conditions and resource waste

## Root Cause Analysis

### Connection Close Flow

When a WebSocket closes (page reload, network drop, explicit close):

1. `SessionRuntime.closeInternal()` is called
2. It calls `sessionHub.detachConnectionFromAllSessions(connection)`
3. `detachConnectionFromAllSessions` only:
   - Unsubscribes the connection from sessions
   - Unregisters the connection
   - Does **NOT** abort `activeChatRun`

### The Gap

```typescript
// sessionHub.ts line 560
activeChatRun: existing?.activeChatRun, // Preserve active run if reloading
```

This comment indicates intentional design to preserve runs across quick reconnects. However:
- The CLI process continues running with no active listener
- Session state may be evicted from memory while CLI runs
- On reconnect, `activeChatRun` may be undefined even though CLI is still running

### cliProcessRegistry

The registry tracks active CLI processes but only for server shutdown cleanup - it doesn't tie processes to specific sessions or handle session-level cleanup.

## Scenarios

### Scenario 1: Page Reload (Quick Reconnect)
1. User sends message, CLI starts
2. User reloads page → WS closes
3. User reconnects quickly, session state preserved (activeChatRun still set)
4. User sends new message → queued (working as intended)
5. **BUT**: If old run hangs, queue never drains

### Scenario 2: Page Reload (Session Evicted)
1. User sends message, CLI starts  
2. User reloads page → WS closes
3. Session state evicted from memory (pruning)
4. User reconnects → session state rebuilt from disk
5. `activeChatRun` is undefined (not persisted)
6. User sends message → NEW CLI process starts
7. Two CLI processes now running for same session

### Scenario 3: Cancel/Stop
1. User sends message, CLI starts
2. User clicks stop → abort signal sent
3. CLI *should* terminate, but `terminateChildProcessTree` may fail silently
4. User sends new message → could start second process

## Solution Options

### Option A: Abort Active Runs on Last Connection Disconnect

When the last connection for a session disconnects, abort any active run.

```typescript
// In sessionHub or sessionRuntime
detachConnectionFromAllSessions(connection: SessionConnection): void {
  const sessionIds = this.connections.getSubscriptions(connection);
  
  for (const sessionId of sessionIds) {
    // Check if this was the last connection for this session
    const remainingConnections = this.connections.getSessionConnections(sessionId);
    if (remainingConnections.size === 1) { // Only this one left
      const state = this.sessions.get(sessionId);
      if (state?.activeChatRun) {
        state.activeChatRun.abortController.abort();
        state.activeChatRun = undefined;
      }
    }
  }
  
  // ... existing unsubscribe logic
}
```

**Pros**: Simple, deterministic cleanup  
**Cons**: May abort runs user wanted to continue after reconnect

### Option B: Track CLI Process Per Session (Recommended)

Enhance `cliProcessRegistry` to track session → process mapping:

```typescript
const sessionProcesses = new Map<string, { pid: number; child: ChildProcess }>();

export function registerSessionCliProcess(sessionId: string, child: ChildProcess): void {
  // Kill any existing process for this session first
  const existing = sessionProcesses.get(sessionId);
  if (existing) {
    terminateProcess(existing.child);
  }
  // Register new process
  sessionProcesses.set(sessionId, { pid: child.pid!, child });
}
```

Before starting a new CLI, check and kill any orphaned process for that session.

**Pros**: Handles all scenarios, allows run continuation  
**Cons**: More complex, requires passing sessionId through CLI spawn

### Option C: Timeout-Based Cleanup

Add a timeout to orphaned runs - if no connection within N seconds, abort.

**Pros**: Graceful handling of quick reconnects  
**Cons**: Delayed cleanup, complexity

## Recommended Approach

**Option B** is most robust. Implementation:

1. **Extend `cliProcessRegistry`** with session-aware tracking
2. **Before spawning CLI**, check for existing process for session and terminate it
3. **On process exit**, clean up registry entry
4. **On session delete**, terminate any associated process

## Files to Update

1. `packages/agent-server/src/ws/cliProcessRegistry.ts`
   - Add session → process mapping
   - Add `registerSessionCliProcess()` and `killSessionProcess()`

2. `packages/agent-server/src/ws/claudeCliChat.ts`
   - Pass sessionId to registry on spawn
   - Call session-aware registration

3. `packages/agent-server/src/sessionHub.ts`
   - On session delete, call `killSessionProcess(sessionId)`

4. Tests for the new registry behavior

## Open Questions

1. Should quick reconnects (< 5s) preserve the running process, or always terminate on disconnect?
2. Should there be a UI indicator when reconnecting to a session with an active background run?
3. For external/scheduled sessions, should the behavior differ?
