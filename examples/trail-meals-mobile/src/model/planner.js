'use strict';

const DEFAULT_CALORIE_FLOOR = 2000;

/**
 * Compute per-day and per-trip nutrition/weight summaries.
 * @param {object} trip — a trip object from createTrip with populated dayPlans
 * @param {{ calorieFloor?: number }} opts
 * @returns {{ perDay: Array, tripTotalCalories: number, tripTotalWeightG: number, overBudget: boolean, lowCalorieDays: number[] }}
 */
function computeTripSummary(trip, { calorieFloor = DEFAULT_CALORIE_FLOOR } = {}) {
  const perDay = trip.dayPlans.map((day) => {
    const dayCalories = day.meals.reduce((sum, m) => sum + m.totalCalories, 0);
    const dayWeightG = day.meals.reduce((sum, m) => sum + m.totalWeightG, 0);
    const emptyMeals = day.meals.filter((m) => m.isEmpty).length;
    return {
      dayIndex: day.dayIndex,
      calories: dayCalories,
      weightG: dayWeightG,
      emptyMeals,
    };
  });

  const tripTotalCalories = perDay.reduce((sum, d) => sum + d.calories, 0);
  const tripTotalWeightG = perDay.reduce((sum, d) => sum + d.weightG, 0);

  const overBudget = trip.weightBudgetG > 0 && tripTotalWeightG > trip.weightBudgetG;

  const lowCalorieDays = perDay
    .filter((d) => d.calories < calorieFloor)
    .map((d) => d.dayIndex);

  return {
    perDay,
    tripTotalCalories,
    tripTotalWeightG,
    overBudget,
    lowCalorieDays,
  };
}

module.exports = { computeTripSummary, DEFAULT_CALORIE_FLOOR };
