# Client-Interactive Tools

## Overview

This design introduces a mechanism for tools to request client-side interaction during execution. The **tool handler decides** when interaction is needed and controls all related logic (including any approval caching).

Primary patterns:

1. **Approval gates** — A tool that does server-side work can pause and request user approval before proceeding. The tool owns the approval logic — when to ask, how to cache grants, etc.

2. **Client-only tools** — Tools whose entire purpose is relaying to/from the user. There's no server-side "work" — the handler just calls `ctx.requestInteraction()` and returns the user's response as the tool result. (e.g., `ask_user` presents a question and returns the answer)

## Current State

Today, tool execution is entirely server-side:

```
Agent → tool_call → Server executes immediately → tool_result → Agent
                  ↓
            Client receives tool_call_start (notification only)
```

The client has no opportunity to intervene during execution.

## Proposed Flow

```
Agent → tool_call → Tool handler starts executing
                          ↓
                    Tool calls ctx.requestInteraction({ onResponse, onTimeout, ... })
                          ↓
          Server emits interaction_request ChatEvent (broadcast + persisted)
                          ↓
                    Client renders UI (dialog, form, etc.)
                          ↓
             User responds → client sends tool_interaction_response
                          ↓
            Server invokes onResponse hook + emits interaction_response
                          ↓
            ┌─────────────┴─────────────┐─────────────────┐
            │                           │                 │
    { complete: result }        { reprompt: ... }    { pending: ... }
            │                           │                 │
            ↓                           ↓                 ↓
    Resolve Promise with result   Send new request   Resolve with pending
    tool_result → Agent          (loop back ↑)       Agent told to wait
```

## ASCII Diagrams

### 1) Interactive Tool Sequence (Happy Path)

```
Agent            Server                 Client
  |                |                      |
  |-- tool_call -->|                      |
  |                |-- interaction_request (ChatEvent) -->|
  |                |                      |-- render UI --|
  |                |<-- tool_interaction_response --------|
  |                |-- interaction_response (ChatEvent) ->|
  |<-- tool_result |                      |
```

### 2) Reprompt Loop

```
Agent            Server                 Client
  |                |                      |
  |-- tool_call -->|                      |
  |                |-- interaction_request -->
  |                |                      |-- render UI --|
  |                |<-- response (invalid) --|
  |                |-- interaction_response ->|
  |                |-- interaction_request (reprompt) -->|
  |                |                      |-- render UI --|
  |                |<-- response (valid) --|
  |                |-- interaction_response ->|
  |<-- tool_result |                      |
```

### 3) Pending + Late Response

```
Agent            Server                 Client
  |                |                      |
  |-- tool_call -->|                      |
  |                |-- interaction_request -->
  |                |                      |-- render UI --|
  |                |<-- no response (timeout) --|
  |                |-- tool_result (queued) ---> Agent
  |                |                      |
  |                |<-- user responds later ----|
  |                |-- interaction_response ->|
  |<-- user_message (late answer) ---------|    (new turn)
```

### 4) Multiple Clients (First Response Wins)

```
Server broadcasts interaction_request
  ├─ Client A shows UI
  └─ Client B shows UI

Client A responds first
  ├─ Server accepts A's response
  └─ Server emits interaction_response (ChatEvent)
       ├─ Client A marks completed
       └─ Client B marks completed (read-only)
```

## Core Concept: Hook-Based Interaction

Instead of a simple request/await pattern, tools register **interaction handlers** that get called when the user responds. This gives the tool full control over:

- **Validation** — Re-prompt if input is invalid
- **Completion** — Return a result to the agent
- **Async behavior** — Do something else entirely (send email, schedule follow-up, etc.)
- **Approval scoping** — Tool defines how approvals are keyed (per tool, per arg set, etc.)

The tool doesn't block waiting for the user. It registers interest and provides callbacks.

### ToolContext Addition

