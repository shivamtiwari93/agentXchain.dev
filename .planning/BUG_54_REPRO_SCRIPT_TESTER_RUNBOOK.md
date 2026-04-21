Status: Active — BUG-54 root-cause diagnostic runbook for testers

# BUG-54 Reproduction Script Tester Runbook

## Purpose

Tell a tester exactly how to run the installed package's
`agentxchain/scripts/reproduce-bug-54.mjs` in a failing worktree, what a
healthy capture looks like on a working machine, and how to map the resulting
JSON to a specific root-cause hypothesis.

This runbook closes the gap between "the script exists" (shipped Turn 95,
validated on real `claude` Turn 96) and "the tester ran it and shared a
JSON that names a hypothesis." It is the missing half of `DEC-BUG54-REPRO-SCRIPT-CONTRACT-001`.

## How to run it

The canonical invocation inside the failing worktree (e.g.
`tusq.dev-21480-clean`) resolves the diagnostic from the installed
`agentxchain` package, not from the AgentXchain.dev repo layout:

```bash
REPRO="$(npm root)/agentxchain/scripts/reproduce-bug-54.mjs"
[ -f "$REPRO" ] || REPRO="$(npm root -g)/agentxchain/scripts/reproduce-bug-54.mjs"
node "$REPRO" \
  --synthetic "Say READY and nothing else." \
  --attempts 10 \
  --out ./bug-54-repro.json
```

Key flags the tester may need:

- `--runtime <id>` — name of the `local_cli` runtime from `agentxchain.json`
  (auto-discovered if only one exists).
- `--turn-id <id>` — replay the prompt from an existing dispatch bundle
  instead of the synthetic fallback. Use this when the failure is
  suspected to be prompt-size or prompt-content specific.
- `--synthetic "<text>"` — run a short fixed prompt. Use this first. It
  isolates spawn/attach/auth behavior from prompt payload.
- `--attempts <N>` — default 5. Use 10+ when reproducing a reliability
  pattern; use 3 for a quick healthy-shape sanity check.
- `--watchdog-ms <ms>` — default is the adapter's effective watchdog
  (`runtimes.<id>.startup_watchdog_ms` if set, else `run_loop.startup_watchdog_ms`,
  else the adapter default). Override only if you need a longer grace
  window to see what the subprocess would eventually do.
- `--no-watchdog` — disable the watchdog entirely so the subprocess runs
  to natural completion. Useful when hypothesis 3 (slow Claude CLI `-p`
  startup) is under evaluation.
- `--out <path>` — path to write the JSON capture. Default is
  `./bug-54-repro-<iso-ts>.json`.

The script never mutates repo state, never writes to `.agentxchain/`, and
does not require the governed dispatcher to be running.

## Reference healthy capture (Turn 96, 2026-04-20)

A working machine with an authenticated `claude` runtime configured as
`command: "claude"`, `args: ["--print", "--dangerously-skip-permissions"]`,
`prompt_transport: "stdin"` produced:

```json
{
  "command_probe": {
    "kind": "claude_version",
    "status": 0,
    "stdout": "2.1.87 (Claude Code)\n",
    "timed_out": false
  },
  "summary": {
    "total": 1,
    "spawn_attached": 1,
    "stdout_attached": 1,
    "watchdog_fires": 0,
    "spawn_errors": 0,
    "process_errors": 0,
    "avg_first_stdout_ms": 3039,
    "classification": { "exit_clean_with_stdout": 1 },
    "success_rate_first_stdout": 1
  }
}
```

What that means, concretely:

- `classification.exit_clean_with_stdout` equals `attempts_planned` — every
  attempt produced real stdout and exited cleanly.
- `avg_first_stdout_ms` is in the low thousands (3.5s is typical for warm
  Claude auth). Cold starts can be higher; that is still healthy as long
  as watchdog fires stay at zero.
- `watchdog_fires`, `spawn_errors`, and `process_errors` are all zero.
- `command_probe.kind === "claude_version"` and `command_probe.stdout`
  identifies the Claude CLI build under test. This matters because BUG-56
  proved that no-env Claude Max setups are not uniformly broken; a failing
  environment may differ by CLI version or installed binary path.
- `env_snapshot.auth_env_present` may report all `false` — the healthy
  capture above does. Claude authenticates via OS keychain / OAuth, not
  `ANTHROPIC_API_KEY`. **Auth env booleans are diagnostic context only,
  never standalone proof of auth failure.**

If the tester's capture matches this shape, the `local_cli` runtime is
not broken at the spawn/attach layer and BUG-54 is not reproducing in
that environment. Report that as a negative result — it is still
evidence.

## Hypothesis triage from the JSON

Each attempt lands in exactly one classification. The mapping to the five
BUG-54 root-cause hypotheses named in `HUMAN-ROADMAP.md`:

### `spawn_attach_failed`

- Shape: `spawn_attached_at === null`, `process_error.code` is usually
  `ENOENT` / `EACCES` / `EPERM`, no output at all.
- Hypothesis: **binary path / permission problem**. Not in the listed
  five; this is a misconfiguration, not a reliability defect. Fix the
  runtime `command` before continuing.

### `spawn_error_pre_process`

- Shape: `spawn_error` populated synchronously at `spawn()` call,
  typically `ENAMETOOLONG`, `E2BIG`, `ENOMEM`.
