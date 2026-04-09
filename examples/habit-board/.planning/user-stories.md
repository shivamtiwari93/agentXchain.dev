# User Stories — Habit Board

## Core User Stories

- **As a user**, I want to create a new habit with a name and color so I can track it daily.
- **As a user**, I want to mark a habit as done for today with one click so tracking is frictionless.
- **As a user**, I want to unmark a habit if I made a mistake so my data stays accurate.
- **As a user**, I want to see my current streak for each habit so I stay motivated.
- **As a user**, I want to delete a habit I no longer track so my board stays clean.
- **As a user**, I want the app to work on my phone and desktop so I can check in anywhere.

## Acceptance Criteria

- Creating a habit with an empty name is rejected with a clear error.
- Checking a habit twice on the same day does not create duplicate entries.
- Streak resets to 0 when I miss a day (after yesterday's grace period).
- Deleting a habit removes it permanently with no undo.
- The UI renders correctly on screens as narrow as 320px.
- The server starts with zero configuration (`npm start`).
