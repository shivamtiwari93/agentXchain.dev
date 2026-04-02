#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash cli/scripts/live-api-proxy-preflight-smoke.sh [--mode happy|overflow|both] [--keep-temp]

Runs a live smoke harness for api_proxy preflight tokenization using a temp copy
of examples/governed-todo-app.
EOF
}

MODE="both"
KEEP_TEMP=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --keep-temp)
      KEEP_TEMP=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$MODE" in
  happy|overflow|both) ;;
  *)
    echo "Invalid --mode: $MODE" >&2
    usage >&2
    exit 1
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="${SCRIPT_DIR}/.."
REPO_ROOT="$(cd "${CLI_DIR}/.." && pwd)"
EXAMPLE_DIR="${REPO_ROOT}/examples/governed-todo-app"

load_repo_env() {
  local env_file="${REPO_ROOT}/.env"
  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "${value:0:1}" == "\"" && "${value: -1}" == "\"" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi

    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

make_workspace() {
  local scenario="$1"
  local workspace
  workspace="$(mktemp -d "${TMPDIR:-/tmp}/agentxchain-preflight-${scenario}-XXXXXX")"
  cp -R "${EXAMPLE_DIR}/." "$workspace"
  echo "$workspace"
}

patch_runtime_config() {
  local workspace="$1"
  local scenario="$2"

  node --input-type=commonjs - "$workspace" "$scenario" <<'NODE'
const fs = require('fs');
const path = require('path');

const workspace = process.argv[2];
const scenario = process.argv[3];
const configPath = path.join(workspace, 'agentxchain.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const runtime = config.runtimes['api-qa'];

if (!runtime || runtime.type !== 'api_proxy') {
  throw new Error('api-qa runtime missing or not api_proxy');
}

runtime.preflight_tokenization = {
  enabled: true,
  tokenizer: 'provider_local',
  safety_margin_tokens: scenario === 'happy' ? 1024 : 64,
};
runtime.context_window_tokens = scenario === 'happy' ? 200000 : 512;
runtime.max_output_tokens = scenario === 'happy' ? 2048 : 128;
if (scenario === 'happy') {
  runtime.retry_policy = {
    enabled: true,
    max_attempts: 3,
    base_delay_ms: 1000,
    max_delay_ms: 1000,
    backoff_multiplier: 1,
    jitter: 'none',
    retry_on: ['turn_result_extraction_failure'],
  };
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
NODE
}

bootstrap_to_qa() {
  local workspace="$1"

  node --input-type=commonjs - "$workspace" "$CLI_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');

async function main() {
  const workspace = process.argv[2];
  const cliDir = process.argv[3];

  const normalized = await import(pathToFileURL(path.join(cliDir, 'src/lib/normalized-config.js')).href);
  const governed = await import(pathToFileURL(path.join(cliDir, 'src/lib/governed-state.js')).href);

  const rawConfig = JSON.parse(fs.readFileSync(path.join(workspace, 'agentxchain.json'), 'utf8'));
  const loaded = normalized.loadNormalizedConfig(rawConfig);
  if (!loaded.ok) {
    throw new Error(`Config normalization failed: ${loaded.errors.join('; ')}`);
  }
  const config = loaded.normalized;

  const git = (args) => {
    execSync(args, {
      cwd: workspace,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'AgentXchain Smoke',
        GIT_AUTHOR_EMAIL: 'smoke@agentxchain.local',
        GIT_COMMITTER_NAME: 'AgentXchain Smoke',
        GIT_COMMITTER_EMAIL: 'smoke@agentxchain.local',
      },
    });
  };

  const readState = () => JSON.parse(fs.readFileSync(path.join(workspace, '.agentxchain/state.json'), 'utf8'));
  const stageResult = (state, overrides = {}) => {
    const base = {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: state.current_turn.turn_id,
      role: state.current_turn.assigned_role,
      runtime_id: state.current_turn.runtime_id,
      status: 'completed',
      summary: `Smoke bootstrap turn completed by ${state.current_turn.assigned_role}.`,
      decisions: [
        {
          id: 'DEC-001',
          category: 'process',
          statement: 'Bootstrap progressed to the next governed phase.',
          rationale: 'Live preflight smoke only needs a stable QA entry point.',
        },
      ],
      objections: [
        {
          id: 'OBJ-001',
          severity: 'low',
          statement: 'Bootstrap result is synthetic and exists only to reach QA.',
          status: 'raised',
        },
      ],
      files_changed: [],
      artifacts_created: [],
      verification: {
        status: 'pass',
        commands: ['echo smoke-bootstrap'],
        evidence_summary: 'Synthetic bootstrap succeeded.',
        machine_evidence: [{ command: 'echo smoke-bootstrap', exit_code: 0 }],
      },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      phase_transition_request: null,
      run_completion_request: false,
      needs_human_reason: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };

    fs.writeFileSync(
      path.join(workspace, '.agentxchain/staging/turn-result.json'),
      JSON.stringify({ ...base, ...overrides }, null, 2) + '\n'
    );
  };

  git('git init');
  git('git add -A');
  git('git commit --allow-empty -m "initial scaffold"');

  let result = governed.initializeGovernedRun(workspace, config);
  if (!result.ok) throw new Error(result.error);

  result = governed.assignGovernedTurn(workspace, config, 'pm');
  if (!result.ok) throw new Error(result.error);

  fs.writeFileSync(path.join(workspace, '.planning/PM_SIGNOFF.md'), '# PM Signoff\nApproved: YES\n');
  fs.writeFileSync(
    path.join(workspace, '.planning/ROADMAP.md'),
    '# Roadmap\n\n## Scope\n\nBootstrap workspace for live api_proxy preflight smoke.\n'
  );
  git('git add -A');
  git('git commit --allow-empty -m "pm artifacts"');

  stageResult(readState(), {
    summary: 'PM bootstrap completed.',
    artifacts_created: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
    artifact: { type: 'review', path: '.planning/PM_SIGNOFF.md' },
    proposed_next_role: 'human',
    phase_transition_request: 'implementation',
  });

  result = governed.acceptGovernedTurn(workspace, config);
  if (!result.ok) throw new Error(result.error);

  result = governed.approvePhaseTransition(workspace);
  if (!result.ok) throw new Error(result.error);

  git('git add -A');
  git('git commit --allow-empty -m "orchestrator: accept pm turn"');

  result = governed.assignGovernedTurn(workspace, config, 'dev');
  if (!result.ok) throw new Error(result.error);

  fs.writeFileSync(path.join(workspace, 'index.js'), 'console.log("smoke");\n');
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({
      name: 'governed-todo-app-smoke',
      version: '0.0.0-smoke',
      private: true,
      type: 'module',
      scripts: {
        test: 'node -e "console.log(\'ok\')"',
      },
    }, null, 2) + '\n'
  );
  git('git add -A');
  git('git commit --allow-empty -m "dev bootstrap"');

  stageResult(readState(), {
    summary: 'Dev bootstrap completed.',
    files_changed: ['index.js', 'package.json'],
    artifact: { type: 'commit', ref: 'smoke-bootstrap' },
    proposed_next_role: 'qa',
    phase_transition_request: 'qa',
    verification: {
      status: 'pass',
      commands: ['node index.js'],
      evidence_summary: 'Bootstrap implementation is runnable.',
      machine_evidence: [{ command: 'node index.js', exit_code: 0 }],
    },
  });

  result = governed.acceptGovernedTurn(workspace, config);
  if (!result.ok) throw new Error(result.error);

  git('git add -A');
  git('git commit --allow-empty -m "orchestrator: accept dev turn"');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
NODE
}

run_scenario() {
  local scenario="$1"
  local workspace="$2"

  node --input-type=commonjs - "$workspace" "$CLI_DIR" "$scenario" <<'NODE'
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const workspace = process.argv[2];
  const cliDir = process.argv[3];
  const scenario = process.argv[4];

  const normalized = await import(pathToFileURL(path.join(cliDir, 'src/lib/normalized-config.js')).href);
  const governed = await import(pathToFileURL(path.join(cliDir, 'src/lib/governed-state.js')).href);
  const dispatchBundle = await import(pathToFileURL(path.join(cliDir, 'src/lib/dispatch-bundle.js')).href);
  const apiProxy = await import(pathToFileURL(path.join(cliDir, 'src/lib/adapters/api-proxy-adapter.js')).href);
  const validator = await import(pathToFileURL(path.join(cliDir, 'src/lib/turn-result-validator.js')).href);

  const rawConfig = JSON.parse(fs.readFileSync(path.join(workspace, 'agentxchain.json'), 'utf8'));
  const loaded = normalized.loadNormalizedConfig(rawConfig);
  if (!loaded.ok) {
    throw new Error(`Config normalization failed: ${loaded.errors.join('; ')}`);
  }
  const config = loaded.normalized;
  let promptOverride = null;

  let assign = governed.assignGovernedTurn(workspace, config, 'qa');
  if (!assign.ok) {
    throw new Error(assign.error);
  }

  if (scenario === 'happy') {
    // Use a literal PROMPT.md override for the live happy path so the smoke
    // harness exercises adapter/preflight behavior instead of general QA
    // prompt-following variance.
    const runId = assign.state.run_id;
    const turnId = assign.state.current_turn.turn_id;
    promptOverride = `# Live QA Smoke Prompt Override

Return ONLY the JSON object below EXACTLY as written.
Do not add any text before or after it.
Do not wrap it in markdown fences.
Do not change field names, values, array element types, or nulls.
In particular, \`artifacts_created\` must remain an empty array of strings.

{
  "schema_version": "1.0",
  "run_id": "${runId}",
  "turn_id": "${turnId}",
  "role": "qa",
  "runtime_id": "api-qa",
  "status": "completed",
  "summary": "QA smoke response returned exact governed JSON for live preflight validation.",
  "decisions": [
    {
      "id": "DEC-001",
      "category": "quality",
      "statement": "Happy-path smoke dispatch succeeded.",
      "rationale": "This harness validates provider-backed preflight send plus governed JSON extraction."
    }
  ],
  "objections": [
    {
      "id": "OBJ-001",
      "severity": "low",
      "statement": "This is a synthetic smoke artifact, not a substantive QA verdict.",
      "status": "raised"
    }
  ],
  "files_changed": [],
  "artifacts_created": [],
  "verification": {
    "status": "skipped",
    "commands": [],
    "evidence_summary": "Smoke harness response only; no verification commands were run.",
    "machine_evidence": []
  },
  "artifact": {
    "type": "review",
    "ref": null
  },
  "proposed_next_role": "human",
  "phase_transition_request": null,
  "run_completion_request": null,
  "needs_human_reason": null,
  "cost": {
    "input_tokens": 0,
    "output_tokens": 0,
    "usd": 0
  }
}
`;
  } else if (scenario === 'overflow') {
    const filler = '\n\n## Overflow Filler\n' + 'This line intentionally inflates the QA prompt.\n'.repeat(800);
    fs.appendFileSync(path.join(workspace, '.agentxchain/prompts/qa.md'), filler);
  }

  const bundle = dispatchBundle.writeDispatchBundle(workspace, assign.state, config);
  if (!bundle.ok) {
    throw new Error(bundle.error);
  }
  if (promptOverride) {
    fs.writeFileSync(
      path.join(workspace, '.agentxchain/dispatch/current/PROMPT.md'),
      promptOverride
    );
  }

  const dispatch = await apiProxy.dispatchApiProxy(workspace, assign.state, config);
  const tokenBudgetPath = path.join(workspace, '.agentxchain/dispatch/current/TOKEN_BUDGET.json');
  const effectiveContextPath = path.join(workspace, '.agentxchain/dispatch/current/CONTEXT.effective.md');
  const providerResponsePath = path.join(workspace, '.agentxchain/staging/provider-response.json');
  const stagedResultPath = path.join(workspace, '.agentxchain/staging/turn-result.json');

  if (!fs.existsSync(tokenBudgetPath)) {
    throw new Error('TOKEN_BUDGET.json missing');
  }
  if (!fs.existsSync(effectiveContextPath)) {
    throw new Error('CONTEXT.effective.md missing');
  }

  const report = JSON.parse(fs.readFileSync(tokenBudgetPath, 'utf8'));
  const sentToProvider = report.sent_to_provider === true;
  const providerResponseExists = fs.existsSync(providerResponsePath);
  const stagedResultExists = fs.existsSync(stagedResultPath);

  if (scenario === 'happy') {
    if (!dispatch.ok) {
      throw new Error(`Happy-path dispatch failed: ${dispatch.error}`);
    }
    if (!sentToProvider) {
      throw new Error('Happy-path report indicates sent_to_provider = false');
    }
    if (!providerResponseExists) {
      throw new Error('provider-response.json missing for happy path');
    }
    if (!stagedResultExists) {
      throw new Error('turn-result.json missing for happy path');
    }

    const validation = validator.validateStagedTurnResult(workspace, assign.state, config);
    console.log(JSON.stringify({
      mode: scenario,
      workspace,
      dispatch_ok: true,
      validation_ok: validation.ok === true,
      error_class: null,
      sent_to_provider: true,
      token_budget_path: tokenBudgetPath,
      effective_context_path: effectiveContextPath,
      provider_response_path: providerResponsePath,
      staged_result_path: stagedResultPath,
    }, null, 2));
    return;
  }

  if (dispatch.ok) {
    throw new Error('Overflow-path dispatch unexpectedly succeeded');
  }
  if (dispatch.classified?.error_class !== 'context_overflow') {
    throw new Error(`Expected context_overflow, got ${dispatch.classified?.error_class || 'unknown'}`);
  }
  if (sentToProvider) {
    throw new Error('Overflow-path report indicates sent_to_provider = true');
  }
  if (providerResponseExists) {
    throw new Error('provider-response.json should not exist for overflow path');
  }

  console.log(JSON.stringify({
    mode: scenario,
    workspace,
    dispatch_ok: false,
    error_class: dispatch.classified?.error_class || null,
    sent_to_provider: false,
    token_budget_path: tokenBudgetPath,
    effective_context_path: effectiveContextPath,
    provider_response_path: providerResponsePath,
    staged_result_path: stagedResultPath,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
NODE
}

cleanup_workspace() {
  local workspace="$1"
  if [[ "$KEEP_TEMP" -eq 1 ]]; then
    return 0
  fi
  rm -rf "$workspace"
}

require_cmd node
require_cmd git
load_repo_env

if [[ "$MODE" != "overflow" && -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ANTHROPIC_API_KEY is not set. Load it in the shell or repo-root .env before running this harness." >&2
  exit 1
fi

echo "Live api_proxy preflight smoke"
echo "Mode: $MODE"

if [[ "$MODE" == "happy" || "$MODE" == "both" ]]; then
  HAPPY_WORKSPACE="$(make_workspace happy)"
  echo "Happy workspace: $HAPPY_WORKSPACE"
  patch_runtime_config "$HAPPY_WORKSPACE" happy
  bootstrap_to_qa "$HAPPY_WORKSPACE"
  run_scenario happy "$HAPPY_WORKSPACE"
  cleanup_workspace "$HAPPY_WORKSPACE"
fi

if [[ "$MODE" == "overflow" || "$MODE" == "both" ]]; then
  OVERFLOW_WORKSPACE="$(make_workspace overflow)"
  echo "Overflow workspace: $OVERFLOW_WORKSPACE"
  patch_runtime_config "$OVERFLOW_WORKSPACE" overflow
  bootstrap_to_qa "$OVERFLOW_WORKSPACE"
  run_scenario overflow "$OVERFLOW_WORKSPACE"
  cleanup_workspace "$OVERFLOW_WORKSPACE"
fi
