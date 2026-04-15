import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(__dirname, '..');
const docsPath = join(cliRoot, '..', 'website-v2', 'docs', 'cli.mdx');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const specPath = join(cliRoot, '..', '.planning', 'CLI_DOCS_GOVERNANCE_CONTRACT_SPEC.md');
const resumePath = join(cliRoot, 'src', 'commands', 'resume.js');
const stepPath = join(cliRoot, 'src', 'commands', 'step.js');
const statusPath = join(cliRoot, 'src', 'commands', 'status.js');
const governedStatePath = join(cliRoot, 'src', 'lib', 'governed-state.js');
const resumeStepSpecPath = join(cliRoot, '..', '.planning', 'CLI_DOCS_RESUME_STEP_CONTRACT_SPEC.md');

const docs = readFileSync(docsPath, 'utf8');
const bin = readFileSync(binPath, 'utf8');
const resumeSource = readFileSync(resumePath, 'utf8');
const stepSource = readFileSync(stepPath, 'utf8');
const statusSource = readFileSync(statusPath, 'utf8');
const governedStateSource = readFileSync(governedStatePath, 'utf8');

/**
 * Extract .option() flags registered for a command in agentxchain.js.
 * Walks from `.command('<name>')` to the next `.action(` and collects
 * every `--<flag>` from `.option(` calls.
 */
function extractBinFlags(commandName) {
  // Find the .command('name') registration
  const cmdPattern = new RegExp(`\\.command\\('${commandName}'\\)`);
  const cmdMatch = cmdPattern.exec(bin);
  if (!cmdMatch) return null; // command not found
  const start = cmdMatch.index;
  // Find the next .action( after the command
  const actionMatch = /\.action\(/.exec(bin.slice(start));
  if (!actionMatch) return [];
  const block = bin.slice(start, start + actionMatch.index);
  const flags = [];
  const optionRe = /\.(?:option|requiredOption)\(\s*'([^']+)'/g;
  let m;
  while ((m = optionRe.exec(block)) !== null) {
    // Extract the long flag (e.g., from '-j, --json' get '--json')
    const parts = m[1].split(',').map(s => s.trim());
    const long = parts.find(p => p.startsWith('--'));
    if (long) {
      // Strip value placeholder: '--turn <id>' -> '--turn'
      flags.push(long.split(/\s/)[0]);
    }
  }
  return flags;
}

/**
 * Extract documented flags from a command section in cli.mdx.
 * Looks for backtick-wrapped flags in table rows.
 */
function extractDocsFlags(commandName) {
  // Find the ### `commandName` heading — must be the standalone command heading,
  // not a comparison heading like `### resume vs step`. Match end-of-line after backtick.
  const headingRe = new RegExp(`###\\s+\`${commandName}\`\\s*$`, 'gm');
  let headingMatch = null;
  let m;
  while ((m = headingRe.exec(docs)) !== null) {
    headingMatch = m;
    // Take the last match — the standalone command heading, not the comparison
    // Actually take the match that has a code block (```bash) shortly after
    const after = docs.slice(m.index, m.index + 200);
    if (after.includes('```bash') || after.includes('No flags')) {
      headingMatch = m;
      break;
    }
  }
  if (!headingMatch) return null;
  const start = headingMatch.index;
  // Find the next ### or ## heading
  const nextHeading = /\n##[#]?\s/.exec(docs.slice(start + 1));
  const end = nextHeading ? start + 1 + nextHeading.index : docs.length;
  const section = docs.slice(start, end);

  // Check for "No flags" statement
  if (/No flags\./.test(section)) return [];

  // Extract flags from table rows: | `--flag`, | `--flag <value>`, or | `-j, --json`
  const flags = [];
  const flagRe = /\|\s*`(?:-\w,\s*)?(--[a-z][-a-z]*)/g;
  let m2;
  while ((m2 = flagRe.exec(section)) !== null) {
    flags.push(m2[1]);
  }
  return flags;
}

// Commands to audit — governance, turn lifecycle, approval, migration, validation
const GOVERNED_COMMANDS = [
  'resume',
  'escalate',
  'step',
  'accept-turn',
  'reject-turn',
  'approve-transition',
  'approve-completion',
  'validate',
  'migrate',
];

describe('CLI governance docs contract — flag alignment', () => {
  for (const cmd of GOVERNED_COMMANDS) {
    it(`${cmd}: every documented flag exists in the CLI`, () => {
      const binFlags = extractBinFlags(cmd);
      assert.ok(binFlags !== null, `command '${cmd}' not found in agentxchain.js`);
      const docsFlags = extractDocsFlags(cmd);
      assert.ok(docsFlags !== null, `command '${cmd}' section not found in cli.mdx`);

      for (const flag of docsFlags) {
        assert.ok(
          binFlags.includes(flag),
          `docs claim '${cmd}' has flag ${flag}, but the CLI does not register it. Ghost flag.`
        );
      }
    });

    it(`${cmd}: every CLI flag is documented`, () => {
      const binFlags = extractBinFlags(cmd);
      assert.ok(binFlags !== null, `command '${cmd}' not found in agentxchain.js`);
      const docsFlags = extractDocsFlags(cmd);
      assert.ok(docsFlags !== null, `command '${cmd}' section not found in cli.mdx`);

      for (const flag of binFlags) {
        assert.ok(
          docsFlags.includes(flag),
          `CLI registers '${cmd} ${flag}' but docs do not mention it. Undocumented flag.`
        );
      }
    });
  }
});

describe('CLI governance docs contract — no ghost flag names', () => {
  it('docs do not use --turn-id (correct name is --turn)', () => {
    assert.ok(
      !docs.includes('--turn-id'),
      'cli.mdx still references --turn-id which does not exist. The correct flag is --turn.'
    );
  });

  it('docs do not use --adapter on resume or step', () => {
    // Check that --adapter does not appear in the resume or step sections
    for (const cmd of ['resume', 'step']) {
      const headingRe = new RegExp(`###\\s+\`${cmd}\``, 'm');
      const match = headingRe.exec(docs);
      if (!match) continue;
      const start = match.index;
      const nextHeading = /\n##[#]?\s/.exec(docs.slice(start + 1));
      const end = nextHeading ? start + 1 + nextHeading.index : docs.length;
      const section = docs.slice(start, end);
      assert.ok(
        !section.includes('--adapter'),
        `cli.mdx ${cmd} section still references --adapter which does not exist`
      );
    }
  });

  it('docs do not use --fix on validate', () => {
    const headingRe = /###\s+`validate`/m;
    const match = headingRe.exec(docs);
    assert.ok(match, 'validate section not found');
    const start = match.index;
    const nextHeading = /\n##[#]?\s/.exec(docs.slice(start + 1));
    const end = nextHeading ? start + 1 + nextHeading.index : docs.length;
    const section = docs.slice(start, end);
    assert.ok(
      !section.includes('--fix'),
      'cli.mdx validate section still references --fix which does not exist'
    );
  });
});