```typescript
interface ToolContext {
  // ... existing fields ...
  
  /**
   * Request interaction from the client.
   * Returns a Promise that resolves when the tool completes
   * (via the onResponse/onTimeout handlers).
   */
  requestInteraction(request: InteractionRequest): Promise<unknown>;

  /**
   * Optional helper for storing approvals.
   * Tools define their own keys (e.g. `bash:${command}:${cwd}`).
   */
  approvals?: ToolApprovals;
}

interface ToolApprovals {
  get(key: string, sessionId?: string): Promise<'once' | 'session' | 'always' | null>;
  set(key: string, scope: 'once' | 'session' | 'always', sessionId?: string): Promise<void>;
  clearSession(sessionId: string): Promise<void>;
}

interface InteractionRequest {
  /** Type of interaction */
  type: 'approval' | 'input';
  
  /** For approval: prompt to show the user */
  prompt?: string;
  
  /** For approval: which scopes to offer in the UI (default: ['once','session']) */
  approvalScopes?: Array<'once' | 'session' | 'always'>;
  
  /** For input: form schema */
  inputSchema?: {
    type: 'form';
    fields: InputField[];
  };
  
  /** Timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  
  /**
   * Called when the user responds. Plugin decides what to do:
   * - Return { complete: result } to finish the tool call
   * - Return { reprompt: newRequest } to show another interaction
   * - Return { pending: message } to tell agent to wait (tool stays "open")
   */
  onResponse: (response: UserResponse) => InteractionOutcome | Promise<InteractionOutcome>;
  
  /**
   * Called if the user doesn't respond in time.
   * Plugin can complete with error, send notification, etc.
   */
  onTimeout?: () => InteractionOutcome | Promise<InteractionOutcome>;
  
  /**
   * Called if the chat run is cancelled while waiting.
   */
  onCancel?: () => void;
}

/** What the user did */
interface UserResponse {
  action: 'approve' | 'deny' | 'submit' | 'cancel';
  approvalScope?: 'once' | 'session' | 'always';
  input?: Record<string, unknown>;
  reason?: string;
}

/** What the tool wants to do next */
type InteractionOutcome =
  | { complete: unknown }                    // Finish tool call with this result
  | { reprompt: Omit<InteractionRequest, 'onResponse' | 'onTimeout' | 'onCancel'> }  // Ask again
  | { pending: { message: string; queued?: boolean } }; // Tell agent it's queued; late responses follow up via user_message

interface InputField {
  id: string;
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio';
  label: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
  options?: { value: string; label: string }[];
}
```

### Example: Tool with Approval Logic

```typescript
handler: async (args, ctx) => {
  // Tool defines its approval key granularity
  const approvalKey = `delete_files:${args.files.join(',')}`;
  const cachedApproval = ctx.approvals
    ? await ctx.approvals.get(approvalKey, ctx.sessionId)
    : await myStore.getApproval(ctx.sessionId, approvalKey);
  
  if (cachedApproval) {
    // Already approved, just do the work
    return deleteFiles(args.files);
  }
  
  // Request approval — provide handler for when user responds
  return ctx.requestInteraction({
    type: 'approval',
    prompt: `Delete ${args.files.length} files?`,
    approvalScopes: ['once', 'session', 'always'], // omit to default to ['once','session']
    
    onResponse: async (response) => {
      if (response.action === 'deny') {
        return { complete: { ok: false, denied: true, reason: response.reason } };
      }
      
      // Cache approval if user chose session/always scope
      if (response.approvalScope === 'session' || response.approvalScope === 'always') {
        if (ctx.approvals) {
          await ctx.approvals.set(approvalKey, response.approvalScope, ctx.sessionId);
        } else {
          await myStore.cacheApproval(ctx.sessionId, approvalKey, response.approvalScope);
        }
      }
      
      // Do the work and complete
      const result = await deleteFiles(args.files);
      return { complete: result };
    },
    
    onTimeout: () => {
      return { complete: { ok: false, error: 'Approval timed out' } };
    },
  });
}
```

### Example: Questionnaire Tool (Client-Only)

For `ask_user`, there's no server-side work — just relay to client and return response:

```typescript
const askUserTool: BuiltInToolDefinition = {
  name: 'ask_user',
  description: 'Ask the user a question and return their answer.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask' },
      inputType: { type: 'string', enum: ['text', 'textarea', 'select'] },
      options: { type: 'array', items: { type: 'string' } },
    },
    required: ['question'],
  },
  
  handler: async (args, ctx) => {
    const { question, inputType = 'text', options } = args as {
      question: string;
      inputType?: string;
      options?: string[];
    };
    
    const fields: InputField[] = [{
      id: 'answer',
      type: inputType as InputField['type'],
      label: question,
      required: true,
      ...(options ? { options: options.map(o => ({ value: o, label: o })) } : {}),
    }];
    
    return ctx.requestInteraction({
      type: 'input',
      inputSchema: { type: 'form', fields },
      
      onResponse: (response) => {
        if (response.action === 'cancel') {
          return { complete: { ok: false, cancelled: true } };
        }
        return { complete: { ok: true, answer: response.input?.answer } };
      },
    });
  },
};
```

