# Chat panel: skills dropdown (per interaction / session)

## Goal
Add a **Skills** dropdown to the **chat panel header** that lets the user select one or more "skills" (instruction files) to attach to the current session / upcoming interactions.

This is primarily a UX + protocol feature:
- **UX:** discover + multi-select skills with fast search and sensible grouping by subdirectory.
- **Behavior:** the selected skills are included in the agent's **system prompt** for that session (and therefore influence what the agent uses).
- **Skill modes:** two modes for how skills appear in the prompt:
  - **Reference mode:** list skills with paths to SKILL.md — agent reads when needed (lightweight awareness)
  - **Inline mode:** concatenate full SKILL.md content into system prompt — preloaded for immediate use
- **Config:** the skills directory root(s) are configurable via `config.json` **per agent** (e.g. `worktrees/assistant/skills`).

Non-goals:
- Replacing the existing tool exposure model.
- Building a full skills marketplace UI.

## Background / current state
- Chat panel header DOM is defined in `packages/web-client/public/index.html` under `<template id="chat-panel-template">`.
- Chat panel wiring lives in:
  - `packages/web-client/src/panels/chat/chatPanel.ts` (DOM hooks)
  - `packages/web-client/src/index.ts` (header behaviors like session picker, refresh)
- Skills are already a first-class concept in the agent server:
  - `packages/agent-server/src/skills.ts` builds `SkillSummary[]` (id/name/description + SKILL.md path).
  - `packages/agent-server/src/systemPrompt.ts` can include the "Available skills" section.
  - `packages/agent-server/src/ws/sessionRuntime.ts` updates system prompt with tools/skills (based on agent `toolExposure`).

**Note:** Skills are instruction files (SKILL.md), not necessarily CLI wrappers. Some skills provide CLI tools (e.g., `lists-cli`), others are pure methodology/workflow instructions (e.g., `explore-repo`). The skill system should be CLI-agnostic.

What's missing is:
- A client-facing list of available skills.
- A UX to select skills.
- A protocol path to send selected skill ids and mode with a message (or persist them per session).
- Configurable skills roots (via `config.json`, per agent; e.g. `worktrees/assistant/skills`) and preserving subdir structure for grouping.
- Support for **reference vs inline** skill modes.

## Proposed UX
### Header control
Add a header button next to model/thinking/refresh:
- Label: **Skills**
- Badge: count of selected skills, e.g. `Skills (3)` or a pill with `3`.
- Tooltip: "Select skills to attach to this session".

### Dropdown / popover
Popover anchored to the Skills button:
- Search input (debounced, but "real-time" from the user's POV).
- **Inline toggle:** global checkbox to switch between reference and inline modes.
- Scrollable list with multi-select checkboxes.
- Grouping by folder path (relative to configured root), e.g.
  - `personal/private/assistant`
    - `lists`
    - `notes`
    - `panels`
- Each row shows:
  - skill `name` (or `id` if name is missing)
  - short `description`
  - optional muted "path" breadcrumb

Quality-of-life:
- "Clear" action to unselect all.
- Keep selection and mode per session (sticky) until changed.

### Skill modes
| Mode | Prompt behavior | Use case |
|------|-----------------|----------|
| **Reference** (default) | Lists skills with SKILL.md paths; agent reads when needed | Exploratory work, many skills enabled, lightweight awareness |
| **Inline** | Concatenates full SKILL.md content into system prompt | Focused task, known workflow, preloaded instructions |

## Data model
### Skill discovery (server)
`SkillSummary` surfaced to the client:
```ts
interface SkillSummary {
  id: string;
  name: string;
  description: string;
  skillPath: string;       // path to SKILL.md
  relativePath?: string;   // e.g. `personal/private/assistant/lists` for grouping
}
```

**Note:** No `cliPath` — skills are instruction files, not necessarily CLI wrappers. The SKILL.md itself documents how to use the skill (which may or may not involve a CLI).

### Session selection state
Store *client-side* selection per sessionId:
- `selectedSkillIdsBySession: Map<string, Set<string>>`
- `skillModeBySession: Map<string, 'reference' | 'inline'>`

Optionally mirror on the server in session attributes so multi-client stays in sync:
- `session.attributes.selectedSkillIds: string[]`
- `session.attributes.skillMode: 'reference' | 'inline'`

## Protocol changes
### Client → server
Extend `ClientTextInputMessage` (shared protocol) to carry selected skills and mode:
```ts
// packages/shared/src/protocol.ts
ClientTextInputMessageSchema.extend({
  skillIds: z.array(z.string()).optional(),
  skillMode: z.enum(['reference', 'inline']).optional(),  // default 'reference'
});
```
Semantics: the `skillIds` and `skillMode` apply to this message and become the session's active skill selection (sticky).

### Server → client
Add `availableSkills` to `ServerSessionReadyMessage` so the client can populate the dropdown:
```ts
const SkillSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  skillPath: z.string(),
  relativePath: z.string().optional(),
});

ServerSessionReadyMessageSchema.extend({
  availableSkills: z.array(SkillSummarySchema).optional(),
  selectedSkillIds: z.array(z.string()).optional(),
  skillMode: z.enum(['reference', 'inline']).optional(),
});
```
(If we don't want to extend `session_ready`, introduce a dedicated message type, e.g. `session_tool_context`.)

## Server-side behavior
### Configurable skills roots
Add `skillsRoots` configuration in `config.json` **per agent** (e.g. `agents[].skillsRoots`).

Example:
```json
{
  "agentId": "coding",
  "toolExposure": "mixed",
  "skillsRoots": ["worktrees/assistant/skills"]
}
```

Notes:
- `skillsRoots` should be interpreted as paths (absolute or relative to the agent-server CWD).
- The UI dropdown should show skills discovered beneath these roots.

Plumb into skill resolution:
- Pass `agent.skillsRoots` into `resolveToolExposure({ skillsRoots })` (via `resolveAgentToolExposureForHost`).

### Subdirectory support
Allow skills roots to be either:
1) A directory where skills are **direct children** (`root/<skillId>/SKILL.md`), *or*
2) A directory where skills live **somewhere beneath** it (`root/**/<skillId>/SKILL.md`).

