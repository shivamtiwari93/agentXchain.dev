import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { basename, join, relative, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CONFIG_FILE, LOCK_FILE, STATE_FILE } from '../lib/config.js';
import { generateVSCodeFiles } from '../lib/generate-vscode.js';
import { loadAllGovernedTemplates, loadGovernedTemplate, VALID_GOVERNED_TEMPLATE_IDS, buildSystemSpecContent } from '../lib/governed-templates.js';
import { normalizeWorkflowKit, VALID_PROMPT_TRANSPORTS } from '../lib/normalized-config.js';

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

function interpolateTemplateContent(contentTemplate, projectName) {
  return contentTemplate.replaceAll('{{project_name}}', projectName);
}

function appendPromptOverride(basePrompt, override) {
  if (!override || !override.trim()) return basePrompt;
  return `${basePrompt}\n\n---\n\n## Project-Type-Specific Guidance\n\n${override.trim()}\n`;
}

function appendAcceptanceHints(baseMatrix, acceptanceHints) {
  if (!Array.isArray(acceptanceHints) || acceptanceHints.length === 0) {
    return baseMatrix;
  }

  const hintLines = acceptanceHints.map((hint) => `- [ ] ${hint}`).join('\n');
  return `${baseMatrix}\n\n## Template Guidance\n${hintLines}\n`;
}