### Example: Validation with Re-prompt

Tool can validate input and ask again:

```typescript
handler: async (args, ctx) => {
  return ctx.requestInteraction({
    type: 'input',
    inputSchema: {
      type: 'form',
      fields: [{ id: 'email', type: 'text', label: 'Enter your email', required: true }],
    },
    
    onResponse: (response) => {
      if (response.action === 'cancel') {
        return { complete: { ok: false, cancelled: true } };
      }
      
      const email = response.input?.email as string;
      
      // Validate
      if (!email.includes('@')) {
        // Re-prompt with error message
        return {
          reprompt: {
            type: 'input',
            prompt: 'Invalid email address. Please try again.',
            inputSchema: {
              type: 'form',
              fields: [{ id: 'email', type: 'text', label: 'Enter your email', required: true }],
            },
          },
        };
      }
      
      return { complete: { ok: true, email } };
    },
  });
}
```

### Example: Async Fallback (Email Notification)

If user doesn't respond, do something else:

```typescript
handler: async (args, ctx) => {
  return ctx.requestInteraction({
    type: 'input',
    inputSchema: { /* ... */ },
    timeoutMs: 60_000, // 1 minute
    
    onResponse: (response) => {
      return { complete: { ok: true, answer: response.input?.answer } };
    },
    
    onTimeout: async () => {
      // User didn't respond — send email and tell agent to wait
      await sendEmailNotification(args.userEmail, 'Please respond to the question');
      
      // Return "pending" — agent gets a queued status
      // Late user responses will be delivered as user_message follow-ups
      return {
        complete: {
          ok: true,
          pending: true,
          queued: true,
          message: 'User notified via email. Response will arrive asynchronously.',
        },
      };
    },
  });
}
```

## Plugin Usage (No Manifest Changes Required)

Plugins can use `ctx.requestInteraction()` directly inside their handlers. This keeps the manifest schema unchanged and avoids extra wiring.

```typescript
handler: async (args, ctx) => {
  return ctx.requestInteraction({
    type: 'input',
    inputSchema: {
      type: 'form',
      fields: [{ id: 'answer', type: 'text', label: 'Your answer' }],
    },
    onResponse: (response) => {
      if (response.action === 'cancel') {
        return { complete: { ok: false, cancelled: true } };
      }
      return { complete: { ok: true, answer: response.input?.answer } };
    },
  });
}
```

If we later want declarative hook mapping in manifests, we can add it as an optional enhancement. For now, the recommended approach is to keep interaction logic in code and leave the manifest untouched.

## Protocol Changes

### ChatEvent: `interaction_request`

Interaction requests are emitted as `chat_event` messages (broadcast + persisted). Each prompt gets a unique `interactionId`.

```typescript
interface InteractionRequestEvent {
  type: 'interaction_request';
  toolCallId: string;
  interactionId: string;   // Unique per prompt (reprompts are distinct)
  toolName: string;
  interactionType: 'approval' | 'input';
  prompt?: string;
  inputSchema?: {
    type: 'form';
    fields: InputField[];
  };
  timeoutMs?: number;
}
```

### Client → Server: `tool_interaction_response`

Client sends this message when the user responds:

```typescript
interface ClientToolInteractionResponseMessage {
  type: 'tool_interaction_response';
  sessionId: string;
  callId: string;
  interactionId: string;
  
  action: 'approve' | 'deny' | 'submit' | 'cancel';
  approvalScope?: 'once' | 'session' | 'always';
  input?: Record<string, unknown>;
  reason?: string;
}
```

### ChatEvent: `interaction_response`

The server emits this after processing the user's response. It doubles as the "completion" signal to all clients.

```typescript
interface InteractionResponseEvent {
  type: 'interaction_response';
  toolCallId: string;
  interactionId: string;
  action: 'approve' | 'deny' | 'submit' | 'cancel';
  approvalScope?: 'once' | 'session' | 'always';
  input?: Record<string, unknown>;
  reason?: string;
}
```

