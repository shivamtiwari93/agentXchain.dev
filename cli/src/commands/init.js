import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CONFIG_FILE, LOCK_FILE, STATE_FILE } from '../lib/config.js';
import { generateVSCodeFiles } from '../lib/generate-vscode.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../templates');

const DEFAULT_AGENTS = {
  pm: {
    name: 'Product Manager',
    mandate: 'You think like a founder. Your only question is: would someone pay for this?\n\nEVERY TURN: 1) Prioritized list of what to build next (max 3 items). 2) Acceptance criteria for each. 3) One purchase blocker and its fix.\n\nCHALLENGE: If the dev over-engineered, call it out. If QA tested the wrong thing, redirect. If anyone is building for developers instead of users, shut it down.\n\nFIRST TURN: Write the MVP scope: who is the user, what is the core workflow, what are the max 5 features for v1.\n\nDON\'T: write code, design UI, or test. You decide what gets built and why.'
  },
  dev: {
    name: 'Fullstack Developer',
    mandate: 'You write production code, not prototypes. Every turn produces files that run.\n\nEVERY TURN: 1) Working code that executes. 2) Tests for what you built. 3) List of files changed. 4) Test suite output.\n\nCHALLENGE: If requirements are vague, refuse until they\'re specific. If QA found a bug, fix it properly.\n\nFIRST TURN: Set up the project: package.json, folder structure, database, health endpoint, one passing test.\n\nDON\'T: write pseudocode, skip tests, say "I would implement X" — implement it.'
  },
  qa: {
    name: 'QA Engineer',
    mandate: 'You are the quality gatekeeper. You test BOTH the code (functional) AND the user experience (UX). Nothing ships without your evidence.\n\nFUNCTIONAL QA every turn: 1) Run test suite, report pass/fail. 2) Test against acceptance criteria in .planning/REQUIREMENTS.md. 3) Test unhappy paths: empty input, wrong types, duplicates, expired sessions. 4) Write one test the dev didn\'t. 5) File bugs in .planning/qa/BUGS.md with repro steps.\n\nUX QA every turn (if UI exists): Walk through .planning/qa/UX-AUDIT.md checklist. Test first impressions, core flow, forms, responsive (375/768/1440px), accessibility (contrast, keyboard, alt text), error states.\n\nDOCS YOU MAINTAIN: .planning/qa/BUGS.md, UX-AUDIT.md, TEST-COVERAGE.md, ACCEPTANCE-MATRIX.md, REGRESSION-LOG.md.\n\nSHIP VERDICT every turn: "Can we ship?" YES / YES WITH CONDITIONS / NO + blockers.\n\nCHALLENGE: Verify independently. Test what others skip. Don\'t trust "it works."\n\nFIRST TURN: Set up test infra, create TEST-COVERAGE.md from requirements, initialize UX-AUDIT.md, create ACCEPTANCE-MATRIX.md.\n\nDON\'T: say "looks good." Don\'t skip UX. Don\'t file vague bugs.'
  },
  ux: {
    name: 'UX Reviewer & Context Manager',
    mandate: 'You are two things: a first-time user advocate and the team\'s memory manager.\n\nUX REVIEW EVERY TURN: 1) Use the product as a first-time user. 2) Flag confusing labels, broken flows, missing feedback, accessibility issues. 3) One specific UX improvement with before/after description.\n\nCONTEXT MANAGEMENT: If the log exceeds the word limit, compress older turns into a summary. Keep: scope decisions, open bugs, architecture choices, current phase. Cut: resolved debates, verbose status updates.\n\nCHALLENGE: If the dev built something unusable, flag it before QA wastes time testing it. If the PM\'s scope creates a confusing experience, say so.\n\nDON\'T: write backend code. Don\'t redesign from scratch. Suggest incremental UX fixes.'
  }
};

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadTemplates() {
  const templates = [];
  try {
    const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const raw = readFileSync(join(TEMPLATES_DIR, file), 'utf8');
      const tmpl = JSON.parse(raw);
      templates.push({ id: file.replace('.json', ''), ...tmpl });
    }
  } catch {}
  return templates;
}