Implementation approach:
- When `skillsRoots` are provided, do a recursive scan for `SKILL.md` files.
- Derive skill `id` from the parent directory name (e.g., `/path/to/lists/SKILL.md` → id: `lists`).
- Capture relative path for grouping.
- Prefer closest-to-root match if duplicates exist (or last-root-wins, but deterministic).

### Applying selected skills
In `packages/agent-server/src/ws/sessionRuntime.ts`:
- When handling `text_input`, read `message.skillIds` and `message.skillMode`.
- Resolve `availableSkills` (from agent/toolExposure) and filter to the selected set.
- Call `updateSystemPromptWithTools({ skills: filteredSkills, skillMode, tools: visibleTools })` before running the turn.

### Skill mode behavior in system prompt
In `packages/agent-server/src/systemPrompt.ts`:

**Reference mode** (default):
```
Available skills:

Read the SKILL.md file for instructions on how to use each skill.
- lists: Structured lists with items, tags, and custom fields. (SKILL: /path/to/SKILL.md)
- explore-repo: Explore and analyze code repositories. (SKILL: /path/to/SKILL.md)
```

**Inline mode:**
```
Available skills:

<skill name="lists">
# Lists

Structured lists with items, tags, and custom fields.

## Commands
...full SKILL.md content...
</skill>

<skill name="explore-repo">
# Explore Repo

When exploring an unfamiliar codebase:
...full SKILL.md content...
</skill>
```

Implementation:
```ts
if (skillMode === 'inline') {
  sections.push('Available skills:\n');
  for (const skill of selectedSkills) {
    const content = fs.readFileSync(skill.skillPath, 'utf8');
    sections.push(`<skill name="${skill.id}">\n${content}\n</skill>\n`);
  }
} else {
  sections.push('Available skills:\n');
  sections.push('Read the SKILL.md file for instructions on how to use each skill.');
  for (const skill of selectedSkills) {
    sections.push(`- ${skill.id}: ${skill.description} (SKILL: ${skill.skillPath})`);
  }
}
```

Persisting selection (optional but recommended):
- Write `selectedSkillIds` and `skillMode` into session attributes and broadcast a `session_updated`.

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
- External sessions: disable skills control (similar to refresh/model controls) if the session doesn't support local tools.
- Skills list unavailable: hide Skills button or show disabled state.
- Permission/safety: skills only affect *prompt exposure*; actual tool access remains governed by server allowlists.

## Files to update
- `packages/web-client/public/index.html` (chat header template)
- `packages/web-client/src/panels/chat/chatPanel.ts` (DOM wiring)
- `packages/web-client/src/index.ts` (UI state + handlers, including inline toggle)
- `packages/web-client/src/controllers/textInputController.ts` (send `skillIds` + `skillMode`)
- `packages/shared/src/protocol.ts` (message schema changes — add `skillMode`, update `SkillSummary`)
- `packages/agent-server/src/config.ts` (add per-agent `skillsRoots`)
- `packages/agent-server/src/toolExposure.ts` (plumb `agent.skillsRoots` into `resolveToolExposure`)
- `packages/agent-server/src/ws/sessionRuntime.ts` (apply skill selection + mode per turn)
- `packages/agent-server/src/skills.ts` (remove `cliPath`, add `skillPath`, recursive resolution + relativePath)
- `packages/agent-server/src/systemPrompt.ts` (implement reference vs inline mode rendering)

## Test plan (high level)
- Unit: protocol schema validates messages with/without `skillIds` and `skillMode`.
- Unit: skill discovery finds SKILL.md files under nested roots and produces stable `relativePath`.
- Unit: system prompt renders correctly in both reference and inline modes.
- Manual:
  - Open chat panel → Skills dropdown shows available skills.
  - Select 2 skills → send message → system prompt includes only those skills.
  - Toggle inline mode → system prompt contains full SKILL.md content.
  - Toggle back to reference → system prompt lists skills with paths.
  - Switch session → selection and mode are per session.
  - Refresh / reconnect → selection persists (if mirrored via session attributes).