Clients receiving the response event should:
- Match by `interactionId` (ignore stale responses)
- Disable the interaction UI (no more editing/submitting)
- Display submitted values read-only
- Optionally show "answered on another device"

## Server Implementation

### Implementing requestInteraction with Hooks

The server manages a loop: send request → wait for response → invoke handler → repeat if reprompt.

```typescript
// In toolCallHandling.ts or new module

async function executeInteraction(
  request: InteractionRequest,
  context: {
    sessionId: string;
    callId: string;
    toolName: string;
    sessionHub: SessionHub;
    eventStore?: EventStore;
    turnId?: string;
    responseId?: string;
  }
): Promise<unknown> {
  const { sessionId, callId, toolName, sessionHub, eventStore, turnId, responseId } = context;
  
  let currentRequest = request;
  
  while (true) {
    // Generate a unique interactionId for this prompt
    const interactionId = `${callId}:${Date.now()}`;

    // Emit interaction_request ChatEvent (broadcast + persisted)
    emitInteractionRequestEvent({
      eventStore,
      sessionHub,
      sessionId,
      turnId,
      responseId,
      toolCallId: callId,
      interactionId,
      toolName,
      interactionType: currentRequest.type,
      ...(currentRequest.prompt ? { prompt: currentRequest.prompt } : {}),
      ...(currentRequest.inputSchema ? { inputSchema: currentRequest.inputSchema } : {}),
      ...(currentRequest.timeoutMs ? { timeoutMs: currentRequest.timeoutMs } : {}),
    });
    
    // Wait for response (with timeout)
    let userResponse: UserResponse;
    try {
      userResponse = await waitForResponse(
        sessionId, 
        callId,
        interactionId,
        currentRequest.timeoutMs ?? DEFAULT_TIMEOUT
      );
    } catch (err) {
      if (err.message === 'timeout' && currentRequest.onTimeout) {
        const outcome = await currentRequest.onTimeout();
        return handleOutcome(outcome, currentRequest);
      }
      if (err.message === 'cancelled' && currentRequest.onCancel) {
        currentRequest.onCancel();
      }
      throw err;
    }

    // Emit interaction_response ChatEvent (broadcast + persisted)
    emitInteractionResponseEvent({
      eventStore,
      sessionHub,
      sessionId,
      turnId,
      responseId,
      toolCallId: callId,
      interactionId,
      action: userResponse.action,
      ...(userResponse.approvalScope ? { approvalScope: userResponse.approvalScope } : {}),
      ...(userResponse.input ? { input: userResponse.input } : {}),
      ...(userResponse.reason ? { reason: userResponse.reason } : {}),
    });
    
    // Invoke the tool's response handler
    const outcome = await currentRequest.onResponse(userResponse);
    
    // Handle the outcome
    if ('complete' in outcome) {
      return outcome.complete;
    }
    
    if ('reprompt' in outcome) {
      // Loop again with new request (keep same handlers)
      currentRequest = {
        ...outcome.reprompt,
        onResponse: currentRequest.onResponse,
        onTimeout: currentRequest.onTimeout,
        onCancel: currentRequest.onCancel,
      };
      continue;
    }
    
    if ('pending' in outcome) {
      // Tool wants to return a "pending" result to the agent
      return { pending: true, message: outcome.pending.message };
    }
  }
}

// ToolContext wires this up
const toolContext: ToolContext = {
  // ... existing fields ...
  
  requestInteraction: (request) => executeInteraction(request, {
    sessionId,
    callId: call.id,
    toolName: call.name,
    sessionHub,
  }),
};
```

### Pending Interaction Registry

Tracks in-flight interaction requests:

