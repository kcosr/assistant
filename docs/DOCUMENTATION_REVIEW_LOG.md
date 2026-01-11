# Documentation Review Log

This log tracks review status for all markdown docs in the repo. Update the status and notes as work progresses.

## Legend

- Status: todo | in_progress | done | blocked
- Re-review: pending | done
- Notes should capture missing sections, accuracy issues, or required follow-ups.

## Tracking

| Doc | Type | Status | Notes | Re-review |
| --- | ---- | ------ | ----- | --------- |
| AGENTS.md | root | done | Replaced with repo-specific guidelines and release script steps. | done |
| CHANGELOG.md | root | done | Added empty changelog with standard sections. | done |
| CLAUDE.md | root | done | Replaced with symlink to AGENTS.md. | done |
| README.md | root | done | Slimmed configuration content; linked to CONFIG; updated intro and CLI-only note. | done |
| docs/index.md | docs | done | New docs index. | done |
| docs/CONFIG.md | docs | done | Added env var vs config.json separation, provider table, CLI example, agents plugin tools. | done |
| docs/PLUGIN_MIGRATION.md | docs | done | Added TOC and source files. | done |
| docs/PLUGIN_PANEL_MIGRATION.md | docs | done | Added TOC and source files. | done |
| docs/PLUGIN_SDK.md | docs | done | Added TOC, merged PLUGINS.md content, moved CLI/skills usage. Fixed PanelStatus values ('busy' not 'loading'). | done |
| docs/REPO_DOCUMENTATION_GUIDELINES.md | docs | done | Added TOC. | done |
| docs/SHARED_COLLECTION_UTILS.md | docs | done | Added TOC and source files. Fixed missing updatedAt field in CollectionItemSummary type. | done |
| docs/TOOL_APPROVALS.md | docs | done | Added TOC and noted no current source files. | done |
| docs/UI_SPEC.md | docs | done | Added TOC and source files section. Fixed keyboard shortcut docs (close/remove panel modifiers). | done |
| docs/design/agents.md | design | done | Added TOC and source files. | done |
| docs/design/calendar-plugin.md | design | done | Added TOC and source file references. | done |
| docs/design/chat-message-handling.md | design | done | Added TOC and source files. | done |
| docs/design/chat-renderer-ui-spec.md | design | done | Added TOC and source files. | done |
| docs/design/content-blocks.md | design | done | Added TOC and source files. | done |
| docs/design/external-agents.md | design | done | Added TOC and source files. | done |
| docs/design/issue-586-chat-rendering-and-transcript-replay.md | design | done | Added TOC and source files. | done |
| docs/design/panel-layout-ui-spec.md | design | done | Added TOC and source files. | done |
| docs/design/panel-plugins.md | design | done | Added TOC and source files. | done |
| docs/design/persistent-views.md | design | done | Added TOC and source file references. | done |
| docs/design/preferences.md | design | done | Added TOC and source files. | done |
| docs/design/unified-chat-event-architecture.md | design | done | Added TOC and source files. Fixed missing tool_input_chunk and tool_output_chunk event types in table. | done |
| packages/agent-server/README.md | package | done | Added TOC. Fixed coding plugin tool lists (added missing ls, find, grep tools in multiple sections). Note: file still has duplicate "Coding Plugin" section headers that could be consolidated. | done |
| packages/assistant-cli/README.md | package | done | No changes needed. | done |
| packages/coding-executor/README.md | package | done | New README with ToolExecutor interface, operations, and truncation docs. | done |
| packages/coding-sidecar/README.md | package | done | New README with Docker, configuration, and API documentation. | done |
| packages/mobile-web/README.md | package | done | Added TOC and source files. | done |
| packages/notify-proxy/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/core/agents/README.md | package | done | New README created with operations and tools. | done |
| packages/plugins/core/chat/README.md | package | done | New README created with panel details. | done |
| packages/plugins/core/panels/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/core/sessions/README.md | package | done | New README created with operations and tools. | done |
| packages/plugins/examples/hello/README.md | package | done | New README created with code example. | done |
| packages/plugins/examples/session-info/README.md | package | done | New README created with operations and panel details. | done |
| packages/plugins/examples/session-info/skill-extra.md | skill | done | No changes needed. | done |
| packages/plugins/examples/ws-echo/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/diff/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/files/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/links/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/lists/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/notes/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/notes/skill-extra.md | skill | done | No changes needed. | done |
| packages/plugins/official/terminal/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/time-tracker/README.md | package | done | Added TOC and source files. | done |
| packages/plugins/official/time-tracker/SPEC.md | spec | done | Added TOC and source files. | done |
| packages/plugins/official/url-fetch/README.md | package | done | Added TOC and source files. | done |
| packages/push-cli/README.md | package | done | Added TOC and source files. | done |
| packages/shared/README.md | package | done | Added TOC and source files. Fixed ServerMessage type list (removed non-existent artifact types, added missing types). | done |
| packages/web-client/README.md | package | done | Added TOC. | done |
