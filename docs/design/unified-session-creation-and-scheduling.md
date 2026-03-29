# Unified Session Creation And Scheduling

## Goal

Provide a single creation flow that supports both:

- one-off sessions created manually from the UI
- scheduled sessions created from the same UI

The flow should let users configure the parts of a session they actually care about:

- agent
- model
- thinking
- working directory
- skills
- session title

And then choose whether to:

- run now
- schedule for later

This should reduce the need to create many one-off agents just to vary model, thinking,
working directory, or skills.

## Problem

Today, session creation is fragmented:

- sessions can be created from more than one UI entry point
- working-directory prompting is implemented as a special-case branch in the current session picker
- scheduled sessions are configured separately and do not share a higher-level creation model

At the same time, users increasingly want to configure a runnable session rather than just pick
an agent. In practice, the desired configuration often includes:

- a specific agent
- a specific model
- a specific thinking level
- a specific working directory
- a specific subset of skills

Today, the main way to get that is to create another agent definition. That does not scale.

## Non-Goals

This design does not introduce:

- dynamic user-created agents
- agent inheritance
- template inheritance
- arbitrary schedule-local copies of agent config

Those may become useful later, but they are not required to solve the current UX problem.

## Recommendation

Introduce a shared `Create Session` flow in the UI that produces either:

- a one-off session instance
- or a scheduled session definition

Both paths should share the same session-configuration UI model.

### Core Principle

Treat the user-facing object as a **session configuration**, not just an agent selection.

The agent remains the capability boundary and source of allowed values. The creation flow allows
the user to choose a configuration within that boundary.

## High-Level Model

There are three related concepts:

1. Agent
2. Session configuration
3. Schedule

### 1. Agent

An agent remains the upper bound and capability boundary. It defines what is allowed.

Examples:

- provider family
- allowed models
- allowed thinking levels
- allowed instruction skills
- tool/capability limits
- default working-directory policy
- system prompt

The shared composer should be driven by these agent capabilities and policies rather than by
hardcoded provider-specific UI logic.

### 2. Session Configuration

A session configuration is the user’s chosen runtime setup for a session.

Examples:

- `agentId`
- `model`
- `thinking`
- `workingDir`
- selected `skills`
- `sessionTitle`

This is the shared model used by both:

- one-off session creation
- scheduled session creation

### 3. Schedule

A schedule is a trigger and execution policy layered on top of a session configuration.

Examples:

- `cron`
- `prompt`
- `preCheck`
- `enabled`
- `reuseSession`
- `maxConcurrent`

When `reuseSession = true`, the schedule remains the declarative source of truth. The backing
session is an instantiated runtime copy and should be reconciled from the schedule on a future
run after edits.

## Why Not Dynamic Agents Or Inheritance First

Those approaches are tempting, but they introduce more complexity than the current problem needs.

If users mostly need to:

- start a session with specific model/thinking/dir/skills
- or schedule the same kind of session

then the shared session-configuration layer solves that directly without adding:

- inheritance rules
- merge semantics
- agent lineage debugging
- dynamic capability expansion concerns

The system can still evolve toward reusable saved presets later if repeated configurations become
common.

## Proposed UI Model

Create one shared flow, used by both:

- chat entry point
- sessions panel entry point

Possible future entry points can reuse it too.

### Flow Overview

1. Open `Create Session`
2. Pick an agent
3. Configure the session
4. Choose `Run now` or `Schedule`
5. Show schedule-only fields if scheduling
6. Submit

### Visual Direction

This flow should use the existing app visual language and controls rather than introducing a
new modal style. It should feel like a natural extension of the current assistant UI:

- existing modal/dialog styling
- existing panel and input treatment
- existing picker styling for working-directory selection
- existing button, chip, and form control patterns

The mock is only meant to communicate structure and behavior, not introduce a new visual system.

### Shared Configuration Section

These fields appear in both one-off and scheduled flows:

- `Agent`
- `Model`
- `Thinking`
- `Working directory`
- `Skills`
- `Title`

To keep the default flow lightweight, advanced fields should be progressively disclosed behind a
`Customize` section or similar affordance. The common path should stay simple:

- agent
- run now vs schedule
- optional title

Then `Customize` can reveal:

- model
- thinking
- working directory
- skills

