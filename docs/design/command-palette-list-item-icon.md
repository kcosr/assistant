# Command Palette List Item Icon

## Summary
Command palette search results currently use the same icon for list titles and list items because icons are resolved only by `panelType`. Add a list-item-specific icon by inspecting the search result payload and returning a different SVG for list items.

## Current Behavior
- `CommandPaletteController` renders search results with `resolveIcon(panelType)`.
- The lists search provider returns both list titles and list items with `panelType: "lists"`.
- Both list titles and list items therefore render the lists panel icon.

## Proposed Change
- Update icon resolution to accept the full `SearchApiResult` (or at least its `launch.payload`).
- When `panelType === "lists"` and `payload.itemId` is present, use a list-item icon instead of the list icon.
- Keep list titles using the existing lists icon.

### Icon Choice
- Recommendation: reuse `ICONS.check` to suggest an item within a list.
- Alternative: use `ICONS.fileText` if a more neutral, note-like icon is preferred.

## Implementation Notes
1. Update `CommandPaletteControllerOptions.resolveIcon` to accept a `SearchApiResult` instead of just the panel type.
2. Update `CommandPaletteController.renderResultsList` to pass the result into `resolveIcon`.
3. In `packages/web-client/src/index.ts`, update `resolveCommandPaletteIcon`:
   - If `result.launch.panelType === "lists"` and `"itemId" in result.launch.payload`, return the list-item icon.
   - Otherwise fall back to the manifest icon or `ICONS.panelGrid`.
4. Consider reusing the existing list icon for list titles (`id` prefixed with `list:`) as today.

## Files Touched
- `packages/web-client/src/controllers/commandPaletteController.ts`
- `packages/web-client/src/index.ts`
- `packages/web-client/src/utils/icons.ts` (only if adding a new icon instead of reusing one)

## Tests
- Add/update a unit test for `CommandPaletteController` to verify icon resolution is called with the result object.
- If no existing tests cover the resolver path, add a small test to check that list items choose the alternate icon when `payload.itemId` is present.
