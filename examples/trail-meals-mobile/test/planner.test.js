const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTrip, _resetIdCounter } = require('../src/model/trip');
const { createMeal } = require('../src/model/meal');
const { createIngredient } = require('../src/model/ingredient');
const { computeTripSummary } = require('../src/model/planner');

describe('planner — calorie and weight computations', () => {
  it('computes correct per-day and per-trip totals', () => {
    _resetIdCounter();
    const trip = createTrip({ name: 'PCT Section A', startDate: '2026-06-01', days: 2 });

    const oats = createIngredient({ name: 'Oats', caloriesPer100g: 389, weightG: 100 });
    const peanutButter = createIngredient({ name: 'Peanut Butter', caloriesPer100g: 588, weightG: 50 });
    const trailMix = createIngredient({ name: 'Trail Mix', caloriesPer100g: 462, weightG: 150 });
    const ramen = createIngredient({ name: 'Ramen', caloriesPer100g: 436, weightG: 85 });

    const breakfast = createMeal({ name: 'Oat Bowl', type: 'breakfast', ingredients: [oats, peanutButter] });
    const lunch = createMeal({ name: 'Trail Snack', type: 'lunch', ingredients: [trailMix] });
    const dinner = createMeal({ name: 'Camp Ramen', type: 'dinner', ingredients: [ramen] });

    trip.dayPlans[0].meals.push(breakfast, lunch);
    trip.dayPlans[1].meals.push(dinner);

    const summary = computeTripSummary(trip);

    // Day 0: oats (389) + peanut butter (294) + trail mix (693) = 1376 kcal
    assert.equal(summary.perDay[0].calories, oats.calories + peanutButter.calories + trailMix.calories);
    // Day 0 weight: 100 + 50 + 150 = 300g
    assert.equal(summary.perDay[0].weightG, 300);

    // Day 1: ramen = 371 kcal, 85g
    assert.equal(summary.perDay[1].calories, ramen.calories);
    assert.equal(summary.perDay[1].weightG, 85);

    // Trip totals
    assert.equal(summary.tripTotalCalories, summary.perDay[0].calories + summary.perDay[1].calories);
    assert.equal(summary.tripTotalWeightG, 385);
  });

  it('flags over-budget when trip weight exceeds budget', () => {
    _resetIdCounter();
    const trip = createTrip({ name: 'Heavy Trip', startDate: '2026-07-01', days: 1, weightBudgetG: 100 });
    const heavy = createIngredient({ name: 'Canned Beans', caloriesPer100g: 155, weightG: 400 });
    const meal = createMeal({ name: 'Bean Feast', type: 'dinner', ingredients: [heavy] });
    trip.dayPlans[0].meals.push(meal);

    const summary = computeTripSummary(trip);
    assert.equal(summary.overBudget, true);
    assert.equal(summary.tripTotalWeightG, 400);
  });

  it('does not flag over-budget when weightBudgetG is 0 (no constraint)', () => {
    _resetIdCounter();
    const trip = createTrip({ name: 'No Budget', startDate: '2026-07-01', days: 1, weightBudgetG: 0 });
    const heavy = createIngredient({ name: 'Bricks', caloriesPer100g: 0, weightG: 9999 });
    const meal = createMeal({ name: 'Brick Meal', type: 'lunch', ingredients: [heavy] });
    trip.dayPlans[0].meals.push(meal);

    const summary = computeTripSummary(trip);
    assert.equal(summary.overBudget, false);
  });

  it('identifies low-calorie days below the floor', () => {
    _resetIdCounter();
    const trip = createTrip({ name: 'Light Trip', startDate: '2026-08-01', days: 3 });

    // Day 0: well-fed (2500 kcal)
    const bigMeal = createIngredient({ name: 'MRE', caloriesPer100g: 250, weightG: 1000 });
    trip.dayPlans[0].meals.push(createMeal({ name: 'Big MRE', type: 'lunch', ingredients: [bigMeal] }));

    // Day 1: empty — 0 kcal
    // Day 2: minimal — 500 kcal
    const bar = createIngredient({ name: 'Energy Bar', caloriesPer100g: 500, weightG: 100 });
    trip.dayPlans[2].meals.push(createMeal({ name: 'Bar Only', type: 'snack', ingredients: [bar] }));

    const summary = computeTripSummary(trip, { calorieFloor: 2000 });
    assert.deepEqual(summary.lowCalorieDays, [1, 2]);
  });

  it('handles empty trip with no meals gracefully', () => {
    _resetIdCounter();
    const trip = createTrip({ name: 'Empty Trip', startDate: '2026-09-01', days: 2 });
    const summary = computeTripSummary(trip);

    assert.equal(summary.tripTotalCalories, 0);
    assert.equal(summary.tripTotalWeightG, 0);
    assert.equal(summary.overBudget, false);
    assert.deepEqual(summary.lowCalorieDays, [0, 1]);
  });

  it('handles a meal with no ingredients (empty meal)', () => {
    _resetIdCounter();
    const trip = createTrip({ name: 'Fasting Trip', startDate: '2026-10-01', days: 1 });
    const emptyMeal = createMeal({ name: 'Skip', type: 'breakfast', ingredients: [] });
    trip.dayPlans[0].meals.push(emptyMeal);

    const summary = computeTripSummary(trip);
    assert.equal(summary.perDay[0].emptyMeals, 1);
    assert.equal(summary.perDay[0].calories, 0);
  });
});
