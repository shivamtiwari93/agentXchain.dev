'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'habits.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(habits) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(habits, null, 2));
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function computeStreak(completions, anchorDate) {
  if (!completions || completions.length === 0) return { current: 0, longest: 0 };

  const sorted = [...completions].sort();
  const dates = sorted.map(d => new Date(d + 'T00:00:00Z'));

  // Longest streak
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = (dates[i] - dates[i - 1]) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      run++;
      if (run > longest) longest = run;
    } else if (diff > 1) {
      run = 1;
    }
    // diff === 0 means duplicate date — ignore
  }

  // Current streak: count consecutive days backwards from anchor (today or yesterday)
  const anchor = anchorDate || todayDateString();
  const anchorMs = new Date(anchor + 'T00:00:00Z').getTime();
  const dayMs = 1000 * 60 * 60 * 24;
  const dateSet = new Set(sorted);

  let current = 0;
  // Check if today is completed
  if (dateSet.has(anchor)) {
    current = 1;
    let check = new Date(anchorMs - dayMs);
    while (dateSet.has(check.toISOString().slice(0, 10))) {
      current++;
      check = new Date(check.getTime() - dayMs);
    }
  } else {
    // Check from yesterday
    const yesterday = new Date(anchorMs - dayMs).toISOString().slice(0, 10);
    if (dateSet.has(yesterday)) {
      current = 1;
      let check = new Date(anchorMs - 2 * dayMs);
      while (dateSet.has(check.toISOString().slice(0, 10))) {
        current++;
        check = new Date(check.getTime() - dayMs);
      }
    }
  }

  return { current, longest: Math.max(longest, current, completions.length === 0 ? 0 : 1) };
}

function createHabit(name, color) {
  const habits = load();
  const habit = {
    id: crypto.randomUUID(),
    name,
    color: color || '#6366f1',
    createdAt: new Date().toISOString(),
    completions: [],
  };
  habits.push(habit);
  save(habits);
  return habit;
}

function listHabits(anchorDate) {
  const habits = load();
  return habits.map(h => ({
    ...h,
    streak: computeStreak(h.completions, anchorDate),
  }));
}

function getHabit(id) {
  return load().find(h => h.id === id) || null;
}

function deleteHabit(id) {
  const habits = load();
  const idx = habits.findIndex(h => h.id === id);
  if (idx === -1) return false;
  habits.splice(idx, 1);
  save(habits);
  return true;
}

function checkToday(id, dateOverride) {
  const habits = load();
  const habit = habits.find(h => h.id === id);
  if (!habit) return null;
  const date = dateOverride || todayDateString();
  if (!habit.completions.includes(date)) {
    habit.completions.push(date);
    habit.completions.sort();
    save(habits);
  }
  return habit;
}

function uncheckToday(id, dateOverride) {
  const habits = load();
  const habit = habits.find(h => h.id === id);
  if (!habit) return null;
  const date = dateOverride || todayDateString();
  habit.completions = habit.completions.filter(d => d !== date);
  save(habits);
  return habit;
}

function getHistory(id, days) {
  const habit = getHabit(id);
  if (!habit) return null;
  const n = days || 30;
  const today = new Date();
  const history = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    history.push({ date: dateStr, completed: habit.completions.includes(dateStr) });
  }
  return history;
}

function clear() {
  save([]);
}

module.exports = {
  createHabit,
  listHabits,
  getHabit,
  deleteHabit,
  checkToday,
  uncheckToday,
  getHistory,
  computeStreak,
  clear,
  todayDateString,
};
