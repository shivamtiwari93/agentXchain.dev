/**
 * Hook execution engine for AgentXchain governed orchestration.
 *
 * Implements the repo-local hook lifecycle per PLUGIN_HOOK_SYSTEM_SPEC.md:
 *   - Spawns hook processes with JSON stdin / JSON stdout contract
 *   - Enforces SHA-256 tamper detection on protected files
 *   - Records all invocations in hook-audit.jsonl
 *   - Records after_acceptance annotations in hook-annotations.jsonl
 *   - Enforces time-bounded execution with subprocess timeout
 *   - Advisory hooks cannot block; blocking verdict is downgraded to warn
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join, isAbsolute, dirname } from 'path';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';

// ── Constants ────────────────────────────────────────────────────────────────

const HOOK_AUDIT_PATH = '.agentxchain/hook-audit.jsonl';
const HOOK_ANNOTATIONS_PATH = '.agentxchain/hook-annotations.jsonl';
const SIGKILL_GRACE_MS = 2000;

const VALID_HOOK_PHASES = [
  'before_assignment',
  'after_dispatch',
  'before_validation',
  'after_validation',
  'before_acceptance',
  'after_acceptance',
  'before_gate',
  'on_escalation',
];

const NON_BLOCKING_PHASES = new Set(['after_acceptance', 'on_escalation']);
const MAX_HOOKS_PER_PHASE = 8;
const VALID_VERDICTS = new Set(['allow', 'warn', 'block']);
const ANNOTATION_KEY_RE = /^[a-z0-9_-]+$/;
const MAX_ANNOTATIONS = 16;
const MAX_ANNOTATION_VALUE_LENGTH = 1000;
const MAX_STDERR_CAPTURE = 4096;

// ── Protected Files ──────────────────────────────────────────────────────────

const PROTECTED_FILES = [
  '.agentxchain/state.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
];

// ── Executable Resolution ────────────────────────────────────────────────────

/**
 * Resolve a hook command[0] to verify it is an executable.
 * Resolution order:
 *   1. If absolute path → check existsSync
 *   2. If relative path (contains '/') → resolve against projectRoot, check existsSync
 *   3. Otherwise → look up via `which` (PATH resolution)
 *
 * @param {string} executable - the command[0] value
 * @param {string|null} projectRoot - project root for relative resolution
 * @returns {{ resolved: boolean, path?: string, error?: string }}
 */
