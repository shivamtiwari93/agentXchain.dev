# Trail Meals Mobile

A **mobile meal-planning app for hikers and campers**, built with React Native (Expo) and governed by AgentXchain.

Plan meals for multi-day trips, track calorie targets and weight budgets, and reference your plan on the trail — offline, no network required.

## What This Example Proves

- **Mobile governance**: AgentXchain can govern React Native / Expo mobile app development, not just web apps or CLI tools
- **Offline-first architecture**: AsyncStorage-backed persistence with zero network dependency
- **Domain-specific roles**: 6-role team with mobile architect, nutrition analyst, and UX reviewer — not a generic PM/Dev/QA scaffold
- **Platform matrix**: Explicit iOS, Android, and Expo Go build/run constraints documented as governed artifacts
- **Pure business logic testing**: Core model and planner logic tested with `node --test` — no device or emulator required

## How to Run

### Development (Expo Go)

```bash
cd examples/trail-meals-mobile
npm install
npx expo start
```

Scan the QR code with the Expo Go app on your iOS or Android device.

### Native Build

```bash
npx expo run:ios     # Requires Xcode
npx expo run:android # Requires Android Studio
```

### Tests (No Device Needed)

```bash
node --test test/
```

This runs all 26 business logic tests — model validation, planner computations, and offline storage — using pure Node.js.

## Architecture

```
Trail Meals Mobile
├── Model Layer (pure JS, no RN dependency)
│   ├── trip.js         — Trip entity with day plan generation
│   ├── meal.js         — Meal entity with type validation
│   ├── ingredient.js   — Ingredient with calorie computation
│   └── planner.js      — Trip summary: calories, weight, warnings
├── Storage Layer
│   └── offline-store.js — AsyncStorage-backed CRUD with mock injection
├── Screen Layer (React Native)
│   ├── TripsScreen      — Trip list with add/delete
│   ├── TripDetailScreen — Day-by-day meal view
│   ├── MealEditorScreen — Ingredient management
│   └── SummaryScreen    — Nutrition/weight summary with warnings
└── Navigation
    └── AppNavigator     — Stack + bottom tab (React Navigation 7)
```

## Governed Workflow

| Phase | Role | Artifacts |
|-------|------|-----------|
| Planning | PM | `ROADMAP.md`, `nutrition-model.md` |
| Architecture | Mobile Architect | `platform-matrix.md`, `offline-strategy.md` |
| Implementation | RN Engineer | `API_CONTRACT.md` |
| UX Review | UX Reviewer | `ux-patterns.md` |
| QA | QA Engineer | `acceptance-matrix.md`, `ship-verdict.md` |

6 roles, 5 phases, explicit workflow-kit with section-level semantic checks.

## Key Features

- **Trip planning**: Create multi-day trips with per-day meal assignments
- **Calorie tracking**: Per-ingredient, per-meal, per-day, and per-trip calorie totals
- **Weight budgeting**: Set a food weight limit and get warnings when exceeded
- **Low-calorie alerts**: Flag days below a configurable calorie floor (default 2000 kcal for hiking)
- **Offline-first**: All data stored locally via AsyncStorage — works without network
- **Dark theme**: Hiking-friendly dark UI across all screens
