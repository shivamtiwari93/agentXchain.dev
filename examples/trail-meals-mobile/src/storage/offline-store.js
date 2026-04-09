'use strict';

const STORAGE_KEY = '@trail_meals_trips';

/**
 * Offline-first trip storage backed by AsyncStorage.
 * The `backend` parameter accepts any object with getItem/setItem/removeItem
 * (AsyncStorage in RN, or a mock in tests).
 */
function createOfflineStore(backend) {
  if (!backend || typeof backend.getItem !== 'function') {
    throw new Error('backend must implement getItem/setItem');
  }

  return {
    async loadTrips() {
      const raw = await backend.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    },

    async saveTrips(trips) {
      await backend.setItem(STORAGE_KEY, JSON.stringify(trips));
    },

    async addTrip(trip) {
      const trips = await this.loadTrips();
      trips.push(trip);
      await this.saveTrips(trips);
      return trip;
    },

    async deleteTrip(tripId) {
      const trips = await this.loadTrips();
      const filtered = trips.filter((t) => t.id !== tripId);
      await this.saveTrips(filtered);
      return filtered.length < trips.length;
    },

    async updateTrip(tripId, updater) {
      const trips = await this.loadTrips();
      const idx = trips.findIndex((t) => t.id === tripId);
      if (idx === -1) return null;
      trips[idx] = updater(trips[idx]);
      await this.saveTrips(trips);
      return trips[idx];
    },

    async clear() {
      await backend.removeItem(STORAGE_KEY);
    },
  };
}

module.exports = { createOfflineStore, STORAGE_KEY };