export function resolveExecutable(executable, projectRoot) {
  if (!executable || typeof executable !== 'string') {
    return { resolved: false, error: 'executable must be a non-empty string' };
  }

  // Absolute path
  if (isAbsolute(executable)) {
    if (existsSync(executable)) {
      return { resolved: true, path: executable };
    }
    return { resolved: false, error: `absolute path does not exist: ${executable}` };
  }

  // Relative path (contains a slash) — resolve against project root
  if (executable.includes('/') && projectRoot) {
    const resolved = join(projectRoot, executable);
    if (existsSync(resolved)) {
      return { resolved: true, path: resolved };
    }
    return { resolved: false, error: `relative path does not exist: ${executable} (resolved to ${resolved})` };
  }

  // Bare command name — look up via PATH using `which`
  try {
    const result = spawnSync('which', [executable], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (result.status === 0 && result.stdout.trim()) {
      return { resolved: true, path: result.stdout.trim() };
    }
  } catch {
    // which not available or failed — fall through
  }

  return { resolved: false, error: `command not found in PATH: ${executable}` };
}

// ── Config Validation ────────────────────────────────────────────────────────

/**
 * Validate the hooks section of a governed config.
 * When projectRoot is provided, also resolves command[0] to verify executables exist.
 * Returns { ok, errors }.
 */
export function validateHooksConfig(hooks, projectRoot) {
  const errors = [];

  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    errors.push('hooks must be an object');
    return { ok: false, errors };
  }

  for (const [phase, hookList] of Object.entries(hooks)) {
    if (!VALID_HOOK_PHASES.includes(phase)) {
      errors.push(`hooks: unknown phase "${phase}". Valid phases: ${VALID_HOOK_PHASES.join(', ')}`);
      continue;
    }

    if (!Array.isArray(hookList)) {
      errors.push(`hooks.${phase} must be an array`);
      continue;
    }

    if (hookList.length > MAX_HOOKS_PER_PHASE) {
      errors.push(`hooks.${phase}: maximum ${MAX_HOOKS_PER_PHASE} hooks per phase`);
    }

    const names = new Set();
    for (let i = 0; i < hookList.length; i++) {
      const hook = hookList[i];
      const label = `hooks.${phase}[${i}]`;

      if (!hook || typeof hook !== 'object' || Array.isArray(hook)) {
        errors.push(`${label} must be an object`);
        continue;
      }

      // name
      if (typeof hook.name !== 'string' || !hook.name.trim()) {
        errors.push(`${label}: name must be a non-empty string`);
      } else if (!/^[a-z0-9_-]+$/.test(hook.name)) {
        errors.push(`${label}: name must match ^[a-z0-9_-]+$`);
      } else if (names.has(hook.name)) {
        errors.push(`${label}: duplicate hook name "${hook.name}" in phase ${phase}`);
      } else {
        names.add(hook.name);
      }

      // type
      if (hook.type !== 'process') {
        errors.push(`${label}: type must be "process" (v2 only supports process hooks)`);
      }

      // command (argv array)
      if (!Array.isArray(hook.command) || hook.command.length === 0) {
        errors.push(`${label}: command must be a non-empty array of strings`);
      } else {
        let commandValid = true;
        for (let j = 0; j < hook.command.length; j++) {
          if (typeof hook.command[j] !== 'string') {
            errors.push(`${label}: command[${j}] must be a string`);
            commandValid = false;
          }
        }
        // Resolve command[0] as executable when projectRoot is available
        if (commandValid && projectRoot) {
          const resolution = resolveExecutable(hook.command[0], projectRoot);
          if (!resolution.resolved) {
            errors.push(`${label}: ${resolution.error}`);
          }
        }
      }

      // timeout_ms
      if (!Number.isInteger(hook.timeout_ms) || hook.timeout_ms < 100 || hook.timeout_ms > 30000) {
        errors.push(`${label}: timeout_ms must be an integer between 100 and 30000`);
      }

      // mode
      if (hook.mode !== 'blocking' && hook.mode !== 'advisory') {
        errors.push(`${label}: mode must be "blocking" or "advisory"`);
      } else if (hook.mode === 'blocking' && NON_BLOCKING_PHASES.has(phase)) {
        errors.push(`${label}: phase "${phase}" does not support blocking hooks`);
      }

      // env (optional)
      if ('env' in hook && hook.env !== undefined) {
        if (!hook.env || typeof hook.env !== 'object' || Array.isArray(hook.env)) {
          errors.push(`${label}: env must be an object`);
        } else {
          for (const [k, v] of Object.entries(hook.env)) {
            if (typeof v !== 'string') {
              errors.push(`${label}: env.${k} must be a string`);
            }
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// ── SHA-256 Digest Helpers ───────────────────────────────────────────────────

function computeFileDigest(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function captureProtectedSnapshots(root, extraProtectedPaths = []) {
  const snapshots = {};
  const protectedPaths = [...new Set([...PROTECTED_FILES, ...extraProtectedPaths])];
  for (const relPath of protectedPaths) {
    const absPath = join(root, relPath);
    snapshots[relPath] = existsSync(absPath) ? readFileSync(absPath) : null;
  }
  return snapshots;
}

function captureProtectedDigests(root, extraProtectedPaths = []) {
  const digests = {};
  const protectedPaths = [...new Set([...PROTECTED_FILES, ...extraProtectedPaths])];
  for (const relPath of protectedPaths) {
    digests[relPath] = computeFileDigest(join(root, relPath));
  }
  return digests;
}

function verifyProtectedDigests(root, preDigests, extraProtectedPaths = []) {
  const protectedPaths = [...new Set([...PROTECTED_FILES, ...extraProtectedPaths])];
  for (const relPath of protectedPaths) {
    const postDigest = computeFileDigest(join(root, relPath));
    if (preDigests[relPath] !== postDigest) {
      const errorCode = relPath.endsWith('state.json')
        ? 'hook_state_tamper'
        : relPath.endsWith('history.jsonl')
          ? 'hook_history_tamper'
          : relPath.endsWith('decision-ledger.jsonl')
            ? 'hook_ledger_tamper'
            : 'hook_bundle_tamper';
      return {
        tampered: true,
        file: relPath,
        error_code: errorCode,
        message: `Hook tampered with protected file ${relPath} (SHA-256 digest mismatch)`,
      };
    }
  }
  return { tampered: false };
}

function restoreProtectedSnapshots(root, snapshots) {
  for (const [relPath, content] of Object.entries(snapshots || {})) {
    const absPath = join(root, relPath);
    if (content === null) {
      if (existsSync(absPath)) {
        rmSync(absPath, { force: true });
      }
      continue;
    }

    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }
}

// ── Audit Trail ──────────────────────────────────────────────────────────────

function appendAuditEntry(root, entry, auditDir) {
  const dir = auditDir || join(root, '.agentxchain');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = auditDir
    ? join(auditDir, 'hook-audit.jsonl')
    : join(root, HOOK_AUDIT_PATH);
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

function appendAnnotationEntry(root, entry, auditDir) {
  const dir = auditDir || join(root, '.agentxchain');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = auditDir
    ? join(auditDir, 'hook-annotations.jsonl')
    : join(root, HOOK_ANNOTATIONS_PATH);
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

// ── Verdict Parsing ──────────────────────────────────────────────────────────

function parseVerdict(stdout) {
  if (!stdout || !stdout.trim()) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (!parsed || typeof parsed !== 'object') return null;
    if (!VALID_VERDICTS.has(parsed.verdict)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validateAnnotations(annotations) {
  if (!Array.isArray(annotations)) return [];
  const valid = [];
  for (let i = 0; i < Math.min(annotations.length, MAX_ANNOTATIONS); i++) {
    const ann = annotations[i];
    if (!ann || typeof ann !== 'object') continue;
    if (typeof ann.key !== 'string' || !ANNOTATION_KEY_RE.test(ann.key)) continue;
    if (typeof ann.value !== 'string') continue;
    valid.push({
      key: ann.key,
      value: ann.value.slice(0, MAX_ANNOTATION_VALUE_LENGTH),
    });
  }
  return valid;
}

// ── Hook Execution ───────────────────────────────────────────────────────────

/**
 * Execute a single hook process.
 *
 * @param {string} root - project root
 * @param {object} hookDef - hook config definition
 * @param {object} payload - JSON payload for stdin
 * @returns {object} execution result
 */
function executeHookProcess(root, hookDef, payload) {
  const stdinData = JSON.stringify(payload);
  const env = {
    ...process.env,
    AGENTXCHAIN_HOOK_PHASE: payload.hook_phase,
    AGENTXCHAIN_HOOK_NAME: hookDef.name,
    AGENTXCHAIN_RUN_ID: payload.run_id || '',
    AGENTXCHAIN_PROJECT_ROOT: root,
    ...(hookDef.env || {}),
  };

  const startTime = Date.now();
  const result = spawnSync(hookDef.command[0], hookDef.command.slice(1), {
    cwd: root,
    env,
    input: stdinData,
    timeout: hookDef.timeout_ms + SIGKILL_GRACE_MS,
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    killSignal: 'SIGTERM',
  });
  const durationMs = Date.now() - startTime;

  const timedOut = result.error?.code === 'ETIMEDOUT' || durationMs > hookDef.timeout_ms;
  const stdout = result.stdout ? result.stdout.toString('utf8') : '';
  const stderr = result.stderr ? result.stderr.toString('utf8').slice(0, MAX_STDERR_CAPTURE) : '';
  const exitCode = result.status;

  return {
    timedOut,
    stdout,
    stderr,
    exitCode,
    durationMs,
    processError: result.error ? result.error.message : null,
  };
}

// ── Main Hook Runner ─────────────────────────────────────────────────────────

/**
 * Run all hooks for a given phase.
 *
 * @param {string} root - project root
 * @param {object} config - normalized config (must have raw hooks in rawConfig or config.hooks)
 * @param {string} phase - hook phase name
 * @param {object} payload - phase-specific payload (without envelope fields)
 * @param {object} [options] - additional options
 * @param {string} [options.run_id] - run ID
 * @param {string} [options.turn_id] - turn ID (for audit)
 * @param {string} [options.auditDir] - custom directory for audit/annotation files (default: <root>/.agentxchain)
 * @returns {{ ok: boolean, blocked?: boolean, blocker?: object, tamper?: object, results: object[] }}
 */
export function runHooks(root, hooksConfig, phase, payload, options = {}) {
  const hookList = hooksConfig?.[phase];
  if (!hookList || !Array.isArray(hookList) || hookList.length === 0) {
    return { ok: true, blocked: false, results: [] };
  }

  const results = [];
  const now = () => new Date().toISOString();
  const _auditDir = options.auditDir || null;
  const protectedPaths = Array.isArray(options.protectedPaths)
    ? options.protectedPaths.filter((relPath) => typeof relPath === 'string' && relPath.trim())
    : [];

  for (const hookDef of hookList) {
    // Capture protected file digests before hook execution
    const preSnapshots = captureProtectedSnapshots(root, protectedPaths);
    const preDigests = captureProtectedDigests(root, protectedPaths);

    // Build envelope payload
    const envelope = {
      hook_phase: phase,
      hook_name: hookDef.name,
      run_id: options.run_id || '',
      project_root: root,
      timestamp: now(),
      payload,
    };

    // Execute hook process
    const exec = executeHookProcess(root, hookDef, envelope);

    // Verify tamper detection
    const tamperCheck = verifyProtectedDigests(root, preDigests, protectedPaths);
    if (tamperCheck.tampered) {
      restoreProtectedSnapshots(root, preSnapshots);
      const auditEntry = {
        timestamp: now(),
        hook_phase: phase,
        hook_name: hookDef.name,
        run_id: options.run_id || '',
        turn_id: options.turn_id || null,
        duration_ms: exec.durationMs,
        verdict: null,
        message: `${tamperCheck.message}. Protected content restored.`,
        annotations: [],
        exit_code: exec.exitCode,
        timed_out: exec.timedOut,
        stderr_excerpt: exec.stderr,
        orchestrator_action: 'aborted_tamper',
      };
      appendAuditEntry(root, auditEntry, _auditDir);
      results.push(auditEntry);

      return {
        ok: false,
        blocked: false,
        tamper: tamperCheck,
        results,
      };
    }

    // Parse verdict
    let verdict;
    let message = null;
    let annotations = [];
    let orchestratorAction;

    if (exec.timedOut) {
      // Timeout: fail-closed for blocking, warn for advisory
      verdict = hookDef.mode === 'blocking' ? 'block' : 'warn';
      message = `Hook "${hookDef.name}" timed out after ${hookDef.timeout_ms}ms`;
      orchestratorAction = hookDef.mode === 'blocking' ? 'blocked_timeout' : 'warned_timeout';
    } else if (exec.exitCode !== 0 || exec.processError) {
      // Process failure: same treatment as timeout
      verdict = hookDef.mode === 'blocking' ? 'block' : 'warn';
      message = `Hook "${hookDef.name}" failed (exit code ${exec.exitCode})`;
      orchestratorAction = hookDef.mode === 'blocking' ? 'blocked_failure' : 'warned_failure';
    } else {
      const parsed = parseVerdict(exec.stdout);
      if (!parsed) {
        // Invalid output: treat as process failure
        verdict = hookDef.mode === 'blocking' ? 'block' : 'warn';
        message = `Hook "${hookDef.name}" produced invalid JSON output`;
        orchestratorAction = hookDef.mode === 'blocking' ? 'blocked_invalid_output' : 'warned_invalid_output';
      } else {
        verdict = parsed.verdict;
        message = parsed.message || null;
        annotations = validateAnnotations(parsed.annotations);

        // Advisory hooks cannot block — downgrade to warn
        if (hookDef.mode === 'advisory' && verdict === 'block') {
          verdict = 'warn';
          orchestratorAction = 'downgraded_block_to_warn';
        } else if (verdict === 'block') {
          orchestratorAction = 'blocked';
        } else if (verdict === 'warn') {
          orchestratorAction = 'warned';
        } else {
          orchestratorAction = 'continued';
        }
      }
    }

    // Build audit entry
    const auditEntry = {
      timestamp: now(),
      hook_phase: phase,
      hook_name: hookDef.name,
      run_id: options.run_id || '',
      turn_id: options.turn_id || null,
      duration_ms: exec.durationMs,
      verdict,
      message,
      annotations,
      exit_code: exec.exitCode,
      timed_out: exec.timedOut,
      stderr_excerpt: exec.stderr,
      orchestrator_action: orchestratorAction,
    };
    appendAuditEntry(root, auditEntry, _auditDir);
    results.push(auditEntry);

    // Record annotations in hook-annotations.jsonl for after_acceptance phase
    if (phase === 'after_acceptance' && annotations.length > 0) {
      appendAnnotationEntry(root, {
        timestamp: now(),
        turn_id: options.turn_id || null,
        hook_name: hookDef.name,
        annotations,
      }, _auditDir);
    }

    // Blocking hook returns block → short-circuit remaining hooks
    if (verdict === 'block' && hookDef.mode === 'blocking') {
      // Record skipped hooks in audit
      const hookIndex = hookList.indexOf(hookDef);
      for (let i = hookIndex + 1; i < hookList.length; i++) {
        const skipped = {
          timestamp: now(),
          hook_phase: phase,
          hook_name: hookList[i].name,
          run_id: options.run_id || '',
          turn_id: options.turn_id || null,
          duration_ms: 0,
          verdict: null,
          message: `Skipped: prior hook "${hookDef.name}" blocked`,
          annotations: [],
          exit_code: null,
          timed_out: false,
          stderr_excerpt: '',
          orchestrator_action: 'skipped',
        };
        appendAuditEntry(root, skipped, _auditDir);
        results.push(skipped);
      }

      return {
        ok: false,
        blocked: true,
        blocker: {
          hook_name: hookDef.name,
          verdict,
          message,
        },
        results,
      };
    }
  }

  return { ok: true, blocked: false, results };
}

// ── Exports for testing ──────────────────────────────────────────────────────

export {
  HOOK_AUDIT_PATH,
  HOOK_ANNOTATIONS_PATH,
  VALID_HOOK_PHASES,
  NON_BLOCKING_PHASES,
  PROTECTED_FILES,
  captureProtectedDigests,
  verifyProtectedDigests,
  parseVerdict,
  validateAnnotations,
};
