/**
 * Continuous Vision-Driven Run — lights-out governed execution loop.
 *
 * When the intake queue is empty, derives candidate intents from VISION.md
 * and feeds them through the existing intake pipeline. Chains governed runs
 * back-to-back until max_runs, max_idle_cycles, or operator stop.
 *
 * Spec: .planning/VISION_DRIVEN_CONTINUOUS_SPEC.md
 * Decision: DEC-VISION-CONTINUOUS-001
 */

import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveVisionPath, deriveVisionCandidates } from './vision-reader.js';
import {
  recordEvent,
  triageIntent,
  approveIntent,
} from './intake.js';
import { loadProjectState } from './config.js';
import { safeWriteJson } from './safe-write.js';

const CONTINUOUS_SESSION_PATH = '.agentxchain/continuous-session.json';

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export function readContinuousSession(root) {
  const p = join(root, CONTINUOUS_SESSION_PATH);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeContinuousSession(root, session) {
  const dir = join(root, '.agentxchain');
  mkdirSync(dir, { recursive: true });
  safeWriteJson(join(root, CONTINUOUS_SESSION_PATH), session);
}

export function removeContinuousSession(root) {
  const p = join(root, CONTINUOUS_SESSION_PATH);
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // best-effort cleanup
  }
}

function createSession(visionPath, maxRuns, maxIdleCycles) {
  return {
    session_id: `cont-${randomUUID().slice(0, 8)}`,
    started_at: new Date().toISOString(),
    vision_path: visionPath,
    runs_completed: 0,
    max_runs: maxRuns,
    idle_cycles: 0,
    max_idle_cycles: maxIdleCycles,
    current_run_id: null,
    current_vision_objective: null,
    status: 'running',
  };
}

// ---------------------------------------------------------------------------
// Intake queue check
// ---------------------------------------------------------------------------

/**
 * Find the next approved or planned intent in the intake queue.
 *
 * @param {string} root
 * @returns {{ ok: boolean, intentId?: string, status?: string }}
 */
