const statusEl = document.getElementById('status');
const teamForm = document.getElementById('team-form');
const memberForm = document.getElementById('member-form');
const checkinForm = document.getElementById('checkin-form');
const pruneForm = document.getElementById('prune-form');
const refreshButton = document.getElementById('refresh-report');
const teamSelects = [document.getElementById('member-team'), document.getElementById('checkin-team')];
const memberSelect = document.getElementById('checkin-member');
const teamMeta = document.getElementById('team-meta');
const membersList = document.getElementById('team-members');
const summaryOutput = document.getElementById('summary-output');
const reminderOutput = document.getElementById('reminder-output');
const pruneResult = document.getElementById('prune-result');
const reportDate = document.getElementById('report-date');
const checkinDate = document.getElementById('checkin-date');
const pruneDate = document.getElementById('prune-date');

const today = new Date().toISOString().slice(0, 10);
reportDate.value = today;
checkinDate.value = today;
pruneDate.value = today;

let teams = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

function fillTeamSelects() {
  for (const select of teamSelects) {
    select.innerHTML = '';
    for (const team of teams) {
      const option = document.createElement('option');
      option.value = team.id;
      option.textContent = `${team.name} (${team.channel})`;
      select.appendChild(option);
    }
  }
}

function fillMemberSelect(team) {
  memberSelect.innerHTML = '';
  if (!team) {
    return;
  }
  for (const member of team.members) {
    const option = document.createElement('option');
    option.value = member.id;
    option.textContent = member.name;
    memberSelect.appendChild(option);
  }
}

async function loadTeams() {
  teams = await request('/api/teams');
  fillTeamSelects();
  if (teams[0]) {
    await loadTeamDetail(teams[0].id);
  } else {
    teamMeta.textContent = 'No team selected.';
    membersList.innerHTML = '';
    memberSelect.innerHTML = '';
    summaryOutput.textContent = 'Create a team to see the summary.';
    reminderOutput.innerHTML = '';
  }
}

async function loadTeamDetail(teamId) {
  if (!teamId) {
    return;
  }
  const team = await request(`/api/teams/${teamId}?date=${reportDate.value}`);
  for (const select of teamSelects) {
    select.value = team.id;
  }
  fillMemberSelect(team);
  teamMeta.textContent = `${team.name} · ${team.channel} · ${team.timezone} · reminder ${String(team.reminderHour).padStart(2, '0')}:00`;
  membersList.innerHTML = '';
  for (const member of team.members) {
    const li = document.createElement('li');
    li.textContent = `${member.name} (${member.timezone})`;
    const pill = document.createElement('span');
    pill.className = `pill${member.status === 'blocked' ? ' blocked' : ''}`;
    pill.textContent = member.submitted ? member.status || 'submitted' : 'missing';
    li.appendChild(pill);
    membersList.appendChild(li);
  }
  await loadSummaryAndReminders(team.id);
}

async function loadSummaryAndReminders(teamId) {
  if (!teamId) {
    return;
  }
  const [summary, reminders] = await Promise.all([
    request(`/api/teams/${teamId}/summary?date=${reportDate.value}`),
    request(`/api/teams/${teamId}/reminders?date=${reportDate.value}`),
  ]);
  summaryOutput.textContent = summary.markdown;
  reminderOutput.innerHTML = '';
  if (reminders.reminders.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No reminder messages needed.';
    reminderOutput.appendChild(li);
  } else {
    for (const reminder of reminders.reminders) {
      const li = document.createElement('li');
      li.textContent = reminder.message;
      reminderOutput.appendChild(li);
    }
  }
}

teamForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request('/api/teams', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('team-name').value,
        channel: document.getElementById('team-channel').value,
        timezone: document.getElementById('team-timezone').value,
        reminderHour: Number(document.getElementById('team-hour').value),
        retentionDays: Number(document.getElementById('team-retention').value),
      }),
    });
    teamForm.reset();
    document.getElementById('team-timezone').value = 'America/Toronto';
    document.getElementById('team-hour').value = '10';
    document.getElementById('team-retention').value = '30';
    setStatus('Team created.');
    await loadTeams();
  } catch (error) {
    setStatus(error.message, true);
  }
});

memberForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await request(`/api/teams/${document.getElementById('member-team').value}/members`, {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('member-name').value,
        timezone: document.getElementById('member-timezone').value,
        slackHandle: document.getElementById('member-slack').value,
      }),
    });
    memberForm.reset();
    document.getElementById('member-timezone').value = 'America/Toronto';
    setStatus('Member added.');
    await loadTeamDetail(document.getElementById('member-team').value);
    await loadTeams();
  } catch (error) {
    setStatus(error.message, true);
  }
});

checkinForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const teamId = document.getElementById('checkin-team').value;
    await request(`/api/teams/${teamId}/checkins`, {
      method: 'POST',
      body: JSON.stringify({
        memberId: document.getElementById('checkin-member').value,
        date: checkinDate.value,
        yesterday: document.getElementById('checkin-yesterday').value,
        today: document.getElementById('checkin-today').value,
        blockers: document.getElementById('checkin-blockers').value,
        status: document.getElementById('checkin-status').value,
      }),
    });
    document.getElementById('checkin-yesterday').value = '';
    document.getElementById('checkin-today').value = '';
    document.getElementById('checkin-blockers').value = '';
    document.getElementById('checkin-status').value = 'green';
    reportDate.value = checkinDate.value;
    setStatus('Standup saved.');
    await loadTeamDetail(teamId);
    await loadTeams();
  } catch (error) {
    setStatus(error.message, true);
  }
});

pruneForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const result = await request('/api/ops/prune-retention', {
      method: 'POST',
      body: JSON.stringify({ beforeDate: pruneDate.value }),
    });
    pruneResult.textContent = `Removed ${result.removed} standups. ${result.remaining} remain.`;
    setStatus('Retention prune completed.');
    const selectedTeamId = document.getElementById('checkin-team').value;
    if (selectedTeamId) {
      await loadTeamDetail(selectedTeamId);
      await loadTeams();
    }
  } catch (error) {
    setStatus(error.message, true);
  }
});

refreshButton.addEventListener('click', async () => {
  try {
    const teamId = document.getElementById('checkin-team').value || document.getElementById('member-team').value;
    if (!teamId) {
      setStatus('Create a team first.', true);
      return;
    }
    await loadTeamDetail(teamId);
    setStatus('Views refreshed.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

for (const select of teamSelects) {
  select.addEventListener('change', async event => {
    try {
      await loadTeamDetail(event.target.value);
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

loadTeams().catch(error => {
  setStatus(error.message, true);
});