export async function initCommand(opts) {
  let project, agents, folderName, rules;

  if (opts.yes) {
    project = 'My AgentXchain project';
    agents = DEFAULT_AGENTS;
    folderName = slugify(project);
    rules = { max_consecutive_claims: 2, require_message: true, compress_after_words: 5000 };
  } else {
    const templates = loadTemplates();

    // Template selection
    const templateChoices = [
      { name: `${chalk.cyan('Custom')} — define your own agents`, value: 'custom' },
      { name: `${chalk.cyan('Default')} — PM, Dev, QA, UX (4 agents)`, value: 'default' },
      ...templates.map(t => ({
        name: `${chalk.cyan(t.label)} — ${t.description} (${Object.keys(t.agents).length} agents)`,
        value: t.id
      }))
    ];

    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Choose a team template:',
      choices: templateChoices
    }]);

    if (template !== 'custom' && template !== 'default') {
      const tmpl = templates.find(t => t.id === template);
      agents = tmpl.agents;
      rules = tmpl.rules || {};
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: tmpl.project
      }]);
      project = projectName;
    } else if (template === 'default') {
      agents = DEFAULT_AGENTS;
      rules = { max_consecutive_claims: 2, require_message: true, compress_after_words: 5000 };
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: 'My AgentXchain project'
      }]);
      project = projectName;
    } else {
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: 'My AgentXchain project'
      }]);
      project = projectName;
      agents = {};
      rules = { max_consecutive_claims: 2, require_message: true, compress_after_words: 5000 };

      const { count } = await inquirer.prompt([{
        type: 'number',
        name: 'count',
        message: 'How many agents on this team?',
        default: 4,
        validate: v => (v >= 2 && v <= 20) ? true : 'Between 2 and 20 agents.'
      }]);

      console.log('');
      console.log(chalk.dim(`  Define ${count} agents. For each, provide a name and describe their role.`));
      console.log('');

      for (let i = 1; i <= count; i++) {
        console.log(chalk.cyan(`  Agent ${i} of ${count}`));

        const { name } = await inquirer.prompt([{
          type: 'input',
          name: 'name',
          message: `  Name (e.g. "Product Manager", "Backend Engineer"):`,
          validate: v => v.trim().length > 0 ? true : 'Name is required.'
        }]);

        const { mandate } = await inquirer.prompt([{
          type: 'editor',
          name: 'mandate',
          message: `  Role & responsibilities for ${name} (opens editor — describe what this agent does, what they produce each turn, how they challenge others):`,
          default: `You are the ${name} on this team.\n\nEVERY TURN YOU MUST PRODUCE:\n1. \n2. \n3. \n\nHOW YOU CHALLENGE OTHERS:\n- \n\nANTI-PATTERNS:\n- `,
          waitForUseInput: false
        }]);

        const id = slugify(name);
        const uniqueId = agents[id] ? `${id}-${i}` : id;

        if (uniqueId === 'human' || uniqueId === 'system') {
          agents[`${uniqueId}-agent`] = { name, mandate: mandate.trim() };
        } else {
          agents[uniqueId] = { name, mandate: mandate.trim() };
        }

        console.log(chalk.green(`  ✓ Added ${chalk.bold(name)} (${uniqueId})`));
        console.log('');
      }
    }

    folderName = slugify(project);
    const { folder } = await inquirer.prompt([{
      type: 'input',
      name: 'folder',
      message: 'Folder name:',
      default: folderName
    }]);
    folderName = folder;
  }

  const dir = resolve(process.cwd(), folderName);

  if (existsSync(dir) && existsSync(join(dir, CONFIG_FILE))) {
    if (!opts.yes) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: `${folderName}/ already has agentxchain.json. Overwrite?`,
        default: false
      }]);
      if (!overwrite) {
        console.log(chalk.yellow('  Aborted.'));
        return;
      }
    }
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const config = {
    version: 3,
    project,
    agents,
    log: 'log.md',
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
    rules: {
      max_consecutive_claims: rules.max_consecutive_claims || 2,
      require_message: rules.require_message !== false,
      compress_after_words: rules.compress_after_words || 5000,
      ttl_minutes: rules.ttl_minutes || 10,
      watch_interval_ms: rules.watch_interval_ms || 5000,
      ...(rules.verify_command ? { verify_command: rules.verify_command } : {})
    }
  };

  const lock = { holder: 'human', last_released_by: null, turn_number: 0, claimed_at: new Date().toISOString() };
  const state = { phase: 'discovery', blocked: false, blocked_on: null, project };

  // Core protocol files
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  writeFileSync(join(dir, 'state.md'), `# ${project} — Current State\n\n## Architecture\n\n(Agents update this each turn with current decisions.)\n\n## Active Work\n\n(What's in progress right now.)\n\n## Open Issues\n\n(Bugs, blockers, risks.)\n\n## Next Steps\n\n(What should happen next.)\n`);
  writeFileSync(join(dir, 'history.jsonl'), '');
  writeFileSync(join(dir, 'log.md'), `# ${project} — Agent Log\n\n## COMPRESSED CONTEXT\n\n(No compressed context yet.)\n\n## MESSAGE LOG\n\n(Agents append messages below this line.)\n`);
  writeFileSync(join(dir, 'TALK.md'), `# ${project} — Team Talk File\n\nCanonical human-readable handoff log for all agents.\n\n## How to write entries\n\nUse this exact structure:\n\n## Turn N — <agent_id> (<role>)\n- Status:\n- Decision:\n- Action:\n- Risks/Questions:\n- Next owner:\n\n---\n\n`);
  writeFileSync(join(dir, 'HUMAN_TASKS.md'), '# Human Tasks\n\n(Agents append tasks here when they need human action.)\n');
  const gitignorePath = join(dir, '.gitignore');
  const requiredIgnores = ['.env', '.agentxchain-trigger.json', '.agentxchain-prompts/', '.agentxchain-workspaces/'];
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, requiredIgnores.join('\n') + '\n');
  } else {
    const existingIgnore = readFileSync(gitignorePath, 'utf8');
    const missing = requiredIgnores.filter(entry => !existingIgnore.split(/\r?\n/).includes(entry));
    if (missing.length > 0) {
      const prefix = existingIgnore.endsWith('\n') ? '' : '\n';
      writeFileSync(gitignorePath, existingIgnore + prefix + missing.join('\n') + '\n');
    }
  }

  // .planning/ structure
  mkdirSync(join(dir, '.planning', 'research'), { recursive: true });
  mkdirSync(join(dir, '.planning', 'phases'), { recursive: true });
  mkdirSync(join(dir, '.planning', 'qa'), { recursive: true });

  writeFileSync(join(dir, '.planning', 'PROJECT.md'), `# ${project}\n\n## Vision\n\n(PM fills this on the first turn: who is the user, what problem are we solving, what does success look like.)\n\n## Constraints\n\n(Technical constraints, timeline, budget, dependencies.)\n\n## Stack\n\n(Tech stack decisions and rationale.)\n`);

  writeFileSync(join(dir, '.planning', 'REQUIREMENTS.md'), `# Requirements — ${project}\n\n## v1 (MVP)\n\n(PM fills this: numbered list of requirements. Each requirement has one-sentence acceptance criteria.)\n\n| # | Requirement | Acceptance criteria | Phase | Status |\n|---|-------------|-------------------|-------|--------|\n| 1 | | | | Pending |\n\n## v2 (Future)\n\n(Out of scope for MVP. Captured here so they don't creep in.)\n\n## Out of scope\n\n(Explicitly not building.)\n`);

  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), `# Roadmap — ${project}\n\n## Phases\n\n| Phase | Description | Status | Requirements |\n|-------|-------------|--------|-------------|\n| 1 | Discovery + setup | In progress | — |\n\n(PM updates this as phases are planned and completed.)\n`);
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), `# PM Signoff — ${project}\n\nApproved: NO\n\n## Discovery Checklist\n- [ ] Target user defined\n- [ ] Core pain point defined\n- [ ] Core workflow defined\n- [ ] MVP scope defined\n- [ ] Out-of-scope list defined\n- [ ] Success metric defined\n\n## Notes for team\n(PM and human add final kickoff notes here.)\n`);

  // QA structure
  writeFileSync(join(dir, '.planning', 'qa', 'TEST-COVERAGE.md'), `# Test Coverage — ${project}\n\n## Coverage Map\n\n| Feature / Area | Unit tests | Integration tests | E2E tests | Manual QA | UX audit | Status |\n|---------------|-----------|------------------|----------|----------|---------|--------|\n| (QA fills this as testing progresses) | | | | | | |\n\n## Coverage gaps\n\n(Areas with no tests or insufficient coverage.)\n`);

  writeFileSync(join(dir, '.planning', 'qa', 'REGRESSION-LOG.md'), `# Regression Log — ${project}\n\nBugs that were found and fixed. Each entry has a regression test to prevent recurrence.\n\n| Bug ID | Description | Found turn | Fixed turn | Regression test | Status |\n|--------|-------------|-----------|-----------|----------------|--------|\n| (QA adds entries as bugs are found and fixed) | | | | | |\n`);

  writeFileSync(join(dir, '.planning', 'qa', 'ACCEPTANCE-MATRIX.md'), `# Acceptance Matrix — ${project}\n\nMaps every requirement to its test status. This is the definitive "can we ship?" document.\n\n| Req # | Requirement | Acceptance criteria | Functional test | UX test | Last tested | Status |\n|-------|-------------|-------------------|-----------------|---------|-------------|--------|\n| (QA fills this from REQUIREMENTS.md) | | | | | | |\n`);

  writeFileSync(join(dir, '.planning', 'qa', 'UX-AUDIT.md'), `# UX Audit — ${project}\n\n## Audit checklist\n\nQA updates this every turn when the project has a user interface.\n\n### First impressions (< 5 seconds)\n- [ ] Is it immediately clear what this product does?\n- [ ] Can the user find the primary action without scrolling?\n- [ ] Does the page load in under 2 seconds?\n\n### Navigation & flow\n- [ ] Can the user complete the core workflow without getting lost?\n- [ ] Are there dead ends (pages with no next action)?\n- [ ] Does the back button work as expected?\n\n### Forms & input\n- [ ] Do all form fields have labels?\n- [ ] Are error messages specific (not just "invalid input")?\n- [ ] Is there feedback after submission (loading state, success message)?\n- [ ] Do forms work with autofill?\n\n### Visual consistency\n- [ ] Is spacing consistent across pages?\n- [ ] Are fonts consistent (max 2 font families)?\n- [ ] Are button styles consistent?\n- [ ] Are colors consistent with the design system?\n\n### Responsive\n- [ ] Does it work on mobile (375px)?\n- [ ] Does it work on tablet (768px)?\n- [ ] Does it work on desktop (1440px)?\n- [ ] Are touch targets at least 44x44px on mobile?\n\n### Accessibility\n- [ ] Do all images have alt text?\n- [ ] Is color contrast WCAG AA compliant (4.5:1 for text)?\n- [ ] Can the entire app be navigated by keyboard?\n- [ ] Do focus states exist for interactive elements?\n- [ ] Are headings in correct hierarchy (h1 > h2 > h3)?\n\n### Error states\n- [ ] What does the user see when the network is offline?\n- [ ] What does the user see when the server returns 500?\n- [ ] What does the user see on an empty state (no data yet)?\n\n## Issues found\n\n| # | Issue | Severity | Page/Component | Screenshot/Description | Status |\n|---|-------|----------|---------------|----------------------|--------|\n| (QA adds UX issues here) | | | | | |\n`);

  writeFileSync(join(dir, '.planning', 'qa', 'BUGS.md'), `# Bugs — ${project}\n\n## Open\n\n(QA adds bugs here with reproduction steps.)\n\n## Fixed\n\n(Bugs move here when dev confirms the fix and QA verifies it.)\n`);

  // VS Code agent files (.github/agents/, .github/hooks/, scripts/)
  const vsResult = generateVSCodeFiles(dir, config);

  const agentCount = Object.keys(agents).length;
  const kickoffId = pickPmKickoffId(agents);
  console.log('');
  console.log(chalk.green(`  ✓ Created ${chalk.bold(folderName)}/`));
  console.log('');
  console.log(`    ${chalk.dim('├──')} agentxchain.json  ${chalk.dim(`(${agentCount} agents)`)}`);
  console.log(`    ${chalk.dim('├──')} lock.json`);
  console.log(`    ${chalk.dim('├──')} state.json / state.md / history.jsonl`);
  console.log(`    ${chalk.dim('├──')} TALK.md / log.md / HUMAN_TASKS.md`);
  console.log(`    ${chalk.dim('├──')} .planning/`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('├──')} PROJECT.md / REQUIREMENTS.md / ROADMAP.md / PM_SIGNOFF.md`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('├──')} research/ / phases/`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('└──')} qa/  ${chalk.dim('TEST-COVERAGE / BUGS / UX-AUDIT / ACCEPTANCE-MATRIX')}`);
  console.log(`    ${chalk.dim('├──')} .github/agents/  ${chalk.dim(`(${agentCount} .agent.md files)`)}`);
  console.log(`    ${chalk.dim('├──')} .github/hooks/   ${chalk.dim('agentxchain.json')}`);
  console.log(`    ${chalk.dim('└──')} scripts/         ${chalk.dim('hook shell scripts')}`);
  console.log('');
  console.log(`  ${chalk.dim('Agents:')} ${Object.keys(agents).join(', ')}`);
  console.log('');
  console.log(`  ${chalk.cyan('Next:')}`);
  console.log(`    ${chalk.bold(`cd ${folderName}`)}`);
  console.log(`    ${chalk.bold(`agentxchain start --agent ${kickoffId}`)} ${chalk.dim('# PM-first kickoff: align scope with human')}`);
  console.log(`    ${chalk.bold('agentxchain start --remaining')} ${chalk.dim('# launch rest of team after PM planning')}`);
  console.log(`    ${chalk.bold('agentxchain supervise --autonudge')} ${chalk.dim('# watch + AppleScript nudge loop')}`);
  console.log(`    ${chalk.bold('agentxchain release')} ${chalk.dim('# release human lock when you are ready')}`);
  console.log('');
}

function pickPmKickoffId(agents) {
  if (agents.pm) return 'pm';
  for (const [id, def] of Object.entries(agents || {})) {
    const name = String(def?.name || '').toLowerCase();
    if (name.includes('product manager')) return id;
  }
  return Object.keys(agents || {})[0] || 'pm';
}