function findGitRoot(startDir) {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

// ── Governed init ───────────────────────────────────────────────────────────

const GOVERNED_ROLES = {
  pm: {
    title: 'Product Manager',
    mandate: 'Protect user value, scope clarity, and acceptance criteria.',
    write_authority: 'review_only',
    runtime: 'manual-pm'
  },
  dev: {
    title: 'Developer',
    mandate: 'Implement approved work safely and verify behavior.',
    write_authority: 'authoritative',
    runtime: 'local-dev'
  },
  qa: {
    title: 'QA',
    mandate: 'Challenge correctness, acceptance coverage, and ship readiness.',
    write_authority: 'review_only',
    runtime: 'api-qa'
  },
  eng_director: {
    title: 'Engineering Director',
    mandate: 'Resolve tactical deadlocks and enforce technical coherence.',
    write_authority: 'review_only',
    runtime: 'manual-director'
  }
};

const DEFAULT_GOVERNED_LOCAL_DEV_RUNTIME = Object.freeze({
  type: 'local_cli',
  command: ['claude', '--print', '--dangerously-skip-permissions'],
  cwd: '.',
  prompt_transport: 'stdin',
});

const GOVERNED_RUNTIMES = {
  'manual-pm': { type: 'manual' },
  'manual-dev': { type: 'manual' },
  'local-dev': DEFAULT_GOVERNED_LOCAL_DEV_RUNTIME,
  'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
  'manual-qa': { type: 'manual' },
  'manual-director': { type: 'manual' }
};

const GOVERNED_ROUTING = {
  planning: {
    entry_role: 'pm',
    allowed_next_roles: ['pm', 'eng_director', 'human'],
    exit_gate: 'planning_signoff'
  },
  implementation: {
    entry_role: 'dev',
    allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'],
    exit_gate: 'implementation_complete'
  },
  qa: {
    entry_role: 'qa',
    allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'],
    exit_gate: 'qa_ship_verdict'
  }
};

const GOVERNED_GATES = {
  planning_signoff: {
    requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
    requires_human_approval: true
  },
  implementation_complete: {
    requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
    requires_verification_pass: true
  },
  qa_ship_verdict: {
    requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
    requires_human_approval: true
  }
};

function buildGovernedPrompt(roleId, role, scaffoldContext = {}) {
  const rolePrompts = {
    pm: buildPmPrompt,
    dev: buildDevPrompt,
    qa: buildQaPrompt,
    eng_director: buildEngDirectorPrompt,
  };

  const builder = rolePrompts[roleId];
  if (builder) return builder(role);

  // Fallback for custom roles
  return buildGenericPrompt(roleId, role, scaffoldContext);
}

function buildPmPrompt(role) {
  return `# Product Manager — Role Prompt

You are the Product Manager. Your mandate: **${role.mandate}**

## What You Do Each Turn

1. **Read the previous turn** (from CONTEXT.md). Understand what was done and what decisions were made.
2. **Challenge it.** Even if the work looks correct, identify at least one risk, scope gap, or assumption worth questioning. Rubber-stamping violates the protocol.
3. **Create or refine planning artifacts:**
   - \`.planning/ROADMAP.md\` — what will be built, in what order, with acceptance criteria
   - \`.planning/SYSTEM_SPEC.md\` — the baseline subsystem contract implementation will follow
   - \`.planning/PM_SIGNOFF.md\` — your formal sign-off when planning is complete
   - \`.planning/acceptance-matrix.md\` — the acceptance criteria checklist for QA
4. **Propose the next role.** Typically \`dev\` after planning is complete, or \`eng_director\` if there's a technical deadlock.

## Planning Phase Exit

To exit the planning phase, you must:
- Ensure \`.planning/PM_SIGNOFF.md\` exists with your explicit sign-off
- Ensure \`.planning/ROADMAP.md\` exists with clear acceptance criteria
- Ensure \`.planning/SYSTEM_SPEC.md\` defines \`## Purpose\`, \`## Interface\`, and \`## Acceptance Tests\`
- Set \`phase_transition_request: "implementation"\` in your turn result

The orchestrator will evaluate the gate and may require human approval.

## Scope Authority

You define **what** gets built and **why**. You do not define **how** — that's the developer's domain. If you disagree with a technical approach, raise an objection with rationale, but do not override implementation decisions.

## Acceptance Criteria Quality

Every roadmap item must have acceptance criteria that are:
- **Observable** — can be verified by running code or inspecting output
- **Specific** — not "works well" but "returns 200 for GET /api/users with valid token"
- **Complete** — covers happy path, error cases, and edge cases worth testing
`;
}

function buildDevPrompt(role) {
  return `# Developer — Role Prompt

You are the Developer. Your mandate: **${role.mandate}**

## What You Do Each Turn

1. **Read the previous turn and ROADMAP.md.** Understand what you're building and what the acceptance criteria are.
2. **Challenge the previous turn.** If the PM's acceptance criteria are ambiguous, flag it. If QA's objections are unfounded, explain why. Never skip this.
3. **Implement the work.**
   - Write clean, correct code that meets the acceptance criteria
   - Run tests and include the results as verification evidence
   - Accurately list every file you changed in \`files_changed\`
4. **Verify your work.** Run the test suite, linter, or build command. Record the commands and exit codes in \`verification.machine_evidence\`.

## Implementation Rules

- Only implement what the roadmap and acceptance criteria require. Do not add unrequested features.
- If acceptance criteria are unclear, set \`status: "needs_human"\` and explain what needs clarification in \`needs_human_reason\`.
- If you encounter a technical blocker, set \`status: "blocked"\` and describe it.

## Verification Is Mandatory

You must run verification commands and report them honestly:
- \`verification.status\` must be \`"pass"\` only if all commands exited with code 0
- \`verification.machine_evidence\` must list every command you ran with its actual exit code
- Expected-failure checks must be wrapped in a test harness or shell assertion that exits 0 only when the failure occurs as expected
- Do not mix raw non-zero negative-case commands into a passing turn; put them behind \`npm test\`, \`node --test\`, or an equivalent zero-exit verifier
- Do NOT claim \`"pass"\` if you did not run the tests

## Phase Transition

When your implementation is complete and verified:
- If the implementation phase gate requires verification pass: ensure tests pass
- Set \`phase_transition_request: "qa"\` to advance to QA
- The gate may auto-advance or require human approval depending on config

## Artifact Type

Your artifact type is \`workspace\` (direct file modifications). The orchestrator will diff your changes against the pre-turn snapshot to verify \`files_changed\` accuracy.
`;
}

function buildQaPrompt(role) {
  return `# QA — Role Prompt

You are QA. Your mandate: **${role.mandate}**

## What You Do Each Turn

1. **Read the previous turn, the ROADMAP, and the acceptance matrix.** Understand what was built and what the acceptance criteria are.
2. **Challenge the implementation.** You MUST raise at least one objection — this is a protocol requirement for review_only roles. If the code is perfect, challenge the test coverage, the edge cases, or the documentation.
3. **Evaluate against acceptance criteria.** Go through each criterion and determine pass/fail.
4. **Produce a review outcome:**
   - \`.planning/acceptance-matrix.md\` — updated with pass/fail verdicts per criterion
   - \`.planning/ship-verdict.md\` — your overall ship/no-ship recommendation
   - \`.planning/RELEASE_NOTES.md\` — user-facing release notes with impact and verification summary

## You Cannot Modify Code

You have \`review_only\` write authority. You may NOT modify product files. You may only create/modify files under \`.planning/\` and \`.agentxchain/reviews/\`. Your artifact type must be \`review\`.

## Runtime Truth

- If your runtime is **manual** or another writable review path, you may update the QA-owned planning files directly.
- If your runtime is **api_proxy**, you cannot write repo files directly. Do **not** claim you created \`.planning/*\` files unless a writable/manual step actually changed them.
- For \`api_proxy\` review turns, the orchestrator will materialize a review artifact under \`.agentxchain/reviews/<turn_id>-<role>-review.md\` from your structured result.

## Objection Requirement

You MUST raise at least one objection in your turn result. An empty \`objections\` array is a protocol violation and will be rejected by the validator. If the work is genuinely excellent, raise a low-severity observation about test coverage, documentation, or future risk.

Each objection must have:
- \`id\`: pattern \`OBJ-NNN\`
- \`severity\`: \`low\`, \`medium\`, \`high\`, or \`blocking\`
- \`against_turn_id\`: the turn you're challenging
- \`statement\`: clear description of the issue
- \`status\`: \`"raised"\`

## Blocking vs. Non-Blocking

- \`blocking\` severity means the work cannot ship. Use sparingly and only for real defects.
- \`high\` severity means significant risk but potentially shippable with mitigation.
- \`medium\` and \`low\` are observations that improve quality but don't block.

## Ship Verdict & Run Completion

When you are satisfied the work meets acceptance criteria:
1. If you are on a writable/manual review path, create/update the QA-owned planning artifacts with your verdict
2. If you are on \`api_proxy\`, put the verdict and rationale in the structured turn result and review artifact instead of claiming repo writes you did not make
4. Set \`run_completion_request: true\` in your turn result

**Only set \`run_completion_request: true\` when:**
- All blocking objections from prior turns are resolved
- The acceptance matrix shows all critical criteria passing
- \`.planning/ship-verdict.md\` exists with an affirmative verdict
- \`.planning/RELEASE_NOTES.md\` exists with real \`## User Impact\` and \`## Verification Summary\` content

**Do NOT set \`run_completion_request: true\` if:**
- You have unresolved blocking objections
- Critical acceptance criteria are failing
- You need the developer to fix issues first (propose \`dev\` as next role instead)

## Routing After QA

- If issues found → propose \`dev\` as next role (they fix, then you re-review)
- If ship-ready → set \`run_completion_request: true\`
- If deadlocked → propose \`eng_director\` or \`human\`
`;
}

function buildEngDirectorPrompt(role) {
  return `# Engineering Director — Role Prompt

You are the Engineering Director. Your mandate: **${role.mandate}**

## When You Are Called

You are invoked when the normal PM → Dev → QA loop is stuck:
- Repeated QA/Dev cycles without convergence
- Technical disagreement between roles
- Scope dispute that the PM cannot resolve
- Budget or timeline pressure requiring trade-offs

## What You Do Each Turn

1. **Read the full context.** Review the escalation reason, unresolved objections, and the decision history.
2. **Make a binding decision.** Your role is to break deadlocks, not to add more opinions. State your decision clearly with rationale.
3. **Challenge what led to the deadlock.** Identify the root cause — unclear acceptance criteria? Wrong technical approach? Scope creep?
4. **Route back to the appropriate role.** After your decision, the normal loop should resume.

## Decision Authority

- You may override QA objections if they are unreasonable or out of scope
- You may override PM scope decisions if they create technical impossibility
- You may NOT override human decisions — escalate to \`human\` if needed
- Every override must be recorded as a decision with clear rationale

## You Cannot Modify Code

You have \`review_only\` write authority. Like QA, you must raise at least one objection (protocol requirement). Your artifact type is \`review\`.

## Objection Requirement

You MUST raise at least one objection. Typically this will be about the process failure that led to your involvement — why did the loop deadlock? What should be done differently next time?

## Escalation to Human

If you cannot resolve the deadlock:
- Set \`status: "needs_human"\`
- Explain the situation in \`needs_human_reason\`
- The orchestrator will pause the run for human input
`;
}

function summarizeRoleWorkflow(roleId, scaffoldContext = {}) {
  const routing = scaffoldContext.routing || {};
  const gates = scaffoldContext.gates || {};
  const workflowKitConfig = scaffoldContext.workflowKitConfig || {};
  const ownedPhases = Object.entries(routing)
    .filter(([, route]) => route?.entry_role === roleId)
    .map(([phaseName]) => phaseName);
  const gateLines = [];
  const artifactLines = [];
  const ownershipLines = [];

  for (const phaseName of ownedPhases) {
    const exitGate = routing[phaseName]?.exit_gate;
    if (exitGate) {
      gateLines.push(`- ${phaseName}: ${exitGate}`);
    }

    const phaseArtifacts = Array.isArray(workflowKitConfig?.phases?.[phaseName]?.artifacts)
      ? workflowKitConfig.phases[phaseName].artifacts.filter((artifact) => artifact?.path)
      : [];
    const workflowArtifacts = phaseArtifacts
      .map((artifact) => artifact.path)
      .filter(Boolean);
    const gateArtifacts = Array.isArray(gates?.[exitGate]?.requires_files)
      ? gates[exitGate].requires_files.filter(Boolean)
      : [];
    const ownedArtifacts = [...new Set([...workflowArtifacts, ...gateArtifacts])];
    if (ownedArtifacts.length > 0) {
      artifactLines.push(`- ${phaseName}: ${ownedArtifacts.join(', ')}`);
    }

    const enforcedArtifacts = phaseArtifacts
      .filter((artifact) => artifact.owned_by === roleId)
      .map((artifact) => artifact.path);
    if (enforcedArtifacts.length > 0) {
      const verb = enforcedArtifacts.length === 1 ? 'requires' : 'require';
      ownershipLines.push(
        `- ${phaseName}: ${enforcedArtifacts.join(', ')} ${verb} an accepted turn from you before the gate can pass`,
      );
    }
  }

  return { ownedPhases, gateLines, artifactLines, ownershipLines };
}

function buildGenericPrompt(roleId, role, scaffoldContext = {}) {
  const workflowSummary = summarizeRoleWorkflow(roleId, scaffoldContext);
  const primaryPhasesSection = workflowSummary.ownedPhases.length > 0
    ? `\n## Primary Phases\n\n- ${workflowSummary.ownedPhases.join(', ')}\n`
    : '';
  const phaseGatesSection = workflowSummary.gateLines.length > 0
    ? `\n## Phase Gates\n\n${workflowSummary.gateLines.join('\n')}\n`
    : '';
  const workflowArtifactsSection = workflowSummary.artifactLines.length > 0
    ? `\n## Workflow Artifacts You Own\n\n${workflowSummary.artifactLines.join('\n')}\n`
    : '';
  const ownershipSection = workflowSummary.ownershipLines.length > 0
    ? `\n## Ownership Enforcement\n\n${workflowSummary.ownershipLines.join('\n')}\n`
    : '';

  return `# ${role.title} — Role Prompt

You are the **${role.title}** on this project.

**Mandate:** ${role.mandate}
**Write authority:** ${role.write_authority}

## What You Do Each Turn

1. Read the previous turn and challenge it explicitly.
2. Do your work according to your mandate.
3. Write your structured turn result to the turn-scoped staging path printed by the orchestrator (\`.agentxchain/staging/<turn_id>/turn-result.json\`).

## File Access

${role.write_authority === 'authoritative'
    ? 'You may modify product files directly.'
    : role.write_authority === 'proposed'
      ? 'You may propose changes via patches.'
      : 'You may NOT modify product files. Only create review artifacts under `.planning/` and `.agentxchain/reviews/`.'}${primaryPhasesSection}${phaseGatesSection}${workflowArtifactsSection}${ownershipSection}
`;
}

function commandHasPromptPlaceholder(parts = []) {
  return parts.some((part) => typeof part === 'string' && part.includes('{prompt}'));
}

function resolveGovernedLocalDevRuntime(opts = {}) {
  const customCommand = Array.isArray(opts.devCommand)
    ? opts.devCommand.map((part) => String(part).trim()).filter(Boolean)
    : null;
  const explicitTransport = typeof opts.devPromptTransport === 'string' && opts.devPromptTransport.trim()
    ? opts.devPromptTransport.trim()
    : null;

  if (explicitTransport && !VALID_PROMPT_TRANSPORTS.includes(explicitTransport)) {
    throw new Error(`Unknown --dev-prompt-transport "${explicitTransport}". Valid values: ${VALID_PROMPT_TRANSPORTS.join(', ')}`);
  }

  if (!customCommand?.length) {
    const command = [...DEFAULT_GOVERNED_LOCAL_DEV_RUNTIME.command];
    if (explicitTransport === 'argv') {
      throw new Error('Default local dev command does not include {prompt}. Use --dev-command ... {prompt} for argv mode.');
    }
    return {
      runtime: {
        ...DEFAULT_GOVERNED_LOCAL_DEV_RUNTIME,
        command,
        prompt_transport: explicitTransport || DEFAULT_GOVERNED_LOCAL_DEV_RUNTIME.prompt_transport,
      },
    };
  }

  const hasPlaceholder = commandHasPromptPlaceholder(customCommand);

  if (!explicitTransport && !hasPlaceholder) {
    throw new Error('Custom --dev-command must either include {prompt} or set --dev-prompt-transport explicitly.');
  }

  if (explicitTransport === 'argv' && !hasPlaceholder) {
    throw new Error('--dev-prompt-transport argv requires {prompt} in --dev-command.');
  }

  if (explicitTransport && explicitTransport !== 'argv' && hasPlaceholder) {
    throw new Error(`--dev-prompt-transport ${explicitTransport} must not be combined with {prompt} in --dev-command.`);
  }

  return {
    runtime: {
      type: 'local_cli',
      command: customCommand,
      cwd: '.',
      prompt_transport: explicitTransport || 'argv',
    },
  };
}

function formatGovernedRuntimeCommand(runtime) {
  return Array.isArray(runtime?.command) ? runtime.command.join(' ') : String(runtime?.command || '');
}

function resolveInitDirOption(dirOption) {
  if (dirOption == null) return null;
  const value = String(dirOption).trim();
  if (!value) {
    throw new Error('--dir must not be empty.');
  }
  return value;
}

function inferProjectNameFromTarget(targetPath, fallbackName) {
  const inferred = basename(resolve(process.cwd(), targetPath));
  return inferred && inferred.trim() ? inferred : fallbackName;
}

function formatInitTarget(dir) {
  const rel = relative(process.cwd(), dir);
  if (!rel) return '.';
  if (!rel.startsWith('..')) return rel;
  return dir;
}

function normalizeOptionalGoal(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function buildGovernedTemplateChoices(templates = loadAllGovernedTemplates()) {
  return templates.map((template) => ({
    name: `${chalk.cyan(template.display_name)} (${template.id}) — ${template.description}`,
    value: template.id,
    short: template.id,
  }));
}

export async function resolveGovernedInitAnswers(opts, prompt = (questions) => inquirer.prompt(questions)) {
  const explicitDir = resolveInitDirOption(opts.dir);
  let templateId = opts.template || null;

  if (!templateId) {
    const { template } = await prompt([{
      type: 'list',
      name: 'template',
      message: 'Governed template:',
      choices: buildGovernedTemplateChoices(),
      default: 'generic',
    }]);
    templateId = template;
  }

  const { name } = await prompt([{
    type: 'input',
    name: 'name',
    message: 'Project name:',
    default: explicitDir
      ? inferProjectNameFromTarget(explicitDir, 'My AgentXchain Project')
      : 'My AgentXchain Project',
  }]);
  const projectName = name;
  let folderName = explicitDir || slugify(projectName);

  let projectGoal = normalizeOptionalGoal(opts.goal);
  if (!projectGoal) {
    const { goal } = await prompt([{
      type: 'input',
      name: 'goal',
      message: 'Project goal (recommended; shown to every agent turn):',
      default: '',
    }]);
    projectGoal = normalizeOptionalGoal(goal);
  }

  if (!explicitDir) {
    const { folder } = await prompt([{
      type: 'input',
      name: 'folder',
      message: 'Folder name:',
      default: folderName,
    }]);
    folderName = folder;
  }

  return {
    explicitDir,
    templateId,
    projectName,
    folderName,
    goal: projectGoal,
  };
}

function generateWorkflowKitPlaceholder(artifact, projectName) {
  const filename = basename(artifact.path);
  const title = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

  if (artifact.semantics === 'section_check' && artifact.semantics_config?.required_sections?.length) {
    const sections = artifact.semantics_config.required_sections
      .map(s => `${s}\n\n(Content here.)\n`)
      .join('\n');
    return `# ${title} — ${projectName}\n\n${sections}`;
  }

  return `# ${title} — ${projectName}\n\n(Operator fills this in.)\n`;
}

function cloneJsonCompatible(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildScaffoldConfigFromTemplate(template, localDevRuntime, workflowKitConfig, runtimeOptions = {}) {
  const blueprint = template.scaffold_blueprint || null;
  const roles = cloneJsonCompatible(blueprint?.roles || GOVERNED_ROLES);
  const runtimes = cloneJsonCompatible(blueprint?.runtimes || GOVERNED_RUNTIMES);
  const explicitLocalDevRequested = Boolean(
    (Array.isArray(runtimeOptions.devCommand) && runtimeOptions.devCommand.length > 0)
    || (typeof runtimeOptions.devPromptTransport === 'string' && runtimeOptions.devPromptTransport.trim())
  );

  if (!blueprint || Object.values(roles).some((role) => role?.runtime === 'local-dev') || explicitLocalDevRequested) {
    runtimes['local-dev'] = localDevRuntime;
  }

  if (explicitLocalDevRequested && roles?.dev?.runtime === 'manual-dev') {
    roles.dev.runtime = 'local-dev';
  }

  const routing = cloneJsonCompatible(blueprint?.routing || GOVERNED_ROUTING);
  const gates = cloneJsonCompatible(blueprint?.gates || GOVERNED_GATES);
  const effectiveWorkflowKitConfig = workflowKitConfig || cloneJsonCompatible(blueprint?.workflow_kit || null);
  const prompts = Object.fromEntries(
    Object.keys(roles).map((roleId) => [roleId, `.agentxchain/prompts/${roleId}.md`])
  );

  const policies = cloneJsonCompatible(blueprint?.policies || []);

  return {
    roles,
    runtimes,
    routing,
    gates,
    policies,
    prompts,
    workflowKitConfig: effectiveWorkflowKitConfig,
  };
}

const PHASE_DISPLAY_NAMES = Object.freeze({
  qa: 'QA',
});

function formatPhaseDisplayName(phaseKey) {
  if (PHASE_DISPLAY_NAMES[phaseKey]) {
    return PHASE_DISPLAY_NAMES[phaseKey];
  }
  return phaseKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildRoadmapPhaseTable(routing, roles) {
  const rows = Object.entries(routing).map(([phaseKey, phaseConfig]) => {
    const phaseName = formatPhaseDisplayName(phaseKey);
    const entryRole = phaseConfig.entry_role;
    const role = roles[entryRole];
    const goal = role?.mandate || phaseName;
    const status = phaseKey === Object.keys(routing)[0] ? 'In progress' : 'Pending';
    return `| ${phaseName} | ${goal} | ${status} |`;
  });
  return `| Phase | Goal | Status |\n|-------|------|--------|\n${rows.join('\n')}\n`;
}

function buildPlanningSummaryLines(template, workflowKitConfig) {
  const lines = [
    'PM_SIGNOFF.md / ROADMAP.md / SYSTEM_SPEC.md',
    'acceptance-matrix.md / ship-verdict.md',
    'RELEASE_NOTES.md',
  ];
  const templatePlanningFiles = Array.isArray(template?.planning_artifacts)
    ? template.planning_artifacts
      .map((artifact) => artifact?.filename)
      .filter(Boolean)
    : [];
  const defaultScaffoldPaths = new Set([
    '.planning/PM_SIGNOFF.md',
    '.planning/ROADMAP.md',
    '.planning/SYSTEM_SPEC.md',
    '.planning/IMPLEMENTATION_NOTES.md',
    '.planning/acceptance-matrix.md',
    '.planning/ship-verdict.md',
    '.planning/RELEASE_NOTES.md',
  ]);
  const customWorkflowFiles = [];

  if (workflowKitConfig?.phases && typeof workflowKitConfig.phases === 'object') {
    for (const phaseConfig of Object.values(workflowKitConfig.phases)) {
      if (!Array.isArray(phaseConfig?.artifacts)) continue;
      for (const artifact of phaseConfig.artifacts) {
        if (!artifact?.path || defaultScaffoldPaths.has(artifact.path)) continue;
        customWorkflowFiles.push(basename(artifact.path));
      }
    }
  }

  if (templatePlanningFiles.length > 0) {
    lines.push(`template: ${templatePlanningFiles.join(' / ')}`);
  }
  const uniqueCustomWorkflowFiles = [...new Set(customWorkflowFiles)];
  if (uniqueCustomWorkflowFiles.length > 0) {
    lines.push(`workflow: ${uniqueCustomWorkflowFiles.join(' / ')}`);
  }

  return lines;
}

export function scaffoldGoverned(dir, projectName, projectId, templateId = 'generic', runtimeOptions = {}, workflowKitConfig = null) {
  const template = loadGovernedTemplate(templateId);
  const { runtime: localDevRuntime } = resolveGovernedLocalDevRuntime(runtimeOptions);
  const scaffoldConfig = buildScaffoldConfigFromTemplate(template, localDevRuntime, workflowKitConfig, runtimeOptions);
  const { roles, runtimes, routing, gates, policies, prompts, workflowKitConfig: effectiveWorkflowKitConfig } = scaffoldConfig;
  const scaffoldWorkflowKitConfig = effectiveWorkflowKitConfig
    ? normalizeWorkflowKit(effectiveWorkflowKitConfig, Object.keys(routing))
    : null;
  const initialPhase = Object.keys(routing)[0] || 'planning';
  const phaseGateStatus = Object.fromEntries(
    [...new Set(
      Object.values(routing)
        .map((route) => route?.exit_gate)
        .filter(Boolean)
    )].map((gateId) => [gateId, 'pending'])
  );
  const projectGoal = runtimeOptions.goal;
  const config = {
    schema_version: '1.0',
    template: template.id,
    project: {
      id: projectId,
      name: projectName,
      ...(typeof projectGoal === 'string' && projectGoal.trim() ? { goal: projectGoal.trim() } : {}),
      default_branch: 'main'
    },
    roles,
    runtimes,
    routing,
    gates,
    budget: {
      per_turn_max_usd: 2.0,
      per_run_max_usd: 50.0,
      on_exceed: 'pause_and_escalate'
    },
    retention: {
      talk_strategy: 'append_only',
      history_strategy: 'jsonl_append_only'
    },
    prompts,
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2
    }
  };
  if (policies && policies.length > 0) {
    config.policies = policies;
  }
  if (effectiveWorkflowKitConfig) {
    config.workflow_kit = effectiveWorkflowKitConfig;
  }

  const state = {
    schema_version: '1.1',
    run_id: null,
    project_id: projectId,
    status: 'idle',
    phase: initialPhase,
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    last_gate_failure: null,
    phase_gate_status: phaseGateStatus,
    budget_reservations: {},
    budget_status: {
      spent_usd: 0,
      remaining_usd: config.budget.per_run_max_usd
    }
  };

  // Create directories
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'reviews'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'dispatch'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  // Core governed files
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');

  // Prompt templates
  for (const [roleId, role] of Object.entries(roles)) {
    const basePrompt = buildGovernedPrompt(roleId, role, {
      routing,
      gates,
      workflowKitConfig: scaffoldWorkflowKitConfig,
    });
    const prompt = appendPromptOverride(basePrompt, template.prompt_overrides?.[roleId]);
    writeFileSync(join(dir, '.agentxchain', 'prompts', `${roleId}.md`), prompt);
  }

  // Planning artifacts
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), `# PM Signoff — ${projectName}\n\nApproved: NO\n\n> This scaffold starts blocked on purpose. Change this to \`Approved: YES\` only after a human reviews the planning artifacts and is ready to open the planning gate.\n\n## Discovery Checklist\n- [ ] Target user defined\n- [ ] Core pain point defined\n- [ ] Core workflow defined\n- [ ] MVP scope defined\n- [ ] Out-of-scope list defined\n- [ ] Success metric defined\n\n## Notes for team\n(PM and human add final kickoff notes here.)\n`);
  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), `# Roadmap — ${projectName}\n\n## Phases\n\n${buildRoadmapPhaseTable(routing, roles)}`);
  writeFileSync(join(dir, '.planning', 'SYSTEM_SPEC.md'), buildSystemSpecContent(projectName, template.system_spec_overlay));
  writeFileSync(join(dir, '.planning', 'IMPLEMENTATION_NOTES.md'), `# Implementation Notes — ${projectName}\n\n## Changes\n\n(Dev fills this during implementation)\n\n## Verification\n\n(Dev fills this during implementation)\n\n## Unresolved Follow-ups\n\n(Dev lists any known gaps, tech debt, or follow-up items here.)\n`);
  const baseAcceptanceMatrix = `# Acceptance Matrix — ${projectName}\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| (QA fills this from ROADMAP.md) | | | | | |\n`;
  writeFileSync(
    join(dir, '.planning', 'acceptance-matrix.md'),
    appendAcceptanceHints(baseAcceptanceMatrix, template.acceptance_hints)
  );
  writeFileSync(join(dir, '.planning', 'ship-verdict.md'), `# Ship Verdict — ${projectName}\n\n## Verdict: PENDING\n\n## QA Summary\n\n(QA writes the final ship/no-ship assessment here.)\n\n## Open Blockers\n\n(List any blocking issues.)\n\n## Conditions\n\n(List any conditions for shipping.)\n`);
  writeFileSync(join(dir, '.planning', 'RELEASE_NOTES.md'), `# Release Notes — ${projectName}\n\n## User Impact\n\n(QA fills this during the QA phase)\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n\n## Upgrade Notes\n\n(QA fills this during the QA phase)\n\n## Known Issues\n\n(QA fills this during the QA phase)\n`);
  for (const artifact of template.planning_artifacts) {
    writeFileSync(
      join(dir, '.planning', artifact.filename),
      interpolateTemplateContent(artifact.content_template, projectName)
    );
  }

  // Workflow-kit custom artifacts — only scaffold files from explicit workflow_kit config
  // that are not already handled by the default scaffold above
  if (scaffoldWorkflowKitConfig && scaffoldWorkflowKitConfig.phases && typeof scaffoldWorkflowKitConfig.phases === 'object') {
    const defaultScaffoldPaths = new Set([
      '.planning/PM_SIGNOFF.md',
      '.planning/ROADMAP.md',
      '.planning/SYSTEM_SPEC.md',
      '.planning/IMPLEMENTATION_NOTES.md',
      '.planning/acceptance-matrix.md',
      '.planning/ship-verdict.md',
      '.planning/RELEASE_NOTES.md',
    ]);

    for (const phaseConfig of Object.values(scaffoldWorkflowKitConfig.phases)) {
      if (!Array.isArray(phaseConfig.artifacts)) continue;
      for (const artifact of phaseConfig.artifacts) {
        if (!artifact.path || defaultScaffoldPaths.has(artifact.path)) continue;
        const absPath = join(dir, artifact.path);
        if (existsSync(absPath)) continue;

        // Ensure parent directory exists
        const parentDir = dirname(absPath);
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

        // Generate placeholder content based on semantics type
        const content = generateWorkflowKitPlaceholder(artifact, projectName);
        writeFileSync(absPath, content);
      }
    }
  }

  // TALK.md
  writeFileSync(join(dir, 'TALK.md'), `# ${projectName} — Team Talk File\n\nCanonical human-readable handoff log for all agents.\n\n---\n\n`);

  // .gitignore additions
  const gitignorePath = join(dir, '.gitignore');
  const requiredIgnores = ['.env', '.agentxchain/staging/', '.agentxchain/dispatch/'];
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

  return { config, state, scaffoldWorkflowKitConfig };
}

