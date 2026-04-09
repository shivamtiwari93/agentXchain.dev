# UX Flows — Habit Board

## Daily Check-In Flow

1. User opens the app → sees all habits as cards in a grid.
2. Each card shows: habit name, color accent bar, current streak count, and a "Mark done" / "Done today" toggle button.
3. User taps "Mark done" → button changes to "Done today" (green filled state) → streak updates.
4. User taps "Done today" → reverts to "Mark done" (outline state) → streak updates.
5. No page reload required; UI refreshes via fetch + re-render.

## Habit Management Flow

1. User types a habit name in the input field at the top.
2. Optionally picks a color via the color picker.
3. Submits the form → new habit card appears in the grid.
4. To delete: user clicks "Delete" on a card → confirmation dialog → card removed.
5. There is no edit flow in v1. Users delete and recreate if they want to rename.

## Accessibility

- All form inputs have `aria-label` attributes.
- Sections use `aria-label` for screen reader context.
- Color is never the only indicator — text labels accompany all states.
- Focus states are visible (inherited from border-color transitions).
- The app uses semantic HTML (`header`, `main`, `footer`, `section`, `form`, `button`).