Collapsing `Customize` only hides advanced fields. It does not clear chosen values. Returning to
agent defaults should require an explicit reset action.

Behavior:

- `Agent` determines the allowed values for the other fields
- `Model` choices are limited to the selected agent’s allowed models
- `Thinking` choices are limited to the selected agent’s allowed thinking levels
- `Skills` choices are limited to the selected agent’s available skills
- `Working directory` is chosen using the same root/picker rules the agent already defines
- `Title` is a single shared field for both one-off and scheduled creation

### Schedule-Only Section

These fields only appear when the user chooses `Schedule`:

- `Cron`
- `Prompt`
- `Pre-check`
- `Enabled`
- `Reuse session`
- `Max concurrent`

Rules:

- `maxConcurrent` only matters when `reuseSession = false`
- if `reuseSession = true`, treat concurrency as effectively `1`

## Behavior For Reused Scheduled Sessions

When `reuseSession = true`, create the backing session immediately at schedule creation time.

Why:

- the session can appear in the UI right away
- the chosen model/thinking/workingDir/skills live on a real session from the start
- the schedule can point directly at a known backing session
- it avoids creating the session lazily on first run

When `reuseSession = false`, do not create a backing session at schedule creation time.

Each run creates a fresh session instance.

When a reused schedule is edited in phase one:

- do not patch the backing session immediately
- reconcile the backing session from the schedule on the next run

This keeps the implementation simpler while preserving the schedule as the source of truth.

## Data Model

### Shared Session Configuration

This is the conceptual shared model used by the UI:

```json
{
  "agentId": "coding",
  "model": "gpt-5.4",
  "thinking": "medium",
  "workingDir": "/home/kevin/worktrees/project-x",
  "skills": ["agent-runner-review", "worktrees"],
  "sessionTitle": "Project X Triage"
}
```

### One-Off Session Creation Request

```json
{
  "agentId": "coding",
  "sessionConfig": {
    "model": "gpt-5.4",
    "thinking": "medium",
    "workingDir": "/home/kevin/worktrees/project-x",
    "skills": ["agent-runner-review", "worktrees"],
    "sessionTitle": "Project X Triage"
  }
}
```

### Persisted One-Off Session State

The request should be resolved onto the session and stored there, rather than preserved as a
template object.

For skills, store only the resolved selected skill names on the session. Do not preserve a second
copy of the original request shape unless a later requirement proves it is necessary.

For title behavior:

- blank title means normal auto-title behavior
- a filled title means an explicit session title

Example:

```json
{
  "agentId": "coding",
  "attributes": {
    "core": {
      "workingDir": "/home/kevin/worktrees/project-x"
    },
    "chat": {
      "model": "gpt-5.4",
      "thinking": "medium"
    },
    "session": {
      "title": "Project X Triage"
    },
    "agent": {
      "skills": ["agent-runner-review", "worktrees"]
    }
  }
}
```

### Scheduled Session Record

```json
{
  "agentId": "coding",
  "scheduleId": "sched-123",
  "cron": "0 9 * * 1-5",
  "prompt": "Review repo status and summarize what needs attention.",
  "preCheck": "test -d .git",
  "sessionTitle": "Project X Daily Triage",
  "enabled": true,
  "reuseSession": true,
  "maxConcurrent": 1,
  "sessionConfig": {
    "model": "gpt-5.4",
    "thinking": "medium",
    "workingDir": "/home/kevin/worktrees/project-x",
    "skills": ["agent-runner-review"]
  },
  "sessionId": "existing-session-id-when-reuse-is-true"
}
```

When a reused schedule is deleted, the backing session should remain as a normal chat session.
Deleting the schedule stops future automation only.

## Validation Rules

### Agent-Bounded Session Configuration

The selected agent is the upper bound.

Rules:

- `sessionConfig.model` must be allowed by the agent
- `sessionConfig.thinking` must be allowed by the agent
- `sessionConfig.skills` must be a subset of the agent’s allowed/available skills
- `sessionConfig.workingDir` must be an absolute path

Validation timing:

- validate at create/edit time for immediate user feedback
- revalidate at run time to catch agent drift (for example removed skills or deprecated models)

This keeps session configuration flexible without turning schedules or sessions into arbitrary
agent definitions.