async function initGoverned(opts) {
  let projectName, folderName;
  let templateId;
  let selectedTemplate;
  let explicitDir;
  let projectGoal;

  try {
    if (opts.yes) {
      explicitDir = resolveInitDirOption(opts.dir);
      templateId = opts.template || 'generic';
      projectGoal = normalizeOptionalGoal(opts.goal);
    } else {
      const answers = await resolveGovernedInitAnswers(opts);
      explicitDir = answers.explicitDir;
      templateId = answers.templateId;
      projectName = answers.projectName;
      folderName = answers.folderName;
      projectGoal = answers.goal;
    }
  } catch (err) {
    console.error(chalk.red(`  Error: ${err.message}`));
    process.exit(1);
  }

  if (!VALID_GOVERNED_TEMPLATE_IDS.includes(templateId)) {
    console.error(chalk.red(`  Error: Unknown template "${templateId}".`));
    console.error('');
    console.error('  Available templates:');
    console.error('    generic       Default governed scaffold');
    console.error('    api-service   Governed scaffold for a backend service');
    console.error('    cli-tool      Governed scaffold for a CLI tool');
    console.error('    library       Governed scaffold for a reusable package');
    console.error('    web-app       Governed scaffold for a web application');
    process.exit(1);
  }
  selectedTemplate = loadGovernedTemplate(templateId);

  if (opts.yes) {
    // Auto-detect in-place scaffolding: if cwd is a git repo without agentxchain.json,
    // scaffold here instead of creating a subdirectory. First-time users who already
    // ran `mkdir my-project && cd my-project && git init` should not get a nested folder.
    if (!explicitDir && existsSync(join(process.cwd(), '.git')) && !existsSync(join(process.cwd(), CONFIG_FILE))) {
      explicitDir = '.';
    }
    projectName = explicitDir
      ? inferProjectNameFromTarget(explicitDir, 'My AgentXchain Project')
      : 'My AgentXchain Project';
    folderName = explicitDir || slugify(projectName);
  }

  const dir = resolve(process.cwd(), folderName);
  const targetLabel = formatInitTarget(dir);
  const projectId = slugify(projectName);
  let localDevRuntime;

  try {
    ({ runtime: localDevRuntime } = resolveGovernedLocalDevRuntime(opts));
  } catch (err) {
    console.error(chalk.red(`  Error: ${err.message}`));
    process.exit(1);
  }

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

  // If reinitializing a project that has explicit workflow_kit config, preserve it for scaffold
  let workflowKitConfig = null;
  const existingConfigPath = join(dir, CONFIG_FILE);
  if (existsSync(existingConfigPath)) {
    try {
      const existing = JSON.parse(readFileSync(existingConfigPath, 'utf8'));
      if (existing.workflow_kit && typeof existing.workflow_kit === 'object' && Object.keys(existing.workflow_kit).length > 0) {
        workflowKitConfig = existing.workflow_kit;
      }
    } catch {
      // Ignore parse errors — scaffold will overwrite the config anyway
    }
  }

  const scaffoldOptions = projectGoal
    ? { ...opts, goal: projectGoal }
    : { ...opts };
  const { config, scaffoldWorkflowKitConfig } = scaffoldGoverned(dir, projectName, projectId, templateId, scaffoldOptions, workflowKitConfig);

  console.log('');
  console.log(chalk.green(`  ✓ Created governed project ${chalk.bold(targetLabel)}/`));
  console.log('');
  const promptRoleIds = Object.keys(config.roles);
  const phaseNames = Object.keys(config.routing);
  console.log(`    ${chalk.dim('├──')} agentxchain.json  ${chalk.dim('(governed)')}`);
  console.log(`    ${chalk.dim('├──')} .agentxchain/`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('├──')} state.json / history.jsonl / decision-ledger.jsonl`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('├──')} staging/`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('├──')} prompts/  ${chalk.dim(`(${promptRoleIds.join(', ')})`)}`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('├──')} reviews/`);
  console.log(`    ${chalk.dim('│')}    ${chalk.dim('└──')} dispatch/`);
  console.log(`    ${chalk.dim('├──')} .planning/`);
  const planningSummaryLines = buildPlanningSummaryLines(selectedTemplate, scaffoldWorkflowKitConfig);
  for (const [index, line] of planningSummaryLines.entries()) {
    const branch = index === planningSummaryLines.length - 1 ? '└──' : '├──';
    console.log(`    ${chalk.dim('│')}    ${chalk.dim(branch)} ${line}`);
  }
  console.log(`    ${chalk.dim('└──')} TALK.md`);
  console.log('');
  console.log(`  ${chalk.dim('Roles:')} ${promptRoleIds.join(', ')}`);
  console.log(`  ${chalk.dim('Phases:')} ${phaseNames.join(' → ')} ${chalk.dim(selectedTemplate.scaffold_blueprint ? '(template-defined; edit routing in agentxchain.json to customize)' : '(default; extend via routing in agentxchain.json)')}`);
  console.log(`  ${chalk.dim('Template:')} ${templateId}`);
  if (config.project?.goal) {
    console.log(`  ${chalk.dim('Goal:')} ${config.project.goal}`);
  }
  console.log(`  ${chalk.dim('Dev runtime:')} ${formatGovernedRuntimeCommand(localDevRuntime)} ${chalk.dim(`(${localDevRuntime.prompt_transport})`)}`);
  console.log(`  ${chalk.dim('Protocol:')} governed convergence`);
  console.log('');

  // Readiness hint: tell user which roles work immediately vs which need API keys
  const allRuntimes = config.runtimes;
  const manualRoleIds = Object.entries(config.roles)
    .filter(([, role]) => allRuntimes[role.runtime]?.type === 'manual')
    .map(([roleId]) => roleId);
  const rolesNeedingKeys = Object.entries(config.roles)
    .filter(([, role]) => Boolean(allRuntimes[role.runtime]?.auth_env))
    .map(([roleId, role]) => ({ roleId, env: allRuntimes[role.runtime].auth_env }));
  if (rolesNeedingKeys.length > 0) {
    const envVars = [...new Set(rolesNeedingKeys.map((r) => r.env))];
    const roleNames = rolesNeedingKeys.map((r) => r.roleId);
    const hasKeys = envVars.every(v => process.env[v]);
    if (hasKeys) {
      console.log(`  ${chalk.green('Ready:')} all runtimes configured (${envVars.join(', ')} detected)`);
    } else {
      console.log(`  ${chalk.yellow('Mixed-mode:')} ${manualRoleIds.join(', ')} work immediately (manual).`);
      console.log(`  ${chalk.yellow('  ')}${roleNames.join(', ')} need ${chalk.bold(envVars.join(', '))} to dispatch automatically.`);
      console.log(`  ${chalk.yellow('  ')}Without it, those turns fall back to manual input.`);
      if (config.roles?.qa?.runtime === 'api-qa' && allRuntimes['manual-qa']) {
        console.log(`  ${chalk.yellow('  ')}No-key QA path: change ${chalk.bold('roles.qa.runtime')} from ${chalk.bold('"api-qa"')} to ${chalk.bold('"manual-qa"')} in ${chalk.bold('agentxchain.json')}.`);
      }
    }
    console.log('');
  } else if (Object.entries(config.roles).every(([, role]) => allRuntimes[role.runtime]?.type === 'manual')) {
    console.log(`  ${chalk.green('Ready:')} manual-only scaffold (${chalk.bold('no API keys')} and ${chalk.bold('no local coding CLI')} required).`);
    console.log('');
  }

  console.log(`  ${chalk.cyan('Next:')}`);
  if (dir !== process.cwd()) {
    console.log(`    ${chalk.bold(`cd ${targetLabel}`)}`);
  }
  if (!findGitRoot(dir)) {
    console.log(`    ${chalk.bold('git init')} ${chalk.dim('# initialize the governed repo')}`);
  }
  console.log(`    ${chalk.bold('agentxchain template validate')} ${chalk.dim('# prove the scaffold contract before the first turn')}`);
  console.log(`    ${chalk.bold('agentxchain doctor')} ${chalk.dim('# verify runtimes, config, and readiness')}`);
  console.log(`    ${chalk.bold('agentxchain connector check')} ${chalk.dim('# live-probe configured runtimes before the first turn')}`);
  console.log(`    ${chalk.bold('git add -A')} ${chalk.dim('# stage the governed scaffold')}`);
  console.log(`    ${chalk.bold('git commit -m "initial governed scaffold"')} ${chalk.dim('# checkpoint the starting state')}`);
  console.log(`    ${chalk.bold('agentxchain step')} ${chalk.dim('# run the first governed turn')}`);
  console.log(`    ${chalk.bold('agentxchain status')} ${chalk.dim('# inspect phase, gate, and turn state')}`);
  console.log('');
  if (!config?.project?.goal) {
    console.log(`  ${chalk.dim('Tip:')} Add a project goal to guide agent context:`);
    console.log(`    ${chalk.bold('agentxchain init --governed --goal "Build a ..."')} ${chalk.dim('# preferred during scaffold')}`);
    console.log(`    ${chalk.bold('agentxchain config --set project.goal "Build a ..."')} ${chalk.dim('# add it later without hand-editing JSON')}`);
    console.log('');
  }
  console.log(`  ${chalk.dim('Guide:')} https://agentxchain.dev/docs/getting-started`);
  console.log('');
}

