# Chat panel: skills dropdown (per interaction / session)

## Goal
Add a **Skills** dropdown to the **chat panel header** that lets the user select one or more “skills” (plugin-exported CLI skill bundles) to attach to the current session / upcoming interactions.

This is primarily a UX + protocol feature:
- **UX:** discover + multi-select skills with fast search and sensible grouping by subdirectory.
- **Behavior:** the selected skills are included in the agent’s **system prompt** as “Available CLI skills” for that session (and therefore influence what the agent uses).
- **Config:** the skills directory root(s) are configurable (e.g. `~/skills`).

Non-goals:
- Replacing the existing tool exposure model.
- Building a full skills marketplace UI.

## Background / current state
- Chat panel header DOM is defined in `packages/web-client/public/index.html` under `<template id="chat-panel-template">`.
- Chat panel wiring lives in:
  - `packages/web-client/src/panels/chat/chatPanel.ts` (DOM hooks)
  - `packages/web-client/src/index.ts` (header behaviors like session picker, refresh)
- Skills are already a first-class concept in the agent server:
  - `packages/agent-server/src/skills.ts` builds `SkillSummary[]` (id/name/description + SKILL.md path + CLI path).
  - `packages/agent-server/src/systemPrompt.ts` can include the “Available CLI skills” section.
  - `packages/agent-server/src/ws/sessionRuntime.ts` updates system prompt with tools/skills (based on agent `toolExposure`).

What’s missing is:
- A client-facing list of available skills.
- A UX to select skills.
- A protocol path to send selected skill ids with a message (or persist them per session).
- Configurable skills roots (e.g. `~/skills`) and preserving subdir structure for grouping.

## Proposed UX
### Header control
Add a header button next to model/thinking/refresh:
- Label: **Skills**
- Badge: count of selected skills, e.g. `Skills (3)` or a pill with `3`.
- Tooltip: “Select skills to attach to this session”.

### Dropdown / popover
Popover anchored to the Skills button:
- Search input (debounced, but “real-time” from the user’s POV).
- Scrollable list with multi-select checkboxes.
- Grouping by folder path (relative to configured root), e.g.
  - `personal/private/assistant`
    - `lists`
    - `notes`
    - `panels`
- Each row shows:
  - skill `name` (or `id` if name is missing)
  - short `description`
  - optional muted “path” breadcrumb

Quality-of-life:
- “Clear” action to unselect all.
- Keep selection per session (sticky) until changed.

## Data model
### Skill discovery (server)
Extend `SkillSummary` surfaced to the client to include:
- `rootId` or `rootPath` (which configured root it came from)
- `relativePath` (e.g. `personal/private/assistant/lists`) for grouping

### Session selection state
Store *client-side* selection per sessionId:
- `selectedSkillIdsBySession: Map<string, Set<string>>`

Optionally mirror on the server in session attributes so multi-client stays in sync:
- `session.attributes.selectedSkillIds: string[]`

## Protocol changes
### Client → server
Extend `ClientTextInputMessage` (shared protocol) to carry selected skills:
```ts
// packages/shared/src/protocol.ts
ClientTextInputMessageSchema.extend({
  skillIds: z.array(z.string()).optional(),
});
```
Semantics: the `skillIds` apply to this message and become the session’s active skill selection (sticky).

### Server → client
Add `availableSkills` to `ServerSessionReadyMessage` so the client can populate the dropdown:
```ts
ServerSessionReadyMessageSchema.extend({
  availableSkills: z.array(SkillSummarySchema).optional(),
  selectedSkillIds: z.array(z.string()).optional(),
});
```
(If we don’t want to extend `session_ready`, introduce a dedicated message type, e.g. `session_tool_context`.)

## Server-side behavior
### Configurable skills roots
Add env var support in `packages/agent-server/src/envConfig.ts`:
- `SKILLS_DIRS` (comma-separated list)
- Each entry can be absolute, relative to CWD, or `~/...`.

Plumb into skill resolution:
- Pass `skillsRoots` into `resolveToolExposure({ skillsRoots })`.

### Subdirectory support
Allow skills roots to be either:
1) A directory where skills are **direct children** (`root/<pluginId>/SKILL.md`), *or*
2) A directory where skills live **somewhere beneath** it (`root/**/<pluginId>/SKILL.md`).

Implementation approach:
- When `skillsRoots` are provided, do a recursive scan for `SKILL.md` + `<id>-cli` pairs.
- Capture relative path for grouping.
- Prefer closest-to-root match if duplicates exist (or last-root-wins, but deterministic).

### Applying selected skills
In `packages/agent-server/src/ws/sessionRuntime.ts`:
- When handling `text_input`, read `message.skillIds`.
- Resolve `availableSkills` (from agent/toolExposure) and filter to the selected set.
- Call `updateSystemPromptWithTools({ skills: filteredSkills, tools: visibleTools })` before running the turn.

Persisting selection (optional but recommended):
- Write `selectedSkillIds` into session attributes and broadcast a `session_updated`.

## Client-side wiring
### DOM changes
Update `packages/web-client/public/index.html`:
- Add a Skills button in `.chat-panel-controls`.

Update `packages/web-client/src/panels/chat/chatPanel.ts`:
- Add `skillsButtonEl` and `skillsMenuEl` (or equivalent) to `ChatPanelDom` and `getChatPanelDom()`.

### Behavior
Update `packages/web-client/src/index.ts`:
- On `session_ready`, cache `availableSkills` and optionally `selectedSkillIds`.
- Implement popover open/close anchored to the Skills button.
- Maintain selection per sessionId.

Update `packages/web-client/src/controllers/textInputController.ts`:
- Include `skillIds` in the outgoing `ClientTextInputMessage`.

## Edge cases
- External sessions: disable skills control (similar to refresh/model controls) if the session doesn’t support local tools.
- Skills list unavailable: hide Skills button or show disabled state.
- Permission/safety: skills only affect *prompt exposure*; actual tool access remains governed by server allowlists.

## Files to update
- `packages/web-client/public/index.html` (chat header template)
- `packages/web-client/src/panels/chat/chatPanel.ts` (DOM wiring)
- `packages/web-client/src/index.ts` (UI state + handlers)
- `packages/web-client/src/controllers/textInputController.ts` (send `skillIds`)
- `packages/shared/src/protocol.ts` (message schema changes)
- `packages/agent-server/src/envConfig.ts` (SKILLS_DIRS)
- `packages/agent-server/src/ws/sessionRuntime.ts` (apply skill selection per turn)
- `packages/agent-server/src/skills.ts` (skillsRoots + recursive resolution + relativePath)

## Test plan (high level)
- Unit: protocol schema validates messages with/without `skillIds`.
- Unit: skill discovery finds bundles under nested roots and produces stable `relativePath`.
- Manual:
  - Open chat panel → Skills dropdown shows available skills.
  - Select 2 skills → send message → system prompt includes only those skills.
  - Switch session → selection is per session.
  - Refresh / reconnect → selection persists (if mirrored via session attributes).