describe('CLI governance docs contract — common sequences', () => {
  it('common sequences do not use --verbose on status', () => {
    assert.ok(
      !docs.includes('status --verbose'),
      'cli.mdx common sequences reference "status --verbose" but status has no --verbose flag'
    );
  });

  it('manual planning sequence reflects step auto-accept and approve-transition', () => {
    assert.match(stepSource, /Staged result detected\./);
    assert.match(stepSource, /Turn Accepted/);
    assert.match(
      docs,
      /step detects the staged result, validates it, and auto-accepts it/i
    );
    assert.match(
      docs,
      /unless a configured acceptance policy blocks or escalates the commit/i
    );
    assert.match(docs, /agentxchain approve-transition/);
    assert.doesNotMatch(
      docs,
      /### `?Manual planning turn`?[\s\S]*agentxchain accept-turn[\s\S]*agentxchain approve-transition/i
    );
  });

  it('documents that retained validation failures exit non-zero', () => {
    assert.match(
      docs,
      /retained validation-failure path exits non-zero/i
    );
  });

  it('conflicted-turn recovery uses reject-turn --reassign or accept-turn --resolution human_merge', () => {
    assert.match(stepSource, /reject-turn --turn .* --reassign/);
    assert.match(stepSource, /accept-turn --turn .* --resolution human_merge/);
    assert.match(statusSource, /agentxchain reject-turn --turn .* --reassign/);
    assert.match(statusSource, /agentxchain accept-turn --turn .* --resolution human_merge/);
    assert.match(docs, /reject-turn --turn <turn_id> --reassign/);
    assert.match(docs, /accept-turn --turn <turn_id> --resolution human_merge/);
    assert.doesNotMatch(
      docs,
      /### `?Recover a conflicted turn`?[\s\S]*agentxchain resume[\s\S]*agentxchain accept-turn/i
    );
    assert.doesNotMatch(
      docs,
      /\| `blocked:conflict` \| State file conflict detected \| Manual resolution, then `resume` \|/
    );
  });
});

