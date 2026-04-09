const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createTrip, _resetIdCounter } = require('../src/model/trip');
const { createMeal, VALID_TYPES } = require('../src/model/meal');
const { createIngredient } = require('../src/model/ingredient');

describe('model — entity construction and validation', () => {
  it('rejects trip with zero days', () => {
    assert.throws(() => createTrip({ name: 'Bad', startDate: '2026-01-01', days: 0 }), /positive integer/);
  });

  it('rejects trip with negative days', () => {
    assert.throws(() => createTrip({ name: 'Bad', startDate: '2026-01-01', days: -3 }), /positive integer/);
  });

  it('rejects trip with fractional days', () => {
    assert.throws(() => createTrip({ name: 'Bad', startDate: '2026-01-01', days: 2.5 }), /positive integer/);
  });

  it('rejects trip with missing name', () => {
    assert.throws(() => createTrip({ name: '', startDate: '2026-01-01', days: 1 }), /name/);
  });

  it('creates a valid trip with correct day plan count', () => {
    _resetIdCounter();
    const trip = createTrip({ name: 'JMT', startDate: '2026-07-15', days: 5, weightBudgetG: 8000 });
    assert.equal(trip.days, 5);
    assert.equal(trip.dayPlans.length, 5);
    assert.equal(trip.weightBudgetG, 8000);
    assert.ok(trip.id.startsWith('trip_'));
  });

  it('rejects ingredient with negative weight', () => {
    assert.throws(() => createIngredient({ name: 'Bad', caloriesPer100g: 100, weightG: -10 }), /non-negative/);
  });

  it('rejects ingredient with negative calories', () => {
    assert.throws(() => createIngredient({ name: 'Bad', caloriesPer100g: -50, weightG: 100 }), /non-negative/);
  });

  it('computes ingredient calories correctly', () => {
    const ing = createIngredient({ name: 'Oats', caloriesPer100g: 389, weightG: 75 });
    assert.equal(ing.calories, Math.round((389 * 75) / 100));
  });

  it('rejects meal with invalid type', () => {
    assert.throws(() => createMeal({ name: 'Bad', type: 'brunch' }), /must be one of/);
  });

  it('accepts all valid meal types', () => {
    for (const type of VALID_TYPES) {
      const meal = createMeal({ name: `Test ${type}`, type });
      assert.equal(meal.type, type);
    }
  });

  it('meal computes totals from ingredients', () => {
    const a = createIngredient({ name: 'A', caloriesPer100g: 200, weightG: 50 });
    const b = createIngredient({ name: 'B', caloriesPer100g: 400, weightG: 100 });
    const meal = createMeal({ name: 'Mixed', type: 'lunch', ingredients: [a, b] });
    assert.equal(meal.totalCalories, a.calories + b.calories);
    assert.equal(meal.totalWeightG, 150);
    assert.equal(meal.isEmpty, false);
  });

  it('empty meal reports isEmpty', () => {
    const meal = createMeal({ name: 'Empty', type: 'snack' });
    assert.equal(meal.isEmpty, true);
    assert.equal(meal.totalCalories, 0);
  });
});
