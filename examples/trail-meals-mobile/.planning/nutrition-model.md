# Nutrition Model

## Calorie Computation

- Each ingredient stores `caloriesPer100g` (energy density) and `weightG` (portion size)
- Per-ingredient calories: `Math.round((caloriesPer100g × weightG) / 100)`
- Meal total: sum of all ingredient calories
- Day total: sum of all meal totals for that day
- Trip total: sum of all day totals

Rounding is applied per-ingredient (not per-meal or per-day) to maintain consistent attribution.

## Weight Budget

- Each trip has an optional `weightBudgetG` (total food weight in grams the hiker can carry)
- If `weightBudgetG > 0` and total trip food weight exceeds it, `overBudget` flag is `true`
- If `weightBudgetG === 0`, no weight constraint is enforced
- Weight is tracked per-ingredient (`weightG`), summed per-meal, per-day, and per-trip

## Hiking Nutrition Requirements

- Default calorie floor: **2000 kcal/day** (typical minimum for active hiking)
- Configurable via `calorieFloor` parameter in the planner
- Days below the floor are flagged in `lowCalorieDays` array (by day index)
- This is a planning aid, not a medical recommendation — the app should display it as a warning, not a hard error
- Hikers at altitude or in cold conditions may need 3000–4000 kcal/day — the configurable floor accommodates this