```typescript
class PendingInteractionRegistry {
  private pending = new Map<string, {
    resolve: (response: InteractionResponse) => void;
    reject: (error: Error) => void;
    timeoutId?: NodeJS.Timeout;
  }>();
  
  waitFor(
    sessionId: string,
    callId: string,
    interactionId: string,
    timeoutMs: number,
  ): Promise<InteractionResponse> {
    const key = `${sessionId}:${callId}:${interactionId}`;
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('Interaction timed out'));
      }, timeoutMs);
      
      this.pending.set(key, { resolve, reject, timeoutId });
    });
  }
  
  handleResponse(
    sessionId: string,
    callId: string,
    interactionId: string,
    response: InteractionResponse,
  ): boolean {
    const key = `${sessionId}:${callId}:${interactionId}`;
    const entry = this.pending.get(key);
    if (!entry) return false;
    
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    this.pending.delete(key);
    entry.resolve(response);
    return true;
  }
  
  cancelAll(sessionId: string): void {
    for (const [key, entry] of this.pending) {
      if (key.startsWith(`${sessionId}:`)) {
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        entry.reject(new Error('Session ended'));
        this.pending.delete(key);
      }
    }
  }
}
```

## Client Implementation

### Chat Renderer (interaction events)

Interaction requests/responses arrive as `chat_event` messages. Add handlers in `ChatRenderer.renderEvent`:

```typescript
case 'interaction_request': {
  const request = event.payload;
  showInteractionUI(request); // renders inside tool block output section
  break;
}
case 'interaction_response': {
  const response = event.payload;
  markInteractionCompleted(response); // read-only, show submitted values
  break;
}
```

The UI helpers (`showApprovalDialog`, `showInputForm`) can still be used, but they are invoked from the chat-event rendering path rather than the raw server message handler.

### Approval Dialog

```typescript
function showApprovalDialog(request: InteractionRequestEvent): void {
  // Could be inline in chat or modal — TBD
  const dialog = createDialog({
    title: `Tool: ${request.toolName}`,
    content: request.prompt ?? `Allow "${request.toolName}"?`,
    actions: [
      { label: 'Deny', action: 'deny' },
      { label: 'Allow once', action: 'approve', scope: 'once' },
      { label: 'Allow for session', action: 'approve', scope: 'session' },
    ],
    onAction: (action, scope) => {
      send({
        type: 'tool_interaction_response',
        sessionId: request.sessionId,
        callId: request.callId,
        interactionId: request.interactionId,
        action,
        ...(scope ? { approvalScope: scope } : {}),
      });
    },
  });
}
```

### Input Form

```typescript
function showInputForm(request: InteractionRequestEvent): void {
  const form = createFormDialog({
    fields: request.inputSchema?.fields ?? [],
    onSubmit: (values) => {
      send({
        type: 'tool_interaction_response',
        sessionId: request.sessionId,
        callId: request.callId,
        interactionId: request.interactionId,
        action: 'submit',
        input: values,
      });
    },
    onCancel: () => {
      send({
        type: 'tool_interaction_response',
        sessionId: request.sessionId,
        callId: request.callId,
        interactionId: request.interactionId,
        action: 'cancel',
      });
    },
  });
}
```

## Considerations

### Timeout Handling
- Default: 5 minutes (configurable per-request)
- On timeout: `onTimeout` handler is invoked if provided
- Tool decides what to do: return error, send notification, return pending state, etc.

### Multiple Clients (First Response Wins)

Interaction requests are broadcast to all connected clients via `chat_event` messages.

**Flow:**
1. Server emits `interaction_request` ChatEvent to all clients
2. All clients show the interaction UI (approval dialog, input form)
3. First client to respond "wins" — server processes that response
4. Server emits `interaction_response` ChatEvent to all clients
5. Other clients update their UI to show completed state (read-only)

**Client UI states:**
- **Pending** — Form/dialog is interactive, user can submit
- **Completed** — Inputs shown read-only, buttons disabled, shows what was submitted
- **Completed by another** — Same as completed, optionally shows "Answered on another device"

**Plugin controls the representation:**

The interaction request includes enough info for the client to render both the interactive state AND the completed state. The plugin defines:
- What fields/prompts to show
- How to display the completed form (same fields, read-only)
- Any custom summary text
- Which approval scopes are shown (via `approvalScopes`)

```typescript
interface InteractionRequest {
  // ... existing fields ...
  
  /** How to display after completion (plugin-defined) */
  completedView?: {
    showInputs?: boolean;        // Display submitted values read-only
    summaryTemplate?: string;    // e.g., "User approved: {{action}}"
  };
}
```

The framework broadcasts the same request to all clients and handles the completion notification mechanics. But what gets rendered (the form, the labels, the completed state) is defined by the plugin in the request itself. This way the same validation or questionnaire can be re-presented on reprompt with the plugin controlling the exact content.

