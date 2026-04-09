(function () {
  'use strict';

  const list = document.getElementById('habits-list');
  const form = document.getElementById('add-form');
  const nameInput = document.getElementById('habit-name');
  const colorInput = document.getElementById('habit-color');

  async function api(path, opts) {
    const res = await fetch('/api' + path, opts);
    return res.json();
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function renderHabits(habits) {
    if (!habits.length) {
      list.innerHTML = '<p class="empty-state">No habits yet. Add one above!</p>';
      return;
    }

    const today = todayStr();
    list.innerHTML = habits.map(function (h) {
      var checked = h.completions && h.completions.includes(today);
      return '<div class="habit-card" data-id="' + h.id + '">' +
        '<div class="color-bar" style="background:' + esc(h.color) + '"></div>' +
        '<div class="name">' + esc(h.name) + '</div>' +
        '<div class="streak"><strong>' + (h.streak ? h.streak.current : 0) + '</strong> day streak</div>' +
        '<div class="actions">' +
        '<button class="check-btn' + (checked ? ' checked' : '') + '" data-action="check">' +
        (checked ? 'Done today' : 'Mark done') + '</button>' +
        '<button class="delete-btn" data-action="delete">Delete</button>' +
        '</div></div>';
    }).join('');
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  async function refresh() {
    var habits = await api('/habits');
    renderHabits(habits);
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = nameInput.value.trim();
    if (!name) return;
    await api('/habits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, color: colorInput.value }),
    });
    nameInput.value = '';
    refresh();
  });

  list.addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var card = btn.closest('.habit-card');
    var id = card.dataset.id;
    var action = btn.dataset.action;

    if (action === 'check') {
      var isChecked = btn.classList.contains('checked');
      await api('/habits/' + id + '/check', { method: isChecked ? 'DELETE' : 'POST' });
      refresh();
    } else if (action === 'delete') {
      if (confirm('Delete this habit?')) {
        await api('/habits/' + id, { method: 'DELETE' });
        refresh();
      }
    }
  });

  refresh();
})();
