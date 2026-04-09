'use strict';

const VALID_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Create a validated meal.
 * @param {{ name: string, type: string, ingredients?: Array }} opts
 */
function createMeal({ name, type, ingredients = [] }) {
  if (!name || typeof name !== 'string') throw new Error('Meal name is required');
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Meal type must be one of: ${VALID_TYPES.join(', ')}`);
  }
  return {
    name,
    type,
    ingredients: [...ingredients],
    get totalCalories() {
      return this.ingredients.reduce((sum, i) => sum + i.calories, 0);
    },
    get totalWeightG() {
      return this.ingredients.reduce((sum, i) => sum + i.weightG, 0);
    },
    get isEmpty() {
      return this.ingredients.length === 0;
    },
  };
}

module.exports = { createMeal, VALID_TYPES };
