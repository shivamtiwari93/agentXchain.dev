'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');

describe('store', () => {
  beforeEach(() => store.clear());
  after(() => store.clear());

  describe('createHabit / listHabits / deleteHabit', () => {
    it('creates a habit with defaults', () => {
      const h = store.createHabit('Exercise');
      assert.ok(h.id);
      assert.equal(h.name, 'Exercise');
      assert.equal(h.color, '#6366f1');
      assert.deepEqual(h.completions, []);
    });

    it('lists habits with streak data', () => {
      store.createHabit('Read');
      store.createHabit('Meditate');
      const list = store.listHabits();
      assert.equal(list.length, 2);
      assert.ok(list[0].streak);
      assert.equal(typeof list[0].streak.current, 'number');
    });

    it('deletes a habit', () => {
      const h = store.createHabit('Sleep');
      assert.equal(store.deleteHabit(h.id), true);
      assert.equal(store.listHabits().length, 0);
    });

    it('returns false for unknown id', () => {
      assert.equal(store.deleteHabit('nonexistent'), false);
    });
  });

  describe('checkToday / uncheckToday', () => {
    it('marks a date as complete', () => {
      const h = store.createHabit('Code');
      const updated = store.checkToday(h.id, '2026-04-09');
      assert.ok(updated.completions.includes('2026-04-09'));
    });

    it('is idempotent for duplicate checks', () => {
      const h = store.createHabit('Code');
      store.checkToday(h.id, '2026-04-09');
      store.checkToday(h.id, '2026-04-09');
      const habit = store.getHabit(h.id);
      const count = habit.completions.filter(d => d === '2026-04-09').length;
      assert.equal(count, 1);
    });

    it('unchecks a date', () => {
      const h = store.createHabit('Code');
      store.checkToday(h.id, '2026-04-09');
      store.uncheckToday(h.id, '2026-04-09');
      const habit = store.getHabit(h.id);
      assert.ok(!habit.completions.includes('2026-04-09'));
    });

    it('returns null for unknown id', () => {
      assert.equal(store.checkToday('nonexistent'), null);
      assert.equal(store.uncheckToday('nonexistent'), null);
    });
  });

  describe('computeStreak', () => {
    it('returns 0/0 for empty completions', () => {
      const s = store.computeStreak([], '2026-04-09');
      assert.deepEqual(s, { current: 0, longest: 0 });
    });

    it('counts consecutive days ending today', () => {
      const completions = ['2026-04-07', '2026-04-08', '2026-04-09'];
      const s = store.computeStreak(completions, '2026-04-09');
      assert.equal(s.current, 3);
      assert.equal(s.longest, 3);
    });

    it('counts from yesterday if today not checked', () => {
      const completions = ['2026-04-07', '2026-04-08'];
      const s = store.computeStreak(completions, '2026-04-09');
      assert.equal(s.current, 2);
    });

    it('resets on gap', () => {
      const completions = ['2026-04-05', '2026-04-06', '2026-04-09'];
      const s = store.computeStreak(completions, '2026-04-09');
      assert.equal(s.current, 1);
      assert.equal(s.longest, 2);
    });

    it('handles single day', () => {
      const s = store.computeStreak(['2026-04-09'], '2026-04-09');
      assert.equal(s.current, 1);
      assert.equal(s.longest, 1);
    });

    it('returns 0 current when last check was 2+ days ago', () => {
      const completions = ['2026-04-01', '2026-04-02'];
      const s = store.computeStreak(completions, '2026-04-09');
      assert.equal(s.current, 0);
    });
  });

  describe('getHistory', () => {
    it('returns 30-day history', () => {
      const h = store.createHabit('Walk');
      store.checkToday(h.id, '2026-04-09');
      const history = store.getHistory(h.id, 30);
      assert.equal(history.length, 30);
      assert.equal(history[0].date, new Date().toISOString().slice(0, 10));
    });

    it('returns null for unknown id', () => {
      assert.equal(store.getHistory('nonexistent'), null);
    });
  });
});
