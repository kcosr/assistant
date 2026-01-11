# Calendar Plugin Design

> **Status: Planned** — This feature is not yet implemented.

> Note: This document assumes a dedicated calendar panel plugin in the panel layout architecture.
> The body still uses legacy artifact event naming; treat "artifact" as the underlying tool/event
> metadata name. HTTP routes should live under `/api/plugins/artifacts/...` when implementing.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Data Model](#data-model)
- [Storage](#storage)
- [Plugin Tools](#plugin-tools)
- [REST API](#rest-api)
- [WebSocket Integration](#websocket-integration)
- [Client UI](#client-ui)
- [Plugin Configuration](#plugin-configuration)
- [Agent Configuration](#agent-configuration)
- [Artifact Registry](#artifact-registry)
- [Implementation Plan](#implementation-plan)
- [Protocol Changes](#protocol-changes)
- [Testing](#testing)
- [Open Questions](#open-questions)
- [Summary](#summary)

## Overview

The calendar plugin provides calendar event management capabilities for both agents and users. Events are stored in a single calendar with tag-based filtering (similar to how lists work). The plugin exposes MCP tools for the agent and a REST API for client interactions, with real-time updates via WebSocket panel events (`artifacts_*` messages in the API layer).

This design follows the established patterns from the lists plugin and adheres to the [Panel Layout UI Specification](panel-layout-ui-spec.md).

## Source files

Planned feature. Reference patterns:

- `packages/plugins/official/lists/server/index.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/notes/server/index.ts`
- `packages/plugins/official/notes/web/index.ts`

## Data Model

### CalendarEvent

```typescript
interface CalendarEvent {
  id: string; // UUID
  title: string; // Event title
  startTime: string; // ISO 8601 datetime (e.g., "2025-01-15T14:00:00Z")
  endTime?: string; // ISO 8601 datetime (optional - if omitted, use default duration or all-day)
  allDay?: boolean; // If true, startTime/endTime represent dates only
  location?: string; // Optional location text
  description?: string; // Optional longer description/notes
  url?: string; // Optional URL for the event
  tags: string[]; // Tags for filtering (e.g., "work", "personal", "health")
  recurrence?: RecurrenceRule; // Optional recurrence rule (future consideration)
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
```

### CalendarData

```typescript
interface CalendarData {
  events: CalendarEvent[];
}
```

### RecurrenceRule (Future)

```typescript
interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number; // Every N days/weeks/etc. (default: 1)
  until?: string; // ISO 8601 date - when to stop recurring
  count?: number; // Number of occurrences (alternative to until)
  byDay?: string[]; // For weekly: ['MO', 'TU', 'WE', ...], for monthly: ['1MO', '-1FR']
}
```

Note: Recurrence is marked as future consideration. Initial implementation will focus on single events.

## Storage

Events are stored in a JSON file at `<dataDir>/calendar/calendar.json`:

```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Team Meeting",
      "startTime": "2025-01-15T14:00:00Z",
      "endTime": "2025-01-15T15:00:00Z",
      "location": "Conference Room A",
      "tags": ["work", "meetings"],
      "createdAt": "2025-01-10T10:00:00Z",
      "updatedAt": "2025-01-10T10:00:00Z"
    }
  ]
}
```

## Plugin Tools

### calendar_create

Create a new calendar event.

```typescript
{
  name: 'calendar_create',
  description: 'Create a new calendar event.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Event title' },
      startTime: { type: 'string', description: 'Start time in ISO 8601 format (e.g., "2025-01-15T14:00:00Z")' },
      endTime: { type: 'string', description: 'End time in ISO 8601 format (optional)' },
      allDay: { type: 'boolean', description: 'If true, this is an all-day event' },
      location: { type: 'string', description: 'Event location (optional)' },
      description: { type: 'string', description: 'Event description/notes (optional)' },
      url: { type: 'string', description: 'Associated URL (optional)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organizing events' }
    },
    required: ['title', 'startTime']
  },
  artifact: { type: 'calendar', idParam: null }  // No specific ID - calendar is singleton
}
```

### calendar_get

Get a specific event by ID.

```typescript
{
  name: 'calendar_get',
  description: 'Get a calendar event by ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Event ID' }
    },
    required: ['id']
  },
  artifact: { type: 'calendar', idParam: null, readOnly: true }
}
```

### calendar_show

Display the calendar in the calendar panel.

```typescript
{
  name: 'calendar_show',
  description: 'Display the calendar in the calendar panel. Do not read out events - the user can see them directly.',
  inputSchema: {
    type: 'object',
    properties: {
      view: { type: 'string', enum: ['list', 'day', 'week', 'month'], description: 'Calendar view mode (default: list)' },
      date: { type: 'string', description: 'Focus date in ISO 8601 format (default: today)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter events by tags' }
    },
    required: []
  },
  artifact: { type: 'calendar', idParam: null }
}
```

### calendar_list

List events within a date range.

```typescript
{
  name: 'calendar_list',
  description: 'List calendar events within a date range.',
  inputSchema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start of date range (ISO 8601, default: today)' },
      endDate: { type: 'string', description: 'End of date range (ISO 8601, default: 7 days from start)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter events by tags' },
      tagMatch: { type: 'string', enum: ['all', 'any'], description: "Tag matching mode: 'all' (AND, default) or 'any' (OR)" },
      limit: { type: 'number', description: 'Maximum events to return (default: 50)' }
    },
    required: []
  },
  artifact: { type: 'calendar', idParam: null, readOnly: true }
}
```

### calendar_search

Search events by text query.

```typescript
{
  name: 'calendar_search',
  description: 'Search calendar events by text.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (matches title, description, location)' },
      startDate: { type: 'string', description: 'Search within date range start (optional)' },
      endDate: { type: 'string', description: 'Search within date range end (optional)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
      tagMatch: { type: 'string', enum: ['all', 'any'], description: "Tag matching mode" },
      limit: { type: 'number', description: 'Maximum results (default: 20)' }
    },
    required: ['query']
  }
}
```

### calendar_update

Update an existing event.

```typescript
{
  name: 'calendar_update',
  description: 'Update a calendar event.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Event ID' },
      title: { type: 'string', description: 'New title' },
      startTime: { type: 'string', description: 'New start time' },
      endTime: { type: 'string', description: 'New end time (empty string to clear)' },
      allDay: { type: 'boolean', description: 'Set as all-day event' },
      location: { type: 'string', description: 'New location (empty string to clear)' },
      description: { type: 'string', description: 'New description (empty string to clear)' },
      url: { type: 'string', description: 'New URL (empty string to clear)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'New tags (replaces existing)' }
    },
    required: ['id']
  },
  artifact: { type: 'calendar', idParam: null }
}
```

### calendar_delete

Delete an event.

```typescript
{
  name: 'calendar_delete',
  description: 'Delete a calendar event.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Event ID' }
    },
    required: ['id']
  },
  artifact: { type: 'calendar', idParam: null }
}
```

### calendar_get_selected_events

Get events currently selected in the UI.

```typescript
{
  name: 'calendar_get_selected_events',
  description: 'Get events currently selected by the user in the calendar UI.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: []
  }
}
```

## REST API

### GET /api/plugins/artifacts/calendar

Get calendar data for display in the calendar panel.

Query parameters:

- `view`: 'list' | 'day' | 'week' | 'month' (default: 'list')
- `date`: ISO 8601 date to focus on (default: today)
- `tags`: Comma-separated tag filter

Response:

```json
{
  "events": [...],
  "view": "week",
  "focusDate": "2025-01-15",
  "tags": ["work"]
}
```

### POST /api/plugins/artifacts/calendar/events

Create a new event (for client-side modal).

Request body: Same as `calendar_create` tool parameters.

Response: Created `CalendarEvent` object.

### PATCH /api/plugins/artifacts/calendar/events/:id

Update an event (for client-side modal or inline editing).

Request body: Partial `CalendarEvent` fields.

Response: Updated `CalendarEvent` object.

### DELETE /api/plugins/artifacts/calendar/events/:id

Delete an event.

Response: `{ "ok": true }`

## WebSocket Integration

### Artifact Messages

The calendar uses the existing artifact protocol (legacy item events):

```typescript
// Server sends when calendar becomes active
{
  type: 'artifacts_active',
  artifact: { type: 'calendar', id: 'default' }
}

// Server sends when events change
{
  type: 'artifacts_updated',
  artifact: { type: 'calendar', id: 'default' },
  change: {
    action: 'event_added' | 'event_updated' | 'event_removed',
    itemId: '<event-id>'  // The affected event
  }
}
```

### Context Line Extension

Following the message context format from UI_SPEC, the calendar item includes:

```
<context type="calendar" id="default" name="Calendar" selection="event1,event2" />
```

**Attributes:**
| Attribute | Description |
| ----------- | ----------------------------------------------------- |
| `type` | Always `"calendar"` |
| `id` | Always `"default"` (single calendar) |
| `name` | Always `"Calendar"` |
| `selection` | Comma-separated event IDs selected in UI |

The client builds this context line on every message send, including any selected event IDs so the agent knows what the user is referring to.

## Client UI

The calendar follows the panel layout patterns defined in the [Panel Layout UI Specification](panel-layout-ui-spec.md).

### Calendar Panel Structure

The calendar appears in its own panel following the standard structure:

```
┌─────────────────────────────────────────────────────────────┐
│ CALENDAR                                             × │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Calendar                                                   │
│  ┌─────────────────────────────────────────────────────────┐
│  │ [Clear (N)]  [+ Add]  [Compact/Expand]  [View: List ▼] │
│  └─────────────────────────────────────────────────────────┘
│  [work] [personal]  (tag filter pills)                      │
│                                                             │
│  (calendar content - list or grid view)                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Header Elements:**

- "CALENDAR" label (uppercase, muted) - standard panel header
- Optional calendar selector for multi-calendar support
- Close button (×)

**Content Header (within panel body):**

- Title: "Calendar" (h2, artifact-section-title class; legacy CSS naming)
- Button group (right-aligned):
  - Clear selection button (hidden when no selection, shows "Clear (N)")
  - Add Event button (+ icon)
  - Compact/Expand toggle (like lists)
  - View selector dropdown (List/Week/Month)
- Tag filter pills below title row

### List View (Default)

A chronological table of events, following the list item table structure (legacy artifact classes):

```
┌─────────────────────────────────────────────────────────────┐
│ Calendar                    [Clear (2)] [+ Add] [View ▼]    │
│ [work] [personal] ×                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ TODAY - Wednesday, January 15                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Time     │ Title          │ Duration │ Location │ Tags  │ │
│ ├──────────┼────────────────┼──────────┼──────────┼───────┤ │
│ │ 2:00 PM  │ ⋮⋮ Team Meeting│ 1h       │ Room A   │ [work]│ │
│ │ 4:00 PM  │ ⋮⋮ Project Rev │ 30m      │          │ [work]│ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ TOMORROW - Thursday, January 16                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ All day  │ ⋮⋮ Proj Deadline│         │          │[urgent]│ │
│ │ 10:00 AM │ ⋮⋮ Client Call │ 1h       │          │ [work]│ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Event Table Structure

Following the list item table structure pattern from UI_SPEC:

| Column   | Width | Content                                        |
| -------- | ----- | ---------------------------------------------- |
| Time     | 80px  | Start time or "All day"                        |
| Title    | flex  | Drag handle (on hover) + event title           |
| Duration | 60px  | Calculated from start/end (expanded view only) |
| Location | flex  | Location text (if any events have location)    |
| Tags     | flex  | Tag pills (if any events have tags)            |

**Compact vs Expanded View:**

- **Compact**: Time, Title, Tags (only columns with data)
- **Expanded**: All columns including Duration, Location

### Date Grouping

Events are grouped by date with section headers:

- **TODAY** - current date
- **TOMORROW** - next day
- **[Day of week], [Month] [Date]** - for other dates

Empty date sections are not shown.

### Calendar Grid View (Future Enhancement)

A traditional calendar grid layout for week/month views:

```
┌─────────────────────────────────────────────────────────────┐
│ Calendar                           < Jan 2025 >  [View ▼]   │
│ [work] [personal] ×                                         │
├─────────────────────────────────────────────────────────────┤
│  Sun    Mon    Tue    Wed    Thu    Fri    Sat              │
├───────┬───────┬───────┬───────┬───────┬───────┬────────────┤
│  12   │  13   │  14   │  15   │  16   │  17   │  18        │
│       │ Team  │       │ Team  │ Client│ Dentist│           │
│       │ Mtg   │       │ Mtg   │ Call  │       │           │
│       │ ●●    │       │ ●●    │ ●     │ ●     │           │
├───────┼───────┼───────┼───────┼───────┼───────┼────────────┤
│  19   │  20   │  21   │  22   │  23   │  24   │  25        │
└───────┴───────┴───────┴───────┴───────┴───────┴────────────┘
```

**Potential Libraries:**

- **FullCalendar** (fullcalendar.io) - Popular, feature-rich, MIT license
- **tui.calendar** (github.com/nhn/tui.calendar) - Lightweight, MIT license
- **day.js + custom grid** - Build minimal grid ourselves

**Recommendation:** Start with list view only (matches existing list item patterns), add calendar grid view as enhancement. List view is simpler, more accessible, and sufficient for MVP.

### Add/Edit Event Modal

Modal dialog for creating/editing events, following the confirm-dialog pattern from UI_SPEC:

```
┌─────────────────────────────────────────────────────────────┐
│ Add Event                                                 × │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Title *                                                     │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Team Meeting                                            │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ☐ All day                                                   │
│                                                             │
│ Start *                           End                       │
│ ┌─────────────────────┐          ┌─────────────────────┐   │
│ │ 2025-01-15 14:00    │          │ 2025-01-15 15:00    │   │
│ └─────────────────────┘          └─────────────────────┘   │
│                                                             │
│ Location                                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Conference Room A                                       │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Description                                                 │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Weekly team sync to discuss project status              │ │
│ │                                                         │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ Tags                                                        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ work, meetings                                          │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Save]               │
└─────────────────────────────────────────────────────────────┘
```

**Modal Behavior:**

- Uses `.confirm-dialog-overlay` and `.confirm-dialog` classes (existing pattern)
- Closes on Escape key, overlay click, or Cancel button
- Save button POSTs to `/api/plugins/artifacts/calendar/events` (create) or PATCHes (edit)
- Optimistic update with revert on error

**Form Fields:**

- Title: Required text input
- All day: Checkbox (when checked, hides time pickers)
- Start: Date/time picker (required)
- End: Date/time picker (optional, defaults to start + 1 hour)
- Location: Text input
- Description: Textarea
- Tags: Comma-separated text input (normalized on save)

### Event Selection

Following the list item selection pattern from UI_SPEC:

**Desktop Selection:**

- `Ctrl/Cmd + Click`: Toggle selection on individual events
- `Shift + Click`: Select range from last selected event (clears previous selection)
- Selected events have accent background color (`.calendar-event-selected` class)

**Mobile Selection:**

- Long-press (500ms) to toggle selection
- Touch must stay within 10px of start position (otherwise treated as scroll)

**Clear Selection Button:**

- Appears in header when events are selected
- Shows count: "Clear (N)"
- Clicking clears all selections
- Hidden when no events selected

**Selection State Tracking:**

- `lastSelectedEventIndex` tracks anchor for Shift+Click range selection
- `getSelectedEventIds()` returns array of selected event IDs
- Selection cleared when switching items or views

### Event Row Interactions

Each event row supports:

| Interaction         | Action                                           |
| ------------------- | ------------------------------------------------ |
| Click               | Open event in edit modal                         |
| Ctrl/Cmd+Click      | Toggle selection                                 |
| Shift+Click         | Range selection                                  |
| Long-press (mobile) | Toggle selection                                 |
| Hover               | Show drag handle (⋮⋮) at start of title          |
| Drag                | Future - reschedule by dragging to new time/date |

**Row Styling:**

- `.calendar-event-row` base class
- `.calendar-event-selected` when selected (accent background)
- `.calendar-event-highlight` for agent-change animation (same as list items)

### Scroll and Highlight Behavior

Following the list scroll and highlight behavior from UI_SPEC:

**Scroll Position Preservation:**

- When refreshing calendar, scroll position is preserved
- User changes tracked for 5 seconds to avoid scroll/highlight on own changes

**Agent Change Highlighting:**

1. Server sends `artifacts_updated` with `change: { action: 'event_added', itemId }`
2. Client scrolls to changed event (if not already visible)
3. Changed row shows highlight animation (2 blinks, 0.5s, 1px accent outline)
4. Animation waits for scroll to complete (uses `scrollend` event with fallback)

**User vs Agent Change Detection:**

- `recentUserEventUpdates` Set tracks user-modified events
- Events cleared from set after 5 seconds
- If `artifacts_updated` for user-changed event: preserve scroll, no highlight
- If `artifacts_updated` for agent-changed event: scroll to it and highlight

### Icons

Following the SVG-based icon pattern from UI_SPEC (Lucide style, no emoji):

| Icon         | Usage                   | Description                      |
| ------------ | ----------------------- | -------------------------------- |
| Calendar     | Artifact type indicator | Calendar icon (grid with header) |
| Plus         | Add Event button        | Plus sign                        |
| ChevronDown  | View dropdown           | Down arrow                       |
| GripVertical | Drag handle             | Vertical dots (⋮⋮)               |
| X            | Close/clear buttons     | X mark                           |
| Clock        | Time display            | Clock icon (optional)            |
| MapPin       | Location indicator      | Location pin (optional)          |

**Calendar Icon SVG (Lucide):**

```html
<svg class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true">
  <rect
    x="3"
    y="4"
    width="18"
    height="18"
    rx="2"
    ry="2"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  />
  <line
    x1="16"
    y1="2"
    x2="16"
    y2="6"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
  />
  <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="2" />
</svg>
```

## Plugin Configuration

Add calendar to the config:

```json
{
  "plugins": {
    "lists": { "enabled": true },
    "notes": { "enabled": true },
    "url-fetch": { "enabled": true },
    "calendar": { "enabled": true }
  }
}
```

## Agent Configuration

Example calendar agent:

```json
{
  "agentId": "calendar",
  "displayName": "Calendar",
  "description": "Manages your calendar and scheduled events.",
  "systemPrompt": "You are a calendar assistant. Help the user manage their schedule, create events, and find available time.\n\nYou can:\n- Create, update, and delete calendar events\n- Search for events by text or date range\n- Filter events by tags (work, personal, health, etc.)\n- Show the calendar in different views (list, week, month)\n\nWhen creating events, ask for necessary details like date, time, and duration. Use sensible defaults:\n- Default duration: 1 hour for meetings, all-day for deadlines\n- Suggest tags based on event content\n\nWhen showing multiple events, use the calendar_show tool to display them in the calendar panel rather than listing them in chat.",
  "toolAllowlist": ["calendar_*", "url_fetch_fetch"]
}
```

## Artifact Registry

Register calendar as an artifact item type (artifact API type):

```typescript
// In calendar plugin
export function createCalendarPlugin(): ToolPlugin {
  return {
    name: 'calendar',
    tools: createToolDefinitions(),
    artifacts: {
      types: ['calendar'],
      async get(type: string, id: string): Promise<unknown> {
        if (type !== 'calendar') return undefined;
        // 'id' is always 'default' for singleton calendar
        const store = requireStore();
        const events = await store.listEvents({ limit: 0 }); // All events
        return { id: 'default', events };
      },
      async list(type: string): Promise<{ id: string; name: string }[]> {
        if (type !== 'calendar') return [];
        // Single calendar, always available
        return [{ id: 'default', name: 'Calendar' }];
      },
      async updateItem(type, artifactId, itemId, updates): Promise<unknown> {
        if (type !== 'calendar') return undefined;
        const store = requireStore();
        return store.updateEvent({ id: itemId, ...updates });
      },
    },
    initialize: async (dataDir: string) => {
      /* ... */
    },
    shutdown: async () => {
      /* ... */
    },
  };
}
```

## Implementation Plan

### Phase 1: Backend (MVP)

1. Create `packages/agent-server/src/plugins/calendar/` directory
2. Implement `types.ts` with CalendarEvent interface
3. Implement `store.ts` with CalendarStore class
4. Implement `index.ts` with plugin tools
5. Register plugin in `registry.ts`
6. Add REST endpoints for client CRUD

### Phase 2: Client List View

1. Add calendar item rendering in web client (list view only)
2. Implement event row with time, title, duration, location, tags
3. Add date grouping (Today, Tomorrow, This Week, etc.)
4. Add "Add Event" button and modal
5. Implement event selection (Ctrl+Click, Shift+Click)
6. Send selection in message context

### Phase 3: Tag Filtering & Polish

1. Add tag filter UI (similar to existing item tags)
2. Implement tag filtering in list view
3. Add view switcher dropdown (list/week/month - week/month disabled initially)
4. Add edit event modal
5. Add delete confirmation

### Phase 4: Calendar Grid View (Enhancement)

1. Evaluate FullCalendar vs. tui.calendar vs. custom
2. Implement week view
3. Implement month view
4. Navigation (previous/next week/month)

### Phase 5: Android Parity

1. Port calendar list view to Android client
2. Implement event modal
3. Ensure selection works with long-press

## Protocol Changes

### ArtifactChange Extension

Add new actions for calendar events:

```typescript
// In packages/shared/src/protocol.ts
export const ArtifactChangeSchema = z.object({
  action: z.enum([
    'item_added',
    'item_updated',
    'item_removed', // Existing
    'list_updated',
    'note_updated', // Existing
    'event_added',
    'event_updated',
    'event_removed', // New for calendar
  ]),
  itemId: z.string().optional(),
});
```

## Testing

### Unit Tests

- CalendarStore CRUD operations
- Date range filtering
- Tag filtering
- Search functionality

### Integration Tests

- Tool execution
- REST API endpoints
- WebSocket item updates (artifact\_\* messages)

### E2E Tests

- Create event via chat
- Create event via modal
- Edit event
- Delete event
- Tag filtering
- Selection in context

## Open Questions

1. **Timezone handling**: Store in UTC, display in local time? Need to consider user preference.
2. **Reminders/Notifications**: Out of scope for MVP, but design should accommodate future addition.
3. **External calendar sync**: Future integration with Google Calendar, iCal, etc.
4. **Recurring events**: Complexity for MVP - defer to Phase 2.
5. **Conflict detection**: Should agent warn about overlapping events?

## Summary

The calendar plugin follows established patterns from the lists and notes plugins:

- JSON file storage
- Plugin tools for agent access
- REST API for client CRUD
- WebSocket item updates (artifact\_\* messages)
- Calendar panel rendering with selection

Key differences from lists:

- Time-based data model with start/end times
- Multiple view modes (list, week, month)
- Single calendar with tag filtering (vs. multiple lists)
- Date grouping in list view
