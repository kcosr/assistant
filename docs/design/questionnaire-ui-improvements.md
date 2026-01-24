# Questionnaire UI and Keyboard Improvements

## Summary
Tighten questionnaire styling and add focus/keyboard behaviors so interactive questions are easier to see and answer without mouse clicks.

## Goals
- Constrain questionnaire width to match other chat blocks.
- Fix checkbox alignment so labels sit beside inputs.
- Improve text selection contrast inside questionnaires.
- Make text inputs and multi-select lists more flexible in size.
- Auto-focus the first pending questionnaire control when it renders.
- Return focus to the main chat input on submit or cancel.
- Support Enter-to-submit for questionnaire forms and smooth keyboard navigation across fields.

## Non-goals
- Redesign the overall questionnaire layout or schema.
- Change server-side tool behavior or response validation rules.
- Implement multi-step section navigation beyond current schema rendering.

## Current behavior
- `.interaction-block` spans the full chat width and can feel too wide.
- Checkbox/boolean fields render below the label because the label is a column flex container.
- Text selection inherits default styles and can appear low-contrast in the questionnaire block.
- Textarea height and multiselect list height are fixed by browser defaults.
- Chat panel focus does not move focus into the questionnaire, so users must click to start.
- Enter submits only in some controls (native form behavior); arrow keys do not move between fields.

## Proposed UI changes
- **Width:** Set `.interaction-block` to `max-width: 680px` (match tool output blocks) and `width: 100%`.
- **Checkbox alignment:** Render checkbox/boolean fields as inline rows (input + label text) with a new
  `.interaction-checkbox-row` class.
- **Selection contrast:** Add `.interaction-block ::selection` styling so selected text uses primary
  text color on an accent-tinted background.
- **Input sizing:**
  - `.interaction-input { width: 100%; }`
  - `textarea.interaction-input { min-height: 96px; resize: vertical; }`
  - `select[multiple]` gets a `size` attribute derived from option count (e.g., min 4, max 8)
    to make long option lists easier to scan.

## Focus and keyboard behavior
- Add a `ChatRenderer.focusFirstQuestionnaireInput()` helper that:
  - Finds the most recent **pending** questionnaire interaction (not `.interaction-complete`).
  - Focuses the first enabled, focusable control inside it.
  - Skips if focus is already inside an interaction form (avoid stealing focus).
- Call this helper after rendering a questionnaire, but **skip on mobile** to avoid popping the
  software keyboard.
- Add a form-level keydown handler:
  - **Enter** triggers `form.requestSubmit()` for all controls.
  - **Shift+Enter** preserves newline insertion for textareas.
  - Tab/Shift+Tab remain native for field navigation.
- After questionnaire submit/cancel, focus the main chat input (skip on mobile).

## Accessibility notes
- Keep native inputs (no custom roles) to preserve screen-reader expectations.
- Use `requestSubmit()` so validation and disabled states still work.

## Tests
- `packages/web-client/src/utils/interactionRenderer.test.ts`:
  - Enter submits when focused on textarea.
  - Shift+Enter does **not** submit when focused on textarea.
- Add a lightweight ChatRenderer test or unit helper test to ensure
  `focusFirstQuestionnaireInput()` focuses the first pending control.

## Docs
- Update `docs/design/questionnaire-tool.md` (Keyboard and focus behavior section).
- Consider adding a short note to `packages/plugins/official/questions/README.md`.

## Files to update
- `packages/web-client/public/styles.css`
- `packages/web-client/src/utils/interactionRenderer.ts`
- `packages/web-client/src/utils/interactionRenderer.test.ts`
- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/panels/chat/chatPanel.ts`
- `packages/web-client/src/panels/chat/runtime.ts`
- `packages/web-client/src/index.ts`
- `docs/design/questionnaire-tool.md`
- `packages/plugins/official/questions/README.md`

## Decisions
- Use `max-width: 680px` to match tool output blocks.
- Enter submits across all controls; Shift+Enter adds a newline in textareas.
- Arrow keys remain native; Tab/Shift+Tab handle field navigation.
- Skip auto-focus on mobile to avoid forcing the software keyboard.
