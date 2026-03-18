import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { generateSeedPrompt } from '../lib/seed-prompt.js';
import { getRepoUrl, getCurrentBranch } from '../lib/repo.js';
import { getCursorApiKey, printCursorApiKeyRequired } from '../lib/cursor-api-key.js';

const API_BASE = 'https://api.cursor.com/v0';

function authHeaders(apiKey) {
  return {
    'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
    'Content-Type': 'application/json'
  };
}

// --- Public API ---

export async function launchCursorAgents(config, root, opts) {
  const apiKey = getCursorApiKey(root);

  if (!apiKey) {
    printCursorApiKeyRequired('`agentxchain start --ide cursor`');
    return [];
  }

  const repoUrl = await getRepoUrl(root);
  if (!repoUrl) {
    console.log(chalk.red('  Could not detect GitHub repo URL.'));
    console.log(chalk.dim('  Make sure this project is a git repo with a GitHub remote.'));
    console.log(chalk.dim('  Or set source.repository manually in agentxchain.json.'));
    return [];
  }

  const model = config.cursor?.model || 'default';
  const ref = config.cursor?.ref || getCurrentBranch(root) || 'main';
  console.log(chalk.dim(`  Cursor source: ${repoUrl} @ ${ref}`));
  const agents = filterAgents(config, opts.agent);
  const launched = [];
  let branchErrorCount = 0;

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
        if (errBody.includes('Failed to verify existence of branch')) {
          branchErrorCount += 1;
        }
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
    saveSession(root, launched, repoUrl, ref);
  }

  if (launched.length === 0 && branchErrorCount > 0) {
    console.log('');
    console.log(chalk.yellow('  Launch failed because the branch ref is invalid for this repository.'));
    console.log(chalk.dim('  Fix by setting the branch explicitly in agentxchain.json:'));
    console.log(chalk.bold('  "cursor": { "ref": "your-default-branch" }'));
    console.log(chalk.dim('  Or switch to the target branch locally, then re-run start.'));
    console.log(chalk.dim('  If the branch exists on GitHub, verify your Cursor account has GitHub access'));
    console.log(chalk.dim('  to this repository (Cursor Settings -> GitHub integration).'));
    console.log('');
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

function saveSession(root, launched, repoUrl, ref) {
  const session = {
    launched,
    started_at: new Date().toISOString(),
    ide: 'cursor',
    repo: repoUrl,
    ref
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

// No prompt fallback here by design.
// Cursor mode is strict: an API key is required.
