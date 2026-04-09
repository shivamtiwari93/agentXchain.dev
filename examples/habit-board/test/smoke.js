'use strict';

const store = require('../src/store');

store.clear();
const h = store.createHabit('Smoke Test Habit', '#ff6600');
store.checkToday(h.id, '2026-04-07');
store.checkToday(h.id, '2026-04-08');
store.checkToday(h.id, '2026-04-09');
const habits = store.listHabits('2026-04-09');
const habit = habits[0];

console.log(`Habit: ${habit.name}`);
console.log(`Color: ${habit.color}`);
console.log(`Completions: ${habit.completions.length}`);
console.log(`Current streak: ${habit.streak.current}`);
console.log(`Longest streak: ${habit.streak.longest}`);

const ok = habit.streak.current === 3 && habit.streak.longest === 3;
console.log(ok ? 'PASS' : 'FAIL');
store.clear();
process.exit(ok ? 0 : 1);
