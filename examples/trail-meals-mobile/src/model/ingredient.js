'use strict';

/**
 * Create a validated ingredient.
 * @param {{ name: string, caloriesPer100g: number, weightG: number }} opts
 * @returns {{ name: string, caloriesPer100g: number, weightG: number, calories: number }}
 */
function createIngredient({ name, caloriesPer100g, weightG }) {
  if (!name || typeof name !== 'string') throw new Error('Ingredient name is required');
  if (typeof caloriesPer100g !== 'number' || caloriesPer100g < 0) {
    throw new Error('caloriesPer100g must be a non-negative number');
  }
  if (typeof weightG !== 'number' || weightG < 0) {
    throw new Error('weightG must be a non-negative number');
  }
  const calories = Math.round((caloriesPer100g * weightG) / 100);
  return { name, caloriesPer100g, weightG, calories };
}

module.exports = { createIngredient };
