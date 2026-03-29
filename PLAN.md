# Context Usage Display Plan

## Goal

Display available context percentage for Pi-backed chat sessions in:
- the active chat header, next to the session title
- the session row metadata line in the sessions panel

This is phase one of broader context tracking and compaction work.

## Scope

- Pi-backed sessions only
- Use provider-reported usage from the Pi SDK as the source of truth
- No transcript parsing
- No heuristic estimation in phase one
- No per-delta UI updates in phase one

## Metric

Show available context percentage, not used percentage.

- Compact display: bare percentage only, e.g. `73%`
- No label text in the primary UI
- Later hover/click detail can show the breakdown

### Calculation

Mirror Pi coding-agent:

- numerator:
  - `usage.totalTokens`
  - fallback: `usage.input + usage.output + usage.cacheRead + usage.cacheWrite`
- denominator:
  - current resolved model `contextWindow`
- displayed value:
  - rounded whole-number available percentage
  - `availablePercent = clamp(round(((contextWindow - tokens) / contextWindow) * 100), 0, 100)`

## Data Shape

Persist optional session-level runtime telemetry in the session summary/index:

```json
{
  "contextUsage": {
    "availablePercent": 73,
    "contextWindow": 200000,
    "usage": {
      "input": 12000,
      "output": 1800,
      "cacheRead": 35000,
      "cacheWrite": 5200,
      "totalTokens": 54000
    }
  }
}
```

Notes:
- Present only when known
- Omit entirely when unknown
- This is runtime session telemetry, not session attributes/config

## Lifecycle Rules

- New Pi session with no known usage:
  - show nothing
- Known Pi session with persisted `contextUsage`:
  - show percentage
- Non-Pi session:
  - show nothing
- Session clear/reset:
  - remove `contextUsage`
  - UI shows nothing until a new Pi response provides usage
- Running Pi tool loop:
  - update after each completed Pi assistant response/iteration with usage
- Delta chunks:
  - no context-usage UI update in phase one
- Reconnect/resume/reload:
  - use persisted `contextUsage` if present
  - otherwise show nothing
- Other history edits:
  - phase one does not backfill or recompute from transcript/history
  - the display may remain stale until the next Pi assistant response provides fresh usage

## Transport

Do not add a dedicated high-frequency stats event stream.

Instead:
- persist last-known `contextUsage` in the session index
- include it in normal session summary/bootstrap payloads whenever known
- update summaries as normal when a new value is stored

## UI Scope

Phase one surfaces:
- chat header next to the session title
- session row metadata line where timestamp metadata already appears

Do not add it elsewhere yet.

## Implementation Notes

- Update Pi integration to capture usage from completed assistant responses/iterations
- Persist `contextUsage` through the session index record stream
- Clear it on session clear
- Thread it through session summaries to the web client
- Render in the active chat header and session row metadata

## Testing

- Session index persistence/load for `contextUsage`
- Pi usage-to-contextUsage calculation
- Clear/reset removes `contextUsage`
- Non-Pi sessions do not surface the indicator
- Web client renders percentage in:
  - chat header
  - session row metadata
- Web client hides the indicator when `contextUsage` is absent
