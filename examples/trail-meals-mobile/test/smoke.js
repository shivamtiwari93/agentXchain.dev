'use strict';

const { createTrip } = require('../src/model/trip');
const { createMeal } = require('../src/model/meal');
const { createIngredient } = require('../src/model/ingredient');
const { computeTripSummary } = require('../src/model/planner');

const trip = createTrip({ name: 'Smoke Test Hike', startDate: '2026-06-15', days: 2, weightBudgetG: 3000 });

const oats = createIngredient({ name: 'Oats', caloriesPer100g: 389, weightG: 100 });
const jerky = createIngredient({ name: 'Jerky', caloriesPer100g: 410, weightG: 80 });

trip.dayPlans[0].meals.push(createMeal({ name: 'Oat Bowl', type: 'breakfast', ingredients: [oats] }));
trip.dayPlans[1].meals.push(createMeal({ name: 'Jerky Snack', type: 'snack', ingredients: [jerky] }));

const summary = computeTripSummary(trip);

const checks = [
  ['has perDay array', Array.isArray(summary.perDay) && summary.perDay.length === 2],
  ['tripTotalCalories > 0', summary.tripTotalCalories > 0],
  ['tripTotalWeightG > 0', summary.tripTotalWeightG > 0],
  ['overBudget is boolean', typeof summary.overBudget === 'boolean'],
  ['lowCalorieDays is array', Array.isArray(summary.lowCalorieDays)],
];

let passed = 0;
for (const [label, ok] of checks) {
  if (ok) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
  }
}

console.log(`\n${passed}/${checks.length} smoke checks passed`);
if (passed !== checks.length) process.exit(1);
console.log('PASS');
