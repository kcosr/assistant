# Window-Aware Panels (Approach A)

## Summary
Make panel inventory and panel tools aware of multiple UI windows by attaching a
per-window identifier to panel inventory updates and routing panel commands to a
specific window when more than one is active. If only one window is active, tools
default to it; otherwise they require an explicit `windowId`.

## Goals
- Support multiple UI windows connected to the same server without panel state
  ambiguity.
- Ensure `panels_*` tools can target a specific window.
- Default to the only active window when exactly one exists.
- Preserve backward compatibility with older clients that do not send `windowId`.

## Non-Goals
- No “windowless core” refactor or shared single WebSocket connection.
- No panel pop-out windows in this iteration.

## Approach
1. **Client window identity**
   - Each window generates a unique `windowId` on startup using `sessionStorage`.
   - The client includes `windowId` in every `panel_event`, including the
     `panel_inventory` payload.

2. **Server inventory per window**
   - Store `panel_inventory` snapshots keyed by `windowId`.
   - Track the `connectionId` for each `windowId` to route panel commands.
   - Remove entries when a connection closes.

3. **Window-aware tools**
   - Add `windowId` to `panels_list`, `panels_selected`, and `panels_tree`.
   - Add `windowId` to panel command tools (`panels_event`, `panels_open`, etc.).
   - When multiple windows are active and `windowId` is omitted, return a tool
     error that lists available windows. When exactly one window is active,
     default to it.

## Data Model Changes
- `PanelInventoryPayload` gains optional `windowId`.
- `PanelEventEnvelope` gains optional `windowId` so server can track the source.
- Panel inventory store becomes a map: `windowId -> snapshot + connectionId`.

## API / Tool Changes
- `panels_list` / `panels_selected` / `panels_tree`
  - New optional `windowId` param.
  - Error if multiple windows active and `windowId` is missing.
- `panels_event`, `panels_open`, `panels_close`, `panels_remove`,
  `panels_replace`, `panels_move`, `panels_toggle_split_view`, `panels_close_split`
  - New optional `windowId` param.
  - If multiple windows are active and `windowId` is missing, error.
  - If `windowId` is provided, route to the matching connection only.

## Client Changes
- Generate and cache `windowId` in `sessionStorage`.
- Attach `windowId` to outgoing `panel_event` messages.
- Filter incoming `panel_event` messages when `windowId` is specified and does
  not match the current window.

## Server Changes
- Track per-window inventory in `panelInventoryStore`.
- Resolve tool requests to a window based on:
  - explicit `windowId`, or
  - the only active window, or
  - error when ambiguous.
- Route panel commands to a specific connection by `windowId`.

## Testing
- Update panel tool tests to cover:
  - ambiguous window selection errors
  - targeting a specific windowId
  - defaulting to the single window
- Update protocol validation tests to accept `windowId`.

## Rollout Notes
- Backward compatibility: if a client does not send `windowId`, its inventory is
  keyed by the connection id to avoid collisions.
- Documentation updates for `panels_*` tools to include `windowId`.