describe('CLI governance docs contract — admission control truth', () => {
  it('documents validate as a fail-closed admission-control surface', () => {
    const validateSection = docs.match(/### `validate`[\s\S]*?(?=\n### `verify turn`)/);
    assert.ok(validateSection, 'validate section not found');
    assert.match(validateSection[0], /admission-control dead ends/i);
    assert.match(validateSection[0], /no routed file producer/i);
    assert.match(validateSection[0], /owner is not routed into the phase/i);
    assert.match(validateSection[0], /owner is routed but still cannot write/i);
    assert.match(validateSection[0], /warning/i);
    assert.match(validateSection[0], /external approval/i);
  });

  it('documents doctor admission_control as a first-class readiness check', () => {
    const doctorSection = docs.match(/### `doctor`[\s\S]*?(?=\n### `connector check`)/);
    assert.ok(doctorSection, 'doctor section not found');
    assert.match(doctorSection[0], /\| Admission control \| `admission_control` \|/);
    assert.match(doctorSection[0], /Static dead-end detection/i);
    assert.match(doctorSection[0], /unreachable `owned_by` artifacts/i);
  });

  it('documents role show and doctor runtime capability contract fields', () => {
    const roleSection = docs.match(/### `role show`[\s\S]*?(?=\n### `turn show`)/);
    assert.ok(roleSection, 'role show section not found');
    assert.match(roleSection[0], /transport/i);
    assert.match(roleSection[0], /proposal support/i);
    assert.match(roleSection[0], /workflow-kit `owned_by` suitability/i);

    const doctorSection = docs.match(/### `doctor`[\s\S]*?(?=\n### `connector check`)/);
    assert.ok(doctorSection, 'doctor section not found');
    assert.match(doctorSection[0], /runtime_contract/);
    assert.match(doctorSection[0], /bound_roles/);
    assert.match(doctorSection[0], /workflow-artifact ownership/i);
  });
});

describe('CLI governance docs contract — events observability', () => {
  it('documents the full governed event set including gate_failed', () => {
    assert.match(
      docs,
      /run_started`, `phase_entered`, `turn_dispatched`, `turn_accepted`, `turn_rejected`, `run_blocked`, `run_completed`, `escalation_raised`, `escalation_resolved`, `gate_pending`, `gate_approved`, `gate_failed`/,
    );
  });

  it('documents inline text rendering for phase_entered and gate_failed', () => {
    assert.match(
      docs,
      /`phase_entered` text entries show the transition as `from → to \(trigger\)`/i,
    );
    assert.match(
      docs,
      /`gate_failed` text entries show the blocked transition plus the first failure reason and gate ID inline/i,
    );
  });
});

describe('CLI governance docs contract — report governance events', () => {
  it('documents governance events in the report command description', () => {
    assert.match(
      docs,
      /Governance Events.*section.*decision ledger.*governance events/i,
    );
    assert.match(
      docs,
      /policy escalations.*conflict.*operator escalations.*escalation resolutions/i,
    );
    assert.match(
      docs,
      /Coordinator reports.*coordinator-level governance events.*\.agentxchain\/multirepo\/decision-ledger\.jsonl/i,
    );
  });
});

describe('CLI governance docs contract — coordinator status observability', () => {
  it('documents coordinator status enrichment: elapsed, blocked, gates, timing fields', () => {
    assert.match(
      docs,
      /multi status.*elapsed time.*blocked reason.*phase gate/i,
    );
    assert.match(
      docs,
      /blocked_reason.*created_at.*updated_at.*phase_gate_status/,
    );
  });
});

describe('CLI governance docs contract — approval commands have no flag tables', () => {
  for (const cmd of ['approve-transition', 'approve-completion']) {
    it(`${cmd} docs state "No flags"`, () => {
      const docsFlags = extractDocsFlags(cmd);
      assert.ok(docsFlags !== null, `${cmd} section not found`);
      assert.equal(docsFlags.length, 0, `${cmd} should have no flags documented`);
    });
  }
});

describe('CLI governance docs contract — resume vs step behavior', () => {
  it('documents resume as a non-waiting assignment or re-dispatch path, not existing-turn-only', () => {
    assert.match(resumeSource, /initializeGovernedRun\(/);
    assert.match(resumeSource, /assignGovernedTurn\(/);
    assert.match(governedStateSource, /status:\s*'running'/);

    assert.match(
      docs,
      /Initialize or resume a governed run and assign or re-dispatch one turn without waiting/i
    );
    assert.doesNotMatch(docs, /\|\s+\*\*Creates a new turn\?\*\*\s+\|\s+No\s+\|/);
    assert.doesNotMatch(docs, /assignment-only operation/i);
    assert.doesNotMatch(docs, /Re-dispatches an existing pending turn\./);
  });

  it('documents step --resume as the active-turn continuation path', () => {
    assert.match(resumeSource, /Use agentxchain step --resume to continue waiting for an active turn\./);
    assert.match(stepSource, /if \(opts\.resume\)/);
    assert.match(docs, /use `agentxchain step --resume` instead/i);
    assert.match(docs, /Create or resume one turn, dispatch to adapter, wait for result, validate, and record the outcome/i);
  });

  it('documents that approval-held paused runs use approval commands instead of resume', () => {
    assert.match(resumeSource, /pending_phase_transition \|\| state\.pending_run_completion/);
    assert.match(docs, /pending_phase_transition/);
    assert.match(docs, /pending_run_completion/);
    assert.match(docs, /approve-transition/);
    assert.match(docs, /approve-completion/);
  });
});

describe('CLI governance docs contract — spec exists', () => {
  it('CLI_DOCS_GOVERNANCE_CONTRACT_SPEC.md exists', () => {
    const spec = readFileSync(specPath, 'utf8');
    assert.ok(spec.includes('Discrepancies Found'), 'spec must document discrepancies');
    assert.ok(spec.includes('AT-CLI-GOV-001'), 'spec must have acceptance tests');
  });

  it('CLI_DOCS_RESUME_STEP_CONTRACT_SPEC.md exists', () => {
    const spec = readFileSync(resumeStepSpecPath, 'utf8');
    assert.ok(spec.includes('AT-CLI-RS-001'), 'resume/step spec must have acceptance tests');
    assert.ok(spec.includes('step --resume'), 'resume/step spec must document the active-turn path');
  });
});
