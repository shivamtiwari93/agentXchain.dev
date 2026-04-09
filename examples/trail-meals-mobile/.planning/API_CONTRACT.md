# API Contract

Trail Meals is a local-only mobile app — there is no HTTP API. This contract documents the internal data model, storage interface, and computed fields.

## Data Model

### Trip
| Field | Type | Constraints |
|-------|------|------------|
| `id` | string | Auto-generated: `trip_{counter}_{timestamp}` |
| `name` | string | Required, non-empty |
| `startDate` | string | ISO date (YYYY-MM-DD), required |
| `days` | number | Positive integer, ≥ 1 |
| `weightBudgetG` | number | Non-negative, default 0 (no constraint) |
| `dayPlans` | DayPlan[] | Length === `days`, auto-populated on creation |

### DayPlan
| Field | Type |
|-------|------|
| `dayIndex` | number (0-based) |
| `meals` | Meal[] |

### Meal
| Field | Type | Constraints |
|-------|------|------------|
| `name` | string | Required |
| `type` | enum | `breakfast` \| `lunch` \| `dinner` \| `snack` |
| `ingredients` | Ingredient[] | May be empty |

### Ingredient
| Field | Type | Constraints |
|-------|------|------------|
| `name` | string | Required |
| `caloriesPer100g` | number | Non-negative |
| `weightG` | number | Non-negative |
| `calories` | number | Computed: `round(caloriesPer100g × weightG / 100)` |

## Storage Interface

| Method | Signature | Description |
|--------|-----------|-------------|
| `loadTrips` | `() → Trip[]` | Load all trips from AsyncStorage |
| `saveTrips` | `(trips: Trip[]) → void` | Overwrite all trips |
| `addTrip` | `(trip: Trip) → Trip` | Append and persist |
| `deleteTrip` | `(tripId: string) → boolean` | Remove by ID |
| `updateTrip` | `(tripId: string, updater: fn) → Trip \| null` | Mutate in place |
| `clear` | `() → void` | Remove all data |

## Computed Fields

| Field | Source | Formula |
|-------|--------|---------|
| `meal.totalCalories` | getter | `sum(ingredients[].calories)` |
| `meal.totalWeightG` | getter | `sum(ingredients[].weightG)` |
| `meal.isEmpty` | getter | `ingredients.length === 0` |
| `summary.perDay[].calories` | planner | `sum(day.meals[].totalCalories)` |
| `summary.perDay[].weightG` | planner | `sum(day.meals[].totalWeightG)` |
| `summary.tripTotalCalories` | planner | `sum(perDay[].calories)` |
| `summary.tripTotalWeightG` | planner | `sum(perDay[].weightG)` |
| `summary.overBudget` | planner | `weightBudgetG > 0 && totalWt > weightBudgetG` |
| `summary.lowCalorieDays` | planner | `dayIndexes where calories < calorieFloor` |