### Example: Inline Chat Rendering

**Pending state** (user can interact):
```
┌─────────────────────────────────────────────┐
│ 🔧 ask_user                                 │
│                                             │
│ What is your preferred language?            │
│ ┌─────────────────────────────────────────┐ │
│ │ [text input]                            │ │
│ └─────────────────────────────────────────┘ │
│                              [Cancel] [OK]  │
└─────────────────────────────────────────────┘
```

**Completed state** (read-only):
```
┌─────────────────────────────────────────────┐
│ 🔧 ask_user                              ✓  │
│                                             │
│ What is your preferred language?            │
│ Answer: TypeScript                          │
└─────────────────────────────────────────────┘
```

**Validation error + reprompt** (user can retry):
```
┌─────────────────────────────────────────────┐
│ 🔧 collect_email                            │
│                                             │
│ ⚠️ Invalid email format                     │
│                                             │
│ Please enter a valid email:                 │
│ ┌─────────────────────────────────────────┐ │
│ │ not-an-email                            │ │
│ └─────────────────────────────────────────┘ │
│                              [Cancel] [OK]  │
└─────────────────────────────────────────────┘
```

For reprompts, the server can include an `error` field in the reprompt:

```typescript
{ 
  reprompt: {
    type: 'input',
    error: 'Invalid email format',  // Client displays this
    prompt: 'Please enter a valid email:',
    inputSchema: { ... },
  }
}
```

### Abort Handling
- If chat run is cancelled, `onCancel` is invoked if provided
- Pending interaction is rejected, tool handler terminates

### Reprompt Loop
- Tool can return `{ reprompt: {...} }` to ask again
- Server emits new `interaction_request` ChatEvent to client(s)
- Same `onResponse` handler is used (unless tool structures it differently)
- Consider limiting reprompt count to prevent infinite loops

### Chat Rendering & History Replay

Interaction events need to work with both real-time streaming AND history replay.

**Real-time:** Events flow through WebSocket as they happen
**History replay:** When client reloads, events are loaded from stored history and merged into transcript

**Events must be persisted as ChatEvents:**

```typescript
// New ChatEvent types
interface InteractionRequestEvent {
  type: 'interaction_request';
  timestamp: string;          // ISO timestamp for ordering
  turnId: string;
  responseId: string;
  toolCallId: string;
  interactionId: string;
  toolName: string;
  interactionType: 'approval' | 'input';
  prompt?: string;
  inputSchema?: InputSchema;
}

interface InteractionResponseEvent {
  type: 'interaction_response';
  timestamp: string;
  turnId: string;
  responseId: string;
  toolCallId: string;
  interactionId: string;
  action: 'approve' | 'deny' | 'submit' | 'cancel';
  input?: Record<string, unknown>;
}
```

**Replay behavior:**
- On history load, client sees interaction events in sequence
- `interactionId` distinguishes each prompt (reprompts appear as separate steps)
- Completed interactions render in their final state (read-only with submitted values)
- Timestamps ensure correct ordering when merging with other events (text chunks, tool calls, etc.)

**Chat log display (plugin-controlled):**

Interaction rendering depends on the request's `presentation` flag:

```typescript
interface InteractionRequest {
  // ... existing fields ...
  presentation?: 'tool' | 'questionnaire';
}
```

- **`presentation: 'tool'`** (default):
  - Render inside the existing tool output block (output section)
  - Pending form shows in output section
  - Completion becomes read-only summary
  - If the tool also produces a normal result, it renders **below** the interaction summary in the same block

- **`presentation: 'questionnaire'`**:
  - Render as a standalone interaction block in the chat log (no tool block)
  - Designed for client-only Q&A flows
  - Completed state replaces the form with a read-only summary

Reprompts replace the same UI surface (tool block output or standalone interaction block). Final tool result remains what the agent sees.

### Tool Handler Execution Context
- The `onResponse` / `onTimeout` handlers run in the server context
- They have access to the same `ctx` (sessionId, etc.) as the main handler
- They can do async work (DB calls, external APIs, etc.)
- `ctx.approvals` is an optional helper for common approval storage (tools can ignore it)