export function findNextQueuedIntent(root) {
  const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
  if (!existsSync(intentsDir)) return { ok: false };

  const files = readdirSync(intentsDir).filter(f => f.endsWith('.json') && !f.startsWith('.tmp-'));

  // Priority order: planned > approved (planned is closer to execution)
  let bestPlanned = null;
  let bestApproved = null;

  for (const file of files) {
    try {
      const intent = JSON.parse(readFileSync(join(intentsDir, file), 'utf8'));
      if (intent.status === 'planned' && !bestPlanned) {
        bestPlanned = { intentId: intent.intent_id, status: 'planned' };
      } else if (intent.status === 'approved' && !bestApproved) {
        bestApproved = { intentId: intent.intent_id, status: 'approved' };
      }
    } catch {
      // skip corrupt
    }
  }

  if (bestPlanned) return { ok: true, ...bestPlanned };
  if (bestApproved) return { ok: true, ...bestApproved };
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Vision-to-intake pipeline
// ---------------------------------------------------------------------------

/**
 * Derive the next vision candidate and record it through the intake pipeline.
 *
 * @param {string} root
 * @param {string} visionPath - Absolute path to VISION.md
 * @param {{ triageApproval?: string }} options
 * @returns {{ ok: boolean, intentId?: string, section?: string, goal?: string, error?: string, idle?: boolean }}
 */
export function seedFromVision(root, visionPath, options = {}) {
  const result = deriveVisionCandidates(root, visionPath);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  if (result.candidates.length === 0) {
    return { ok: true, idle: true };
  }

  // Take the first unaddressed candidate
  const candidate = result.candidates[0];

  // Record event through intake
  const eventResult = recordEvent(root, {
    source: 'vision_scan',
    category: 'vision_derived',
    signal: {
      description: candidate.goal,
      vision_section: candidate.section,
      derived: true,
    },
    evidence: [
      { type: 'text', value: `Vision section: ${candidate.section} — Goal: ${candidate.goal}` },
    ],
  });

  if (!eventResult.ok) {
    // Deduplication is normal — means this goal already has an intent
    if (eventResult.deduplicated) {
      return { ok: true, idle: true };
    }
    return { ok: false, error: `intake record failed: ${eventResult.error}` };
  }

  if (eventResult.deduplicated) {
    return { ok: true, idle: true };
  }

  const intentId = eventResult.intent.intent_id;

  // Triage
  const triageResult = triageIntent(root, intentId, {
    priority: candidate.priority,
    template: 'generic',
    charter: `[vision] ${candidate.section}: ${candidate.goal}`,
    acceptance_contract: [`Vision goal addressed: ${candidate.goal}`],
  });

  if (!triageResult.ok) {
    return { ok: false, error: `triage failed: ${triageResult.error}` };
  }

  // Auto-approve if configured
  const triageApproval = options.triageApproval || 'auto';
  if (triageApproval === 'auto') {
    const approveResult = approveIntent(root, intentId, {
      approver: 'continuous_loop',
      reason: 'vision-derived auto-approval',
    });
    if (!approveResult.ok) {
      return { ok: false, error: `approve failed: ${approveResult.error}` };
    }
  }

  return {
    ok: true,
    idle: false,
    intentId,
    section: candidate.section,
    goal: candidate.goal,
  };
}

// ---------------------------------------------------------------------------
// Resolve continuous options from CLI flags + config
// ---------------------------------------------------------------------------

export function resolveContinuousOptions(opts, config) {
  const configCont = config?.run_loop?.continuous || {};

  return {
    enabled: opts.continuous ?? configCont.enabled ?? false,
    visionPath: opts.vision ?? configCont.vision_path ?? '.planning/VISION.md',
    maxRuns: opts.maxRuns ?? configCont.max_runs ?? 100,
    pollSeconds: opts.pollSeconds ?? configCont.poll_seconds ?? 30,
    maxIdleCycles: opts.maxIdleCycles ?? configCont.max_idle_cycles ?? 3,
    triageApproval: configCont.triage_approval ?? 'auto',
    cooldownSeconds: opts.cooldownSeconds ?? configCont.cooldown_seconds ?? 5,
  };
}

// ---------------------------------------------------------------------------
// Main continuous loop
// ---------------------------------------------------------------------------

/**
 * Execute the continuous vision-driven run loop.
 *
 * @param {object} context - { root, config }
 * @param {object} contOpts - resolved continuous options
 * @param {Function} executeGovernedRun - the run executor function
 * @param {Function} [log] - logging function
 * @returns {Promise<{ exitCode: number, session: object }>}
 */
export async function executeContinuousRun(context, contOpts, executeGovernedRun, log = console.log) {
  const { root } = context;
  const absVisionPath = resolveVisionPath(root, contOpts.visionPath);

  // Validate vision file exists
  if (!existsSync(absVisionPath)) {
    log(`Error: VISION.md not found at ${absVisionPath}`);
    log(`Create a .planning/VISION.md for your project to enable vision-driven operation.`);
    return { exitCode: 1, session: null };
  }

  const session = createSession(contOpts.visionPath, contOpts.maxRuns, contOpts.maxIdleCycles);
  writeContinuousSession(root, session);

  // SIGINT handler
  let stopping = false;
  const sigHandler = () => {
    stopping = true;
    log('\nStopping continuous loop (finishing current work)...');
  };
  process.on('SIGINT', sigHandler);

  try {
    while (!stopping) {
      // Check max runs
      if (session.runs_completed >= contOpts.maxRuns) {
        session.status = 'completed';
        log(`Max runs reached (${contOpts.maxRuns}). Stopping.`);
        break;
      }

      // Check max idle cycles
      if (session.idle_cycles >= contOpts.maxIdleCycles) {
        session.status = 'completed';
        log(`All vision goals appear addressed (${contOpts.maxIdleCycles} consecutive idle cycles). Stopping.`);
        break;
      }

      // Step 1: Check intake queue for pending work
      const queued = findNextQueuedIntent(root);
      let targetIntentId = null;
      let visionObjective = null;

      if (queued.ok) {
        targetIntentId = queued.intentId;
        session.idle_cycles = 0;
        log(`Found queued intent: ${queued.intentId} (${queued.status})`);
      } else {
        // Step 2: Derive from vision
        const seeded = seedFromVision(root, absVisionPath, {
          triageApproval: contOpts.triageApproval,
        });

        if (!seeded.ok) {
          log(`Vision scan error: ${seeded.error}`);
          session.status = 'stopped';
          break;
        }

        if (seeded.idle) {
          session.idle_cycles += 1;
          log(`Idle cycle ${session.idle_cycles}/${contOpts.maxIdleCycles} — no derivable work from vision.`);
          writeContinuousSession(root, session);
          if (session.idle_cycles >= contOpts.maxIdleCycles) continue;
          await new Promise(r => setTimeout(r, contOpts.pollSeconds * 1000));
          continue;
        }

        // If triage_approval is "human", the intent is in "triaged" state — don't auto-start
        if (contOpts.triageApproval === 'human') {
          log(`Vision-derived intent ${seeded.intentId} left in triaged state (triage_approval: human).`);
          session.idle_cycles += 1;
          writeContinuousSession(root, session);
          await new Promise(r => setTimeout(r, contOpts.pollSeconds * 1000));
          continue;
        }

        targetIntentId = seeded.intentId;
        visionObjective = `${seeded.section}: ${seeded.goal}`;
        session.idle_cycles = 0;
        log(`Vision-derived: ${visionObjective}`);
      }

      // Step 3: Execute governed run
      // Note: intake seeding records provenance. The governed run initializes its
      // own state via initializeGovernedRun(). We do NOT try to advance the intent
      // through plan/start — that path requires an already-active run. Instead, the
      // run itself is the execution surface, and the seeded intent provides the audit
      // trail linking each run back to a vision goal.
      session.current_run_id = null;
      session.current_vision_objective = visionObjective;
      session.status = 'running';
      writeContinuousSession(root, session);

      const provenance = {
        trigger: 'vision_scan',
        created_by: 'continuous_loop',
        vision_path: contOpts.visionPath,
        ...(visionObjective ? { trigger_reason: `vision:${visionObjective}` } : {}),
      };

      const execution = await executeGovernedRun(context, {
        autoApprove: true,
        report: true,
        provenance,
        log,
      });

      session.runs_completed += 1;
      session.current_run_id = execution.result?.state?.run_id || null;

      const stopReason = execution.result?.stop_reason;
      log(`Run ${session.runs_completed}/${contOpts.maxRuns} completed: ${stopReason || 'unknown'}`);

      if (stopReason === 'blocked') {
        session.status = 'paused';
        log('Run blocked — continuous loop paused. Use `agentxchain unblock <id>` to resume.');
        writeContinuousSession(root, session);
        break;
      }

      if (stopReason === 'priority_preempted') {
        log('Priority preemption detected — consuming injected work next cycle.');
      }

      writeContinuousSession(root, session);

      // Brief cooldown between runs
      const cooldownMs = (contOpts.cooldownSeconds ?? 5) * 1000;
      if (!stopping && session.runs_completed < contOpts.maxRuns && cooldownMs > 0) {
        await new Promise(r => setTimeout(r, cooldownMs));
      }
    }

    if (stopping) {
      session.status = 'stopped';
      log('Continuous loop stopped by operator.');
    }

    writeContinuousSession(root, session);
    return { exitCode: 0, session };

  } finally {
    process.removeListener('SIGINT', sigHandler);
  }
}