### Working Directory

The flow should reuse the current working-directory behavior:

- fixed agent dir: auto-fill and lock or show as fixed
- prompt roots: show picker
- none: leave unset unless the user supplies a value manually in future UI variants

The result is stored in `attributes.core.workingDir`.

The UI should reuse the existing picker/sub-flow rather than inventing a second directory chooser.

## UI Architecture Recommendation

Do not build this directly into only one current entry point.

Instead, extract a shared controller/module, for example:

- `SessionComposerController`
- or `CreateSessionController`

Both current entry points should invoke it:

- chat new-session entry point
- sessions panel entry point

This shared controller should own:

- agent selection
- dynamic allowed-value loading
- working-dir picker integration
- one-off vs schedule branching
- final submission

## API Direction

### One-Off Session

Extend manual session creation to accept `sessionConfig`.

### Scheduled Session

Extend schedule CRUD to accept the same `sessionConfig` block.

The schedule service should resolve that `sessionConfig` when:

- creating the backing session up front for `reuseSession = true`
- or creating a fresh session per run for `reuseSession = false`
- reconciling the reused backing session on a future run after edits

## Suggested Implementation Phases

### Phase 1: Shared Design Contract

- define shared session-configuration shape
- define override validation rules
- define create-now vs schedule branching

### Phase 2: Shared UI Flow

- extract current session-creation UI into a shared controller
- move working-dir picker logic under that shared flow
- add fields for model, thinking, skills, title
- hide advanced fields behind a `Customize` section to reduce clutter in the default flow
- add `Run now` vs `Schedule`

### Phase 3: Backend Support

- extend manual session creation to accept overrides
- extend manual session creation to accept `sessionConfig`
- extend scheduled sessions to accept and persist `sessionConfig`
- precreate backing session when `reuseSession = true`
- reconcile reused backing sessions from the schedule on a future run after edits

### Phase 4: Panel Integration

- update sessions panel entry point to open shared composer
- update chat entry point to open shared composer
- later, optionally add a dedicated create/edit UI inside the scheduled-sessions panel

## Resolved Decisions

1. Skills should be stored on sessions as the resolved selected skill-name list only.
2. The flow should stay visually consistent with the existing app and reuse existing modal/picker
   styling.
3. Advanced fields should be behind a `Customize` section or similar progressive disclosure.
4. The working-directory UI should reuse the existing picker/sub-flow.
5. Both entry points should invoke the same shared composer with identical behavior.
6. When `reuseSession = true`, edits should be reconciled into the backing session on a future
   run, not patched immediately.
7. Manual creation should allow agent defaults rather than forcing every advanced field to be set
   explicitly.
8. The composer should be driven by agent capabilities and policies for model, thinking, skills,
   and working-directory behavior.
9. `Customize` collapse hides advanced fields only; it does not clear values.
10. Title should remain a single field: blank means auto-title behavior, filled means explicit
    title.
11. Deleting a reused schedule should not delete its backing session.

## Recommendation Summary

The recommended next step is:

- build a shared session-composer flow
- use it for both one-off and scheduled creation
- keep agents as the upper-bound capability model
- add shared `sessionConfig` support for model, thinking, workingDir, skills, and title
- precreate the backing session for reused schedules
- reconcile reused sessions from the schedule on later runs after edits

This gives the user the flexibility they want now without prematurely introducing dynamic agents
or inheritance.

## Test Strategy

The first implementation should cover:

- validation
  - model/thinking/skills/workingDir constrained by agent capabilities
  - create/edit validation and run-time revalidation
- one-off session lifecycle
  - resolved `sessionConfig` persisted onto the created session
- reused schedule lifecycle
  - schedule creation
  - backing session precreation
  - next-run reconciliation after schedule edits
  - schedule deletion without deleting the backing session
- non-reused schedule lifecycle
  - no backing session upfront
  - fresh session per run
  - `maxConcurrent` behavior
- UI behavior
  - shared composer usable from both current entry points
  - progressive disclosure via `Customize`
  - collapse hides but does not clear
  - agent-driven field visibility and option sets
  - reuse of the existing working-directory picker

In addition to unit and integration coverage, browser-level validation through the Chrome
DevTools MCP is appropriate because much of the value here is in the shared UI behavior and
picker integration.
