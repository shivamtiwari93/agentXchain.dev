import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { generateSeedPrompt } from '../lib/seed-prompt.js';
import { getRepoUrl } from '../lib/repo.js';

const API_BASE = 'https://api.cursor.com/v0';

function authHeaders(apiKey) {
  return {
    'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
    'Content-Type': 'application/json'
  };
}

// --- Public API ---

export async function launchCursorAgents(config, root, opts) {
  const apiKey = process.env.CURSOR_API_KEY;

  if (!apiKey) {
    printApiKeyHelp();
    return fallbackPromptOutput(config, opts);
  }

  const repoUrl = await getRepoUrl(root);
  if (!repoUrl) {
    console.log(chalk.red('  Could not detect GitHub repo URL.'));
    console.log(chalk.dim('  Make sure this project is a git repo with a GitHub remote.'));
    console.log(chalk.dim('  Or set source.repository manually in agentxchain.json.'));
    return [];
  }

  const model = config.cursor?.model || 'default';
  const ref = config.cursor?.ref || 'main';
  const agents = filterAgents(config, opts.agent);
  const launched = [];

  for (const [id, agent] of Object.entries(agents)) {
    const prompt = generateSeedPrompt(id, agent, config);

    try {
      const body = {
        prompt: { text: prompt },
        source: { repository: repoUrl, ref },
        target: { autoCreatePr: false }
      };
      if (model !== 'default') body.model = model;

      const res = await fetch(`${API_BASE}/agents`, {
        method: 'POST',
        headers: authHeaders(apiKey),
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.log(chalk.red(`  ✗ ${id}: ${res.status} ${errBody}`));
        continue;
      }

      const data = await res.json();
      launched.push({
        id,
        name: agent.name,
        cloudId: data.id,
        status: data.status || 'CREATING',
        url: data.target?.url || null
      });

      const urlStr = data.target?.url ? chalk.dim(` → ${data.target.url}`) : '';
      console.log(chalk.green(`  ✓ ${chalk.bold(id)} (${agent.name}) — ${data.id}${urlStr}`));
    } catch (err) {
      console.log(chalk.red(`  ✗ ${id}: ${err.message}`));
    }
  }

  if (launched.length > 0) {
    saveSession(root, launched, repoUrl);
  }

  return launched;
}

export async function sendFollowup(apiKey, cloudId, message) {
  const res = await fetch(`${API_BASE}/agents/${cloudId}/followup`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ prompt: { text: message } })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Followup failed (${res.status}): ${body}`);
  }
  return await res.json();
}

export async function getAgentStatus(apiKey, cloudId) {
  const res = await fetch(`${API_BASE}/agents/${cloudId}`, {
    method: 'GET',
    headers: authHeaders(apiKey)
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function getAgentConversation(apiKey, cloudId) {
  const res = await fetch(`${API_BASE}/agents/${cloudId}/conversation`, {
    method: 'GET',
    headers: authHeaders(apiKey)
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function stopAgent(apiKey, cloudId) {
  const res = await fetch(`${API_BASE}/agents/${cloudId}/stop`, {
    method: 'POST',
    headers: authHeaders(apiKey)
  });
  return res.ok;
}

export async function deleteAgent(apiKey, cloudId) {
  const res = await fetch(`${API_BASE}/agents/${cloudId}`, {
    method: 'DELETE',
    headers: authHeaders(apiKey)
  });
  return res.ok;
}

export function loadSession(root) {
  const sessionPath = join(root, '.agentxchain-session.json');
  if (!existsSync(sessionPath)) return null;
  return JSON.parse(readFileSync(sessionPath, 'utf8'));
}

// --- Internal ---

function saveSession(root, launched, repoUrl) {
  const session = {
    launched,
    started_at: new Date().toISOString(),
    ide: 'cursor',
    repo: repoUrl
  };
  const sessionPath = join(root, '.agentxchain-session.json');
  writeFileSync(sessionPath, JSON.stringify(session, null, 2) + '\n');
  console.log(chalk.dim(`  Session saved to .agentxchain-session.json`));
}

function filterAgents(config, specificId) {
  if (specificId) {
    if (!config.agents[specificId]) {
      console.log(chalk.red(`  Agent "${specificId}" not found in agentxchain.json`));
      process.exit(1);
    }
    return { [specificId]: config.agents[specificId] };
  }
  return config.agents;
}

function fallbackPromptOutput(config, opts) {
  const agents = filterAgents(config, opts.agent);
  console.log(chalk.bold('  No API key. Printing seed prompts for manual use:'));
  console.log('');
  for (const [id, agent] of Object.entries(agents)) {
    const prompt = generateSeedPrompt(id, agent, config);
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log(chalk.cyan(`  Agent: ${chalk.bold(id)} (${agent.name})`));
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    console.log('');
    console.log(prompt);
    console.log('');
  }
  return [];
}

function printApiKeyHelp() {
  console.log('');
  console.log(chalk.yellow('  CURSOR_API_KEY not found.'));
  console.log('');
  console.log(`  1. Go to ${chalk.cyan('cursor.com/settings')} → Cloud Agents`);
  console.log('  2. Create an API key');
  console.log(`  3. Add to .env: ${chalk.bold('CURSOR_API_KEY=your_key')}`);
  console.log(`  4. Run: ${chalk.bold('source .env && agentxchain start')}`);
  console.log('');
}