export async function initCommand(opts) {
  if (opts.governed || opts.schemaVersion === '4') {
    return initGoverned(opts);
  }

  let project, agents, folderName, rules;
  let explicitDir;
  try {
    explicitDir = resolveInitDirOption(opts.dir);
  } catch (err) {
    console.error(chalk.red(`  Error: ${err.message}`));
    process.exit(1);
  }

  if (opts.yes) {
    project = explicitDir
      ? inferProjectNameFromTarget(explicitDir, 'My AgentXchain project')
      : 'My AgentXchain project';
    agents = DEFAULT_AGENTS;
    folderName = explicitDir || slugify(project);
    rules = {
      max_consecutive_claims: 2,
      require_message: true,
      compress_after_words: 5000,
      strict_next_owner: false
    };
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
      rules = {
      max_consecutive_claims: 2,
      require_message: true,
      compress_after_words: 5000,
      strict_next_owner: false
    };
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: explicitDir
          ? inferProjectNameFromTarget(explicitDir, 'My AgentXchain project')
          : 'My AgentXchain project'
      }]);
      project = projectName;
    } else {
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: explicitDir
          ? inferProjectNameFromTarget(explicitDir, 'My AgentXchain project')
          : 'My AgentXchain project'
      }]);
      project = projectName;
      agents = {};
      rules = {
      max_consecutive_claims: 2,
      require_message: true,
      compress_after_words: 5000,
      strict_next_owner: false
    };

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

    folderName = explicitDir || slugify(project);
    if (!explicitDir) {
      const { folder } = await inquirer.prompt([{
        type: 'input',
        name: 'folder',
        message: 'Folder name:',
        default: folderName
      }]);
      folderName = folder;
    }
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
      strict_next_owner: rules.strict_next_owner === true,
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
  const requiredIgnores = ['.env', '.agentxchain-trigger.json', '.agentxchain-prompts/', '.agentxchain-workspaces/', '.agentxchain-watch.pid', '.agentxchain-autonudge.state'];
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

  writeFileSync(join(dir, '.planning', 'ROADMAP.md'), `# Roadmap — ${project}\n\n## Waves\n\n| Wave | Goal | Status |\n|------|------|--------|\n| Wave 1 | Discovery, planning, and phase setup | In progress |\n\n## Phases\n\n| Phase | Description | Status | Requirements |\n|-------|-------------|--------|-------------|\n| 1 | Discovery + setup | In progress | — |\n\n(PM updates this as phases are planned and completed.)\n`);
  writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), `# PM Signoff — ${project}\n\nApproved: NO\n\n> This scaffold starts blocked on purpose. Change this to \`Approved: YES\` only after a human reviews the planning artifacts and is ready to open the planning gate.\n\n## Discovery Checklist\n- [ ] Target user defined\n- [ ] Core pain point defined\n- [ ] Core workflow defined\n- [ ] MVP scope defined\n- [ ] Out-of-scope list defined\n- [ ] Success metric defined\n\n## Notes for team\n(PM and human add final kickoff notes here.)\n`);

  // QA structure
  mkdirSync(join(dir, '.planning', 'phases', 'phase-1'), { recursive: true });
  writeFileSync(join(dir, '.planning', 'phases', 'phase-1', 'PLAN.md'), `# Phase 1 Plan — ${project}\n\n## Goal\n\nAlign scope, requirements, and initial implementation plan.\n\n## Deliverables\n\n- PM signoff\n- Initial requirements and roadmap\n- First implementation slice\n`);
  writeFileSync(join(dir, '.planning', 'phases', 'phase-1', 'TESTS.md'), `# Phase 1 Tests — ${project}\n\n## Planned checks\n\n- Kickoff validation passes\n- Requirements have acceptance criteria\n- First implementation slice has an executable verification path\n`);
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