- Hypothesis: environment / argv / stdin-size problem reachable before
  the subprocess starts. Rare. Capture and share.

### `spawn_unattached`

- Shape: `spawn_attached_at === null` but no error — the child never
  announced its pid in time. Usually a very fast-failing subprocess that
  exits before the parent hears back.
- Hypothesis 2 (stdout race): **possible** — attachment raced with exit.

### `watchdog_no_output`

- Shape: `watchdog_fired === true`, `first_stdout_at === null`,
  `first_stderr_at === null`, `exit_signal === 'SIGTERM'`.
- Hypothesis 3 (Claude CLI `-p` startup time): **most likely** — nothing
  spoken on either stream before the watchdog fired. Re-run with
  `--no-watchdog` or `--watchdog-ms 120000` to see whether the subprocess
  eventually produces output; if it does, tune `run_loop.startup_watchdog_ms`
  (or `runtimes.<id>.startup_watchdog_ms`) up to the observed startup
  time plus margin.

### `watchdog_stderr_only`

- Shape: `watchdog_fired === true`, `first_stdout_at === null`,
  `first_stderr_at` populated, `exit_signal === 'SIGTERM'`.
- Hypothesis 4 (stdin handling / EPIPE) or **auth error leaking to stderr
  before stdout ever opens**. Quote the `stderr` content — if it mentions
  auth/key/credentials, escalate to hypothesis 5.

### `exit_stderr_only`

- Shape: subprocess exited before the watchdog fired. `first_stdout_at ===
  null`, `first_stderr_at` populated, `exit_code` is usually non-zero.
- Hypothesis 5 (auth env not propagating to subprocess): **most likely**
  when `auth_env_present.*` is all `false` and `stderr` mentions
  auth/key/credentials. Also fits hypothesis 4 (EPIPE) when `process_error.code
  === 'EPIPE'` and the stderr content is empty or mentions stdin close.

### `exit_no_output`

- Shape: clean or unclean exit with zero bytes on either stream.
- Hypothesis: subprocess exited silently without producing any evidence.
  Usually a subprocess start-up crash that writes nothing. Check if the
  runtime binary launches with an IPC/log file and attach that separately.

### `exit_clean_with_stdout`

- Shape: `exit_code === 0`, `stdout_bytes > 0`. Healthy path.
- No hypothesis applies — this attempt succeeded.

### `exit_nonzero_with_stdout`

- Shape: `stdout_bytes > 0`, `exit_code` non-zero. Subprocess produced
  real output but still failed at the end.
- Hypothesis: prompt-content or runtime-specific failure that happens
  after real work started. Not a BUG-54 reliability class per se.

## Hypothesis 1 (FD exhaustion) — reading attempt ordering

Hypothesis 1 (per `HUMAN-ROADMAP.md`) is that the first attempt succeeds
and subsequent attempts regress. That is visible in the JSON as an
attempt-index sequence where `attempts[0].classification ===
'exit_clean_with_stdout'` and `attempts[N].classification` regresses
(typically to `spawn_attach_failed` or `watchdog_no_output`). If the
tester's JSON shows the failure on attempt 1 already, **hypothesis 1 is
ruled out** — that is a deterministic environmental failure, not a
leak-over-time failure.

## What to quote back to the agents

When sharing the JSON, also quote the following four things directly:

1. The `summary` block verbatim (top-level classification counts).
2. For every *first failing* attempt, the full `stderr` field. This is
   the single highest-signal piece of evidence in the capture. Do not
   truncate.
3. `command_probe` — especially `kind`, `status`, `stdout`, `stderr`,
   `error`, and `timed_out`. This is how agents compare the failing
   machine's Claude CLI version/path against a healthy no-env machine.
4. `env_snapshot.auth_env_present` — booleans only, no values, so the
   tester does not leak secrets.
5. The `resolved_command`, `resolved_args_redacted`, and
   `prompt_transport` fields so the agents can confirm the exact spawn
   shape matches the adapter's effective configuration.

A tester-quoted JSON with those five pieces is sufficient evidence for
the agents to name a hypothesis, ship the reliability fix, and publish a
release that closes BUG-54 under rule #12.

## What this runbook does not do

- It does not classify prompt-content failures. Prompt-specific bugs
  (BUG-X on a particular turn payload) need the `--turn-id` replay path,
  not the synthetic probe.
- It does not measure QA dispatch reliability end-to-end. The
  `>90% QA dispatch reliability on `v2.148.0`` closure bar in the
  release notes is a separate measurement the tester runs in their
  normal governed flow. The repro script is the root-cause diagnostic
  that runs *when* that reliability measurement keeps reproducing
  failures.
- It does not re-expose prompt content or auth values. Both are redacted
  or presence-booleans only in the JSON header.

## Related artifacts

- `cli/scripts/reproduce-bug-54.mjs` — the diagnostic script itself.
- `cli/test/reproduce-bug-54-script.test.js` — locks the classification
  vocabulary so future fixes cannot silently rename buckets.
- `.planning/BUG_54_REPRO_SCRIPT_SPEC.md` — the durable spec contract.
- `/tmp/bug-54-self-test-turn96.json` — Turn 96's reference healthy
  capture on a real `claude` runtime. Not in-tree; referenced as
  evidence only.
- `website-v2/docs/releases/v2-148-0.mdx` "Tester Re-Run Contract"
  section — release-boundary surface that points here for root-cause
  triage when QA reliability stays below 90%.