### Late Responses (Pending Follow-up)
- If a tool returns `{ pending: { message, queued: true } }`, the tool call completes with a "queued" result
- The interaction remains open on the server
- When the user eventually responds, the server delivers a **follow-up user_message** to the agent session
  (not a continuation of the original tool call)
- This keeps CLI agents from blocking indefinitely while still allowing asynchronous answers

### Event Persistence
- Interaction events are written to the EventStore (same as tool_call, tool_result, etc.)
- Server emits `interaction_request` event when sending to client
- Server emits `interaction_response` event when processing response
- Events include `turnId`, `responseId`, `toolCallId`, `interactionId` for correlation
- Timestamps ensure correct merge order during history replay

### Client Availability & Opt-Out

Interactive tools depend on at least one connected client that has **interactions enabled**. We need to handle:

- **No client connected**
- **Client connected but interactivity disabled** (user wants text-only)
- **Multiple clients, mixed settings** (some interactive, some not)

**Proposed mechanism:**

1. Clients advertise interactivity capability in `hello`:

```typescript
interface ClientHelloMessage {
  // ... existing fields ...
  interaction?: {
    supported: boolean; // client can render interaction UI
    enabled: boolean;   // user has enabled interactive UI
  };
}
```

2. Clients can toggle at runtime via a new message:

```typescript
interface ClientSetInteractionModeMessage {
  type: 'set_interaction_mode';
  enabled: boolean;
}
```

3. SessionHub tracks:
   - `interactiveClientCount`
   - `interactiveEnabledCount`

4. Tool handlers can check availability:

```typescript
if (!ctx.interaction?.available) {
  // Fallback or error
  return { ok: false, error: 'Interactive UI not available' };
}
```

5. `requestInteraction()` throws a `ToolError('interaction_unavailable')` if no enabled client is available.
   - Tools can catch this and fall back to text-based prompts
   - Or return a tool result that tells the agent to ask in text

**Multiple clients behavior:**
- **Enabled clients** show the interactive UI and can respond
- **Disabled clients** still receive the chat events, but render the interaction as **read-only** (visible, non-interactive)
  - UI hint: "Interactive mode disabled — enable to respond"
- If a disabled client flips to enabled while a request is pending, it can respond to the current prompt
- When any enabled client responds, all clients render completion (read-only)
- Reprompts are broadcast to all clients; disabled clients update their read-only view of the new prompt

This keeps the framework policy-neutral while still exposing availability state and a consistent error code.

## Files to Update

Likely touchpoints for implementation:

- `packages/shared/src/chatEvents.ts` (add `interaction_request` / `interaction_response` event types)
- `packages/shared/src/protocol.ts` (add client message `tool_interaction_response`, `set_interaction_mode`)
- `packages/agent-server/src/ws/clientMessageDispatch.ts` (route new client messages)
- `packages/agent-server/src/ws/sessionRuntime.ts` (track interaction mode per connection)
- `packages/agent-server/src/sessionHub.ts` (track interactive client counts)
- `packages/agent-server/src/ws/toolCallHandling.ts` (wire `ctx.requestInteraction` + hook loop)
- `packages/agent-server/src/events/chatEventUtils.ts` (emit interaction events)
- `packages/web-client/src/controllers/chatRenderer.ts` (render interaction events)
- `packages/web-client/src/utils/toolOutputRenderer.ts` (embed interaction UI in tool blocks)
- `packages/web-client/src/controllers/messageRenderer.ts` (if interaction blocks are standalone)
- `packages/web-client/src/index.ts` + CSS (toggle for interactivity + styles)

## Open Questions

1. ✅ Inline by default, with optional user-driven pop-out modal for larger editing.

2. ✅ Agent only sees the final result. Interaction flow (reprompts, validation) is user-facing only.

3. **Late responses after pending**: Decided: pending results are followed by a **user_message** when the user eventually responds. Tool call completes with queued status; late responses come as new messages.

4. **Handler errors**: Validation should not throw — it should return `{ reprompt: ... }`. Only unexpected failures (DB/API bugs) should throw; those are treated as tool errors (agent sees error result, user sees non-interactive error message).

5. ✅ Reprompts should preserve user input via `initialValues` in the questionnaire schema. Tools can also keep state in closure if needed for multi-step flows.

6. **Plugin data access in handlers**: The `onResponse` handler needs access to plugin state/services. How is that wired up? Closure over plugin instance? Passed via context?
