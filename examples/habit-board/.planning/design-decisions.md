# Design Decisions — Habit Board

## Visual Language

- **Dark theme** as default — modern, easy on the eyes for a daily-use consumer app.
- **Card-based layout** — each habit is a self-contained unit with its own color accent, streak, and actions.
- **Color accent bar** — a 3px top border on each card in the user-chosen color, providing personality without overwhelming the UI.
- **Minimal chrome** — no sidebar, no tabs, no settings page. The entire app is one screen.
- **System font stack** — fast loading, native feel, no font dependencies.

## Responsive Behavior

- **Desktop (>480px)**: auto-fill grid with `minmax(200px, 1fr)` — cards fill available space naturally.
- **Mobile (<=480px)**: single column, full-width cards, form wraps to stack vertically.
- **No breakpoint between** — the CSS grid auto-fill handles intermediate widths without a specific tablet breakpoint.
- **Touch targets** — buttons have minimum 40px height for comfortable tapping.
