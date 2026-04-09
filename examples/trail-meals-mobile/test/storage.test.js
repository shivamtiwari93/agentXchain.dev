const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createOfflineStore } = require('../src/storage/offline-store');

function createMockAsyncStorage() {
  const data = new Map();
  return {
    async getItem(key) { return data.get(key) ?? null; },
    async setItem(key, value) { data.set(key, value); },
    async removeItem(key) { data.delete(key); },
  };
}

describe('offline-store — AsyncStorage-backed persistence', () => {
  let store;
  let backend;

  beforeEach(() => {
    backend = createMockAsyncStorage();
    store = createOfflineStore(backend);
  });

  it('loads empty array from fresh store', async () => {
    const trips = await store.loadTrips();
    assert.deepEqual(trips, []);
  });

  it('saves and loads a trip with roundtrip fidelity', async () => {
    const trip = {
      id: 'trip_1',
      name: 'Appalachian',
      startDate: '2026-03-01',
      days: 3,
      weightBudgetG: 5000,
      dayPlans: [
        { dayIndex: 0, meals: [] },
        { dayIndex: 1, meals: [] },
        { dayIndex: 2, meals: [] },
      ],
    };

    await store.addTrip(trip);
    const loaded = await store.loadTrips();
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], trip);
  });

  it('deletes a trip by id', async () => {
    await store.addTrip({ id: 'a', name: 'A' });
    await store.addTrip({ id: 'b', name: 'B' });

    const deleted = await store.deleteTrip('a');
    assert.equal(deleted, true);

    const remaining = await store.loadTrips();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, 'b');
  });

  it('returns false when deleting non-existent trip', async () => {
    const deleted = await store.deleteTrip('nonexistent');
    assert.equal(deleted, false);
  });

  it('updates a trip in place', async () => {
    await store.addTrip({ id: 'x', name: 'Original', days: 2 });

    const updated = await store.updateTrip('x', (t) => ({ ...t, name: 'Renamed' }));
    assert.equal(updated.name, 'Renamed');

    const loaded = await store.loadTrips();
    assert.equal(loaded[0].name, 'Renamed');
  });

  it('returns null when updating non-existent trip', async () => {
    const result = await store.updateTrip('ghost', (t) => t);
    assert.equal(result, null);
  });

  it('clears all data', async () => {
    await store.addTrip({ id: '1', name: 'One' });
    await store.addTrip({ id: '2', name: 'Two' });
    await store.clear();

    const loaded = await store.loadTrips();
    assert.deepEqual(loaded, []);
  });
});
