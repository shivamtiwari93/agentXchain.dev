'use strict';

let _idCounter = 0;

/**
 * Create a validated trip.
 * @param {{ name: string, startDate: string, days: number, weightBudgetG?: number }} opts
 */
function createTrip({ name, startDate, days, weightBudgetG = 0 }) {
  if (!name || typeof name !== 'string') throw new Error('Trip name is required');
  if (!startDate || typeof startDate !== 'string') throw new Error('Trip startDate is required');
  if (typeof days !== 'number' || days < 1 || !Number.isInteger(days)) {
    throw new Error('Trip days must be a positive integer');
  }
  if (typeof weightBudgetG !== 'number' || weightBudgetG < 0) {
    throw new Error('weightBudgetG must be a non-negative number');
  }

  const dayPlans = [];
  for (let i = 0; i < days; i++) {
    dayPlans.push({ dayIndex: i, meals: [] });
  }

  return {
    id: `trip_${++_idCounter}_${Date.now()}`,
    name,
    startDate,
    days,
    weightBudgetG,
    dayPlans,
  };
}

/** Reset the ID counter (for testing). */
function _resetIdCounter() {
  _idCounter = 0;
}

module.exports = { createTrip, _resetIdCounter };
