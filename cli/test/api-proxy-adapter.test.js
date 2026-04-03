import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  dispatchApiProxy,
  extractTurnResult,
  buildAnthropicRequest,
  buildOpenAiRequest,
  classifyError,
  classifyHttpError,
  COST_RATES,
} from '../src/lib/adapters/api-proxy-adapter.js';
import { renderContextSections } from '../src/lib/context-section-parser.js';
import { countTokens } from '../src/lib/token-counter.js';
import { SYSTEM_PROMPT, SEPARATOR } from '../src/lib/token-budget.js';
import {
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
  getDispatchPromptPath,
  getDispatchTokenBudgetPath,
  getDispatchTurnDir,
  getTurnApiErrorPath,
  getTurnProviderResponsePath,
  getTurnRetryTracePath,
  getTurnStagingResultPath,
} from '../src/lib/turn-paths.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-api-proxy-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function makeApiState(overrides = {}) {
  return {
    run_id: 'run_test123',
    status: 'active',
    phase: 'qa',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn_test001',
      assigned_role: 'qa',
      status: 'running',
      attempt: 1,
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 600000).toISOString(),
      runtime_id: 'api-qa',
    },
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
    ...overrides,
  };
}

function makeApiConfig(runtimeOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test', default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA',
        mandate: 'Review the implementation.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-qa',
      },
    },
    runtimes: {
      'api-qa': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 5,
        ...runtimeOverrides,
      },
    },
  };
}

function makeTurnResult(state) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: state.current_turn.turn_id,
    role: state.current_turn.assigned_role,
    runtime_id: state.current_turn.runtime_id,
    status: 'completed',
    summary: 'Reviewed code',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: [], evidence_summary: 'Review complete.' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function setupDispatchBundle(root, overrides = {}) {
  const dispatchDir = join(root, getDispatchTurnDir('turn_test001'));
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(join(dispatchDir, 'PROMPT.md'), overrides.promptMd || '# Prompt\nReturn valid turn JSON.');
  writeFileSync(join(dispatchDir, 'CONTEXT.md'), overrides.contextMd || buildStructuredContext());
}

function dispatchPromptPath(state) {
  return getDispatchPromptPath(state.current_turn.turn_id);
}

function dispatchContextPath(state) {
  return getDispatchContextPath(state.current_turn.turn_id);
}

function tokenBudgetPath(state) {
  return getDispatchTokenBudgetPath(state.current_turn.turn_id);
}

function effectiveContextPath(state) {
  return getDispatchEffectiveContextPath(state.current_turn.turn_id);
}

function apiErrorPath(state) {
  return getTurnApiErrorPath(state.current_turn.turn_id);
}

function stagingResultPath(state) {
  return getTurnStagingResultPath(state.current_turn.turn_id);
}

function retryTracePath(state) {
  return getTurnRetryTracePath(state.current_turn.turn_id);
}

function buildStructuredContext(overrides = {}) {
  const sections = [
    {
      id: 'current_state',
      required: true,
      content: overrides.currentStateContent || [
        '- **Phase:** qa',
        '- **Assigned role:** qa',
        '- **Attempt:** 1',
      ].join('\n'),
    },
    {
      id: 'budget',
      required: false,
      content: overrides.budgetContent || [
        '- **Budget spent:** $0.00',
        '- **Budget remaining:** $50.00',
      ].join('\n'),
    },
    {
      id: 'last_turn_header',
      required: true,
      content: overrides.lastTurnHeaderContent || [
        '- **Turn:** turn_prev',
        '- **Role:** pm',
      ].join('\n'),
    },
    {
      id: 'last_turn_summary',
      required: false,
      content: overrides.lastTurnSummaryContent || '- **Summary:** Prior review summary.',
    },
    {
      id: 'last_turn_decisions',
      required: false,
      content: overrides.lastTurnDecisionsContent || [
        '- **Decisions:**',
        '  - Keep the governed workflow.',
      ].join('\n'),
    },
    {
      id: 'last_turn_objections',
      required: false,
      content: overrides.lastTurnObjectionsContent || [
        '- **Objections:**',
        '  - No blocking objections.',
      ].join('\n'),
    },
    {
      id: 'gate_required_files',
      required: false,
      content: overrides.gateRequiredFilesContent || [
        '- `.planning/RELEASE.md`',
      ].join('\n'),
    },
    {
      id: 'phase_gate_status',
      required: false,
      content: overrides.phaseGateStatusContent || [
        '- **Status:** ready',
      ].join('\n'),
    },
  ];

  return renderContextSections(sections.filter((section) => section.content));
}

function makeJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function makeTextResponse(status, text) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      throw new Error('invalid json');
    },
    async text() {
      return text;
    },
  };
}

let tmpDirs = [];
function createAndTrack() {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

const originalFetch = global.fetch;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
  global.fetch = originalFetch;
  if (originalAnthropicKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

// ── Tests: extractTurnResult ───────────────────────────────────────────────

describe('extractTurnResult', () => {
  const validTurnResult = {
    schema_version: '1.0',
    run_id: 'run_test',
    turn_id: 'turn_test',
    role: 'qa',
    runtime_id: 'api-qa',
    status: 'completed',
    summary: 'Reviewed code',
    decisions: [],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Minor concern', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'skipped', commands: [], evidence_summary: 'Review turn' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };

  it('extracts pure JSON response', () => {
    const response = {
      content: [{ type: 'text', text: JSON.stringify(validTurnResult) }],
    };
    const result = extractTurnResult(response);
    assert.equal(result.ok, true);
    assert.equal(result.turnResult.schema_version, '1.0');
    assert.equal(result.turnResult.role, 'qa');
  });

  it('extracts JSON from markdown code fence', () => {
    const response = {
      content: [{
        type: 'text',
        text: 'Here is my turn result:\n\n```json\n' + JSON.stringify(validTurnResult) + '\n```\n\nThat is my review.',
      }],
    };
    const result = extractTurnResult(response);
    assert.equal(result.ok, true);
    assert.equal(result.turnResult.role, 'qa');
  });

  it('extracts JSON from embedded braces', () => {
    const response = {
      content: [{
        type: 'text',
        text: 'My analysis follows.\n\n' + JSON.stringify(validTurnResult) + '\n\nEnd of turn.',
      }],
    };
    const result = extractTurnResult(response);
    assert.equal(result.ok, true);
    assert.equal(result.turnResult.schema_version, '1.0');
  });

  it('fails on missing content blocks', () => {
    const result = extractTurnResult({});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('no content blocks'));
  });

  it('fails on no text block', () => {
    const result = extractTurnResult({ content: [{ type: 'tool_use', id: 'x' }] });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('no text content'));
  });

  it('fails on non-JSON text', () => {
    const result = extractTurnResult({
      content: [{ type: 'text', text: 'I could not complete the review. Sorry!' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Could not extract'));
  });

  it('fails on JSON without schema_version', () => {
    const result = extractTurnResult({
      content: [{ type: 'text', text: '{"not_a_turn_result": true}' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Could not extract'));
  });

  it('extracts OpenAI chat completions JSON content', () => {
    const result = extractTurnResult({
      choices: [{
        message: {
          content: JSON.stringify(validTurnResult),
        },
      }],
    }, 'openai');
    assert.equal(result.ok, true);
    assert.equal(result.turnResult.role, 'qa');
  });

  it('fails when OpenAI response has no choices', () => {
    const result = extractTurnResult({}, 'openai');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('no choices'));
  });
});

// ── Tests: buildAnthropicRequest ───────────────────────────────────────────

describe('buildAnthropicRequest', () => {
  it('builds correct request shape', () => {
    const req = buildAnthropicRequest('# Prompt', '# Context', 'claude-sonnet-4-6', 4096);
    assert.equal(req.model, 'claude-sonnet-4-6');
    assert.equal(req.max_tokens, 4096);
    assert.equal(req.system, SYSTEM_PROMPT);
    assert.equal(req.messages.length, 1);
    assert.equal(req.messages[0].role, 'user');
    assert.equal(req.messages[0].content, `# Prompt${SEPARATOR}# Context`);
  });

  it('handles empty context', () => {
    const req = buildAnthropicRequest('# Prompt only', '', 'claude-sonnet-4-6', 2048);
    assert.equal(req.messages[0].content, '# Prompt only');
  });
});

describe('buildOpenAiRequest', () => {
  it('builds correct OpenAI chat completions request shape', () => {
    const req = buildOpenAiRequest('# Prompt', '# Context', 'gpt-4o-mini', 2048);
    assert.equal(req.model, 'gpt-4o-mini');
    assert.equal(req.max_completion_tokens, 2048);
    assert.deepEqual(req.response_format, { type: 'json_object' });
    assert.equal(req.messages.length, 2);
    assert.equal(req.messages[0].role, 'developer');
    assert.equal(req.messages[0].content, SYSTEM_PROMPT);
    assert.equal(req.messages[1].role, 'user');
    assert.equal(req.messages[1].content, `# Prompt${SEPARATOR}# Context`);
  });
});

// ── Tests: COST_RATES ──────────────────────────────────────────────────────

describe('COST_RATES', () => {
  it('has rates for supported models', () => {
    assert.ok(COST_RATES['claude-sonnet-4-6']);
    assert.ok(COST_RATES['claude-opus-4-6']);
    assert.equal(typeof COST_RATES['claude-sonnet-4-6'].input_per_1m, 'number');
    assert.equal(typeof COST_RATES['claude-sonnet-4-6'].output_per_1m, 'number');
  });

  it('computes reasonable cost for sonnet', () => {
    const rates = COST_RATES['claude-sonnet-4-6'];
    const cost = (8000 / 1_000_000) * rates.input_per_1m + (1500 / 1_000_000) * rates.output_per_1m;
    assert.ok(cost > 0);
    assert.ok(cost < 1);
  });
});

// ── Tests: classifyError ──────────────────────────────────────────────────

describe('classifyError', () => {
  it('builds correct shape with all fields', () => {
    const err = classifyError(
      'auth_failure', 'Auth failed', 'Check key', false, 401, 'Unauthorized', 'authentication_error', 'invalid_api_key'
    );
    assert.equal(err.error_class, 'auth_failure');
    assert.equal(err.message, 'Auth failed');
    assert.equal(err.recovery, 'Check key');
    assert.equal(err.retryable, false);
    assert.equal(err.http_status, 401);
    assert.equal(err.raw_detail, 'Unauthorized');
    assert.equal(err.provider_error_type, 'authentication_error');
    assert.equal(err.provider_error_code, 'invalid_api_key');
  });

  it('defaults http_status, raw_detail, and provider fields to null', () => {
    const err = classifyError('missing_credentials', 'No key', 'Set key', false);
    assert.equal(err.http_status, null);
    assert.equal(err.raw_detail, null);
    assert.equal(err.provider_error_type, null);
    assert.equal(err.provider_error_code, null);
  });

  it('truncates raw_detail to 500 characters', () => {
    const longDetail = 'x'.repeat(1000);
    const err = classifyError('unknown_api_error', 'err', 'retry', true, 500, longDetail);
    assert.equal(err.raw_detail.length, 500);
  });
});

// ── Tests: classifyHttpError ──────────────────────────────────────────────

describe('classifyHttpError', () => {
  it('classifies 401 as auth_failure', () => {
    const err = classifyHttpError(401, 'Unauthorized', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'auth_failure');
    assert.equal(err.http_status, 401);
    assert.equal(err.retryable, false);
    assert.ok(err.recovery.includes('ANTHROPIC_API_KEY'));
  });

  it('classifies 403 as auth_failure', () => {
    const err = classifyHttpError(403, 'Forbidden', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'auth_failure');
    assert.equal(err.http_status, 403);
  });

  it('classifies 429 as rate_limited', () => {
    const err = classifyHttpError(429, 'Too many requests', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'rate_limited');
    assert.equal(err.retryable, true);
    assert.ok(err.recovery.includes('anthropic'));
    assert.equal(err.provider_error_type, null);
  });

  it('classifies 404 as model_not_found', () => {
    const err = classifyHttpError(404, 'Not found', 'anthropic', 'claude-nonexistent-99', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'model_not_found');
    assert.equal(err.retryable, false);
    assert.ok(err.recovery.includes('claude-nonexistent-99'));
  });

  it('classifies Anthropic invalid_request_error context overflows as context_overflow', () => {
    const err = classifyHttpError(400, '{"error":{"type":"invalid_request_error","message":"context length exceeded"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'context_overflow');
    assert.equal(err.retryable, false);
    assert.equal(err.provider_error_type, 'invalid_request_error');
  });

  it('classifies Anthropic token-limit invalid_request_error as context_overflow', () => {
    const err = classifyHttpError(400, '{"error":{"type":"invalid_request_error","message":"maximum number of token limit reached"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'context_overflow');
  });

  it('classifies Anthropic non-context invalid_request_error as invalid_request', () => {
    const err = classifyHttpError(400, '{"error":{"type":"invalid_request_error","message":"temperature must be between 0 and 1"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'invalid_request');
    assert.equal(err.retryable, false);
  });

  it('classifies Anthropic overloaded_error as provider_overloaded', () => {
    const err = classifyHttpError(529, '{"error":{"type":"overloaded_error","message":"Overloaded"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'provider_overloaded');
    assert.equal(err.retryable, true);
    assert.equal(err.provider_error_type, 'overloaded_error');
  });

  it('classifies Anthropic daily spend rate limits as non-retryable rate_limited', () => {
    const err = classifyHttpError(429, '{"error":{"type":"rate_limit_error","message":"Daily spend limit reached for this workspace budget"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'rate_limited');
    assert.equal(err.retryable, false);
    assert.equal(err.provider_error_type, 'rate_limit_error');
  });

  it('falls through to HTTP fallback while preserving unknown provider error type', () => {
    const err = classifyHttpError(400, '{"error":{"type":"new_future_error","message":"future mismatch"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'unknown_api_error');
    assert.equal(err.retryable, true);
    assert.equal(err.provider_error_type, 'new_future_error');
  });

  it('classifies 500 as unknown_api_error', () => {
    const err = classifyHttpError(500, 'Internal server error', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'unknown_api_error');
    assert.equal(err.http_status, 500);
    assert.equal(err.retryable, true);
  });

  it('classifies 502 as unknown_api_error', () => {
    const err = classifyHttpError(502, 'Bad gateway', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'unknown_api_error');
    assert.equal(err.retryable, true);
  });

  it('classifies OpenAI invalid_api_key as auth_failure', () => {
    const err = classifyHttpError(401, '{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key"}}', 'openai', 'gpt-4o-mini', 'OPENAI_API_KEY');
    assert.equal(err.error_class, 'auth_failure');
    assert.equal(err.http_status, 401);
    assert.equal(err.retryable, false);
    assert.equal(err.provider_error_code, 'invalid_api_key');
  });

  it('classifies OpenAI rate limit failures as rate_limited', () => {
    const err = classifyHttpError(429, '{"error":{"type":"rate_limit_error","message":"Rate limit exceeded"}}', 'openai', 'gpt-4o-mini', 'OPENAI_API_KEY');
    assert.equal(err.error_class, 'rate_limited');
    assert.equal(err.retryable, true);
    assert.equal(err.provider_error_type, 'rate_limit_error');
  });

  it('classifies OpenAI token limit failures as context_overflow', () => {
    const err = classifyHttpError(400, '{"error":{"type":"invalid_request_error","message":"This model\\u2019s maximum context length has been exceeded due to token limit"}}', 'openai', 'gpt-4o-mini', 'OPENAI_API_KEY');
    assert.equal(err.error_class, 'context_overflow');
    assert.equal(err.retryable, false);
  });
});

describe('dispatchApiProxy', () => {
  it('keeps current success behavior when preflight tokenization is disabled', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const promptMd = '# Prompt\nReturn valid turn JSON.';
    const contextMd = buildStructuredContext();
    const config = makeApiConfig();
    setupDispatchBundle(root, { promptMd, contextMd });
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let requestBody;
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return makeJsonResponse(200, {
        content: [{ type: 'text', text: JSON.stringify(turnResult) }],
        usage: { input_tokens: 1200, output_tokens: 300 },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);
    assert.equal(requestBody.system, SYSTEM_PROMPT);
    assert.equal(requestBody.messages[0].content, `${promptMd}${SEPARATOR}${contextMd}`);
    assert.equal(existsSync(join(root, tokenBudgetPath(state))), false);
    assert.equal(existsSync(join(root, effectiveContextPath(state))), false);
  });

  it('dispatches through OpenAI chat completions and stages the extracted result', async () => {
    const root = createAndTrack();
    const state = makeApiState({
      current_turn: {
        turn_id: 'turn_test001',
        assigned_role: 'qa',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 600000).toISOString(),
        runtime_id: 'api-openai',
      },
    });
    const turnResult = {
      ...makeTurnResult(state),
      runtime_id: 'api-openai',
    };
    const config = makeApiConfig({
      provider: 'openai',
      model: 'gpt-4o-mini',
      auth_env: 'OPENAI_API_KEY',
    });
    config.roles.qa.runtime_id = 'api-openai';
    config.runtimes = {
      'api-openai': {
        type: 'api_proxy',
        provider: 'openai',
        model: 'gpt-4o-mini',
        auth_env: 'OPENAI_API_KEY',
        max_output_tokens: 1024,
        timeout_seconds: 5,
      },
    };

    setupDispatchBundle(root);
    process.env.OPENAI_API_KEY = 'openai-test-key';

    let requestUrl;
    let requestHeaders;
    let requestBody;
    global.fetch = async (url, options) => {
      requestUrl = url;
      requestHeaders = options.headers;
      requestBody = JSON.parse(options.body);
      return makeJsonResponse(200, {
        choices: [{
          message: {
            content: JSON.stringify(turnResult),
          },
        }],
        usage: {
          prompt_tokens: 900,
          completion_tokens: 120,
        },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);
    assert.equal(requestUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(requestHeaders.Authorization, 'Bearer openai-test-key');
    assert.equal(requestBody.model, 'gpt-4o-mini');
    assert.equal(requestBody.max_completion_tokens, 1024);
    assert.deepEqual(requestBody.response_format, { type: 'json_object' });
    assert.equal(requestBody.messages[0].role, 'developer');
    assert.equal(requestBody.messages[1].role, 'user');
    assert.deepEqual(result.usage, {
      input_tokens: 900,
      output_tokens: 120,
      usd: 0,
    });

    const staged = readJson(join(root, stagingResultPath(state)));
    assert.equal(staged.runtime_id, 'api-openai');
    assert.deepEqual(staged.cost, {
      input_tokens: 900,
      output_tokens: 120,
      usd: 0,
    });
  });

  it('writes preflight audit artifacts and sends the effective context when tokenization is enabled', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const promptMd = '# Prompt\nReturn valid turn JSON.';
    const contextMd = buildStructuredContext();
    const config = makeApiConfig({
      context_window_tokens: 200000,
      preflight_tokenization: {
        enabled: true,
        tokenizer: 'provider_local',
        safety_margin_tokens: 2048,
      },
    });
    setupDispatchBundle(root, { promptMd, contextMd });
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let requestBody;
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return makeJsonResponse(200, {
        content: [{ type: 'text', text: JSON.stringify(turnResult) }],
        usage: { input_tokens: 1200, output_tokens: 300 },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);

    const effectiveContextFile = join(root, effectiveContextPath(state));
    const tokenBudgetFile = join(root, tokenBudgetPath(state));
    assert.equal(existsSync(effectiveContextFile), true);
    assert.equal(existsSync(tokenBudgetFile), true);

    const effectiveContext = readFileSync(effectiveContextFile, 'utf8');
    const report = readJson(tokenBudgetFile);
    assert.equal(effectiveContext, contextMd);
    assert.equal(report.sent_to_provider, true);
    assert.equal(report.truncated, false);
    assert.equal(requestBody.messages[0].content, `${promptMd}${SEPARATOR}${effectiveContext}`);
  });

  it('returns the first classified error unchanged when retry_policy is disabled', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({ retry_policy: { enabled: false } });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return makeTextResponse(429, 'Too many requests');
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'rate_limited');
    assert.equal(result.attempts_made, 1);
    assert.equal(calls, 1);
    assert.equal(result.preflight_artifacts, undefined, 'non-preflight errors should not include preflight_artifacts');

    const apiError = readJson(join(root, apiErrorPath(state)));
    assert.equal(apiError.error_class, 'rate_limited');
  });

  it('returns local context_overflow without calling fetch when preflight compression is exhausted', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const promptMd = '# Prompt\nReturn valid turn JSON.';
    const contextMd = buildStructuredContext({
      currentStateContent: [
        '- **Phase:** qa',
        '- **Assigned role:** qa',
        `- **Details:** ${'sticky context '.repeat(1200)}`,
      ].join('\n'),
    });
    const maxOutputTokens = 128;
    const safetyMarginTokens = 64;
    const immutableTokens = countTokens(SYSTEM_PROMPT, 'anthropic')
      + countTokens(promptMd, 'anthropic')
      + countTokens(SEPARATOR, 'anthropic');
    const config = makeApiConfig({
      max_output_tokens: maxOutputTokens,
      context_window_tokens: immutableTokens + 80 + maxOutputTokens + safetyMarginTokens,
      preflight_tokenization: {
        enabled: true,
        tokenizer: 'provider_local',
        safety_margin_tokens: safetyMarginTokens,
      },
    });
    setupDispatchBundle(root, { promptMd, contextMd });
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return makeJsonResponse(200, {});
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'context_overflow');
    assert.equal(calls, 0);

    // Preflight artifacts returned for operator display
    assert.ok(result.preflight_artifacts, 'preflight_artifacts should be present on local overflow');
    assert.equal(result.preflight_artifacts.token_budget, join(root, tokenBudgetPath(state)));
    assert.equal(result.preflight_artifacts.effective_context, join(root, effectiveContextPath(state)));

    const report = readJson(join(root, tokenBudgetPath(state)));
    assert.equal(report.sent_to_provider, false);
    assert.ok(report.truncated);
    assert.ok(existsSync(join(root, apiErrorPath(state))));
  });

  it('returns local context_overflow on prompt-only overflow before parsing sections', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const promptMd = `# Prompt\n${'immutable prompt '.repeat(1500)}`;
    const contextMd = buildStructuredContext();
    const maxOutputTokens = 128;
    const safetyMarginTokens = 64;
    const immutableTokens = countTokens(SYSTEM_PROMPT, 'anthropic')
      + countTokens(promptMd, 'anthropic')
      + countTokens(SEPARATOR, 'anthropic');
    const config = makeApiConfig({
      max_output_tokens: maxOutputTokens,
      context_window_tokens: immutableTokens - 1 + maxOutputTokens + safetyMarginTokens,
      preflight_tokenization: {
        enabled: true,
        tokenizer: 'provider_local',
        safety_margin_tokens: safetyMarginTokens,
      },
    });
    setupDispatchBundle(root, { promptMd, contextMd });
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return makeJsonResponse(200, {});
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'context_overflow');
    assert.equal(calls, 0);

    // Preflight artifacts returned for operator display
    assert.ok(result.preflight_artifacts, 'preflight_artifacts should be present on prompt-only overflow');
    assert.equal(result.preflight_artifacts.token_budget, join(root, tokenBudgetPath(state)));

    const report = readJson(join(root, tokenBudgetPath(state)));
    assert.equal(report.sent_to_provider, false);
    assert.deepEqual(report.sections, []);
  });

  it('does not include preflight_artifacts on non-preflight context_overflow', () => {
    const err = classifyHttpError(400, '{"error":{"type":"invalid_request_error","message":"context length exceeded"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'context_overflow');
    // This is a raw classified error, not a dispatchApiProxy result with preflight_artifacts
    assert.equal(err.preflight_artifacts, undefined);
  });

  it('retries rate_limited failures and succeeds on the third attempt', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mkdirSync(join(root, '.agentxchain/staging', state.current_turn.turn_id), { recursive: true });
    writeFileSync(join(root, apiErrorPath(state)), '{"stale":true}\n');

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls < 3) {
        return makeTextResponse(429, 'Too many requests');
      }
      return makeJsonResponse(200, {
        content: [{ type: 'text', text: JSON.stringify(turnResult) }],
        usage: { input_tokens: 1200, output_tokens: 300 },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);
    assert.equal(result.attempts_made, 3);
    assert.equal(calls, 3);
    assert.equal(state.current_turn.attempt, 1);

    const staged = readJson(join(root, stagingResultPath(state)));
    assert.equal(staged.turn_id, state.current_turn.turn_id);
    assert.equal(staged.cost.input_tokens, 1200);
    assert.equal(existsSync(join(root, apiErrorPath(state))), false);
  });

  it('aggregates usage across a failed extraction attempt and the final success', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 2,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return makeJsonResponse(200, {
          content: [{ type: 'text', text: 'not valid turn json' }],
          usage: { input_tokens: 1000, output_tokens: 200 },
        });
      }
      return makeJsonResponse(200, {
        content: [{ type: 'text', text: JSON.stringify(turnResult) }],
        usage: { input_tokens: 500, output_tokens: 50 },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);
    assert.equal(result.attempts_made, 2);
    assert.equal(calls, 2);
    assert.deepEqual(result.usage, {
      input_tokens: 1500,
      output_tokens: 250,
      usd: 0.008,
    });

    const staged = readJson(join(root, stagingResultPath(state)));
    assert.deepEqual(staged.cost, {
      input_tokens: 1500,
      output_tokens: 250,
      usd: 0.008,
    });
  });

  it('does not retry non-retryable auth failures', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return makeTextResponse(401, 'Unauthorized');
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'auth_failure');
    assert.equal(result.attempts_made, 1);
    assert.equal(calls, 1);
  });

  it('retries provider_overloaded failures by default policy', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls < 3) {
        return makeTextResponse(529, '{"error":{"type":"overloaded_error","message":"Overloaded"}}');
      }
      return makeJsonResponse(200, {
        content: [{ type: 'text', text: JSON.stringify(turnResult) }],
        usage: { input_tokens: 900, output_tokens: 120 },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);
    assert.equal(result.attempts_made, 3);
    assert.equal(calls, 3);
  });

  it('does not retry Anthropic daily spend rate limits even when retry_on includes rate_limited', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
        retry_on: ['rate_limited'],
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      return makeTextResponse(429, '{"error":{"type":"rate_limit_error","message":"Daily spend limit reached for this workspace budget"}}');
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'rate_limited');
    assert.equal(result.classified.retryable, false);
    assert.equal(result.attempts_made, 1);
    assert.equal(calls, 1);
  });

  it('honors retry_on filtering for network failures', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
        retry_on: ['rate_limited'],
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      throw new Error('socket hang up');
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'network_failure');
    assert.equal(result.attempts_made, 1);
    assert.equal(calls, 1);
  });

  it('writes retry trace on success after retries', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return makeTextResponse(429, 'Too many requests');
      }
      return makeJsonResponse(200, {
        content: [{ type: 'text', text: JSON.stringify(turnResult) }],
        usage: { input_tokens: 800, output_tokens: 100 },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);
    assert.equal(result.attempts_made, 2);
    assert.ok(result.retry_trace_path);

    const trace = readJson(join(root, retryTracePath(state)));
    assert.equal(trace.provider, 'anthropic');
    assert.equal(trace.model, 'claude-sonnet-4-6');
    assert.equal(trace.run_id, state.run_id);
    assert.equal(trace.turn_id, state.current_turn.turn_id);
    assert.equal(trace.final_outcome, 'success');
    assert.equal(trace.attempts_made, 2);
    assert.equal(trace.attempts.length, 2);
    assert.equal(trace.attempts[0].outcome, 'rate_limited');
    assert.equal(trace.attempts[0].retryable, true);
    assert.equal(trace.attempts[1].outcome, 'success');
  });

  it('writes retry trace on final failure after exhausting retries', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 2,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    global.fetch = async () => makeTextResponse(429, 'Too many requests');

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.attempts_made, 2);
    assert.ok(result.retry_trace_path);

    const trace = readJson(join(root, retryTracePath(state)));
    assert.equal(trace.final_outcome, 'failure');
    assert.equal(trace.attempts_made, 2);
    assert.equal(trace.attempts.length, 2);
    assert.equal(trace.attempts[0].outcome, 'rate_limited');
    assert.equal(trace.attempts[1].outcome, 'rate_limited');
  });

  it('does not write retry trace on single-attempt success', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    global.fetch = async () => makeJsonResponse(200, {
      content: [{ type: 'text', text: JSON.stringify(turnResult) }],
      usage: { input_tokens: 500, output_tokens: 50 },
    });

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);
    assert.equal(result.attempts_made, 1);
    assert.equal(result.retry_trace_path, undefined);
    assert.equal(existsSync(join(root, retryTracePath(state))), false);
  });

  it('aborts during backoff and records aborted trace', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 60000,
        max_delay_ms: 60000,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const controller = new AbortController();

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      // After first failure, schedule abort during backoff
      setTimeout(() => controller.abort(), 10);
      return makeTextResponse(429, 'Too many requests');
    };

    const result = await dispatchApiProxy(root, state, config, { signal: controller.signal });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'Dispatch aborted by operator');
    assert.equal(result.attempts_made, 1);
    assert.equal(calls, 1);

    const trace = readJson(join(root, retryTracePath(state)));
    assert.equal(trace.final_outcome, 'aborted');
    assert.equal(trace.attempts.length, 1);
    assert.equal(trace.attempts[0].outcome, 'rate_limited');
  });

  it('aborts during fetch and does not classify as timeout', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 3,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const controller = new AbortController();

    global.fetch = async (url, opts) => {
      // Simulate external abort during fetch
      controller.abort();
      // The abort signal propagates and fetch throws AbortError
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    };

    const result = await dispatchApiProxy(root, state, config, { signal: controller.signal });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('aborted') || result.error.includes('Abort'));
    // Must NOT be classified as timeout
    assert.equal(result.classified?.error_class ?? null, null);
  });

  it('trace aggregate_usage includes all usage-bearing attempts on failure', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 2,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      // Both attempts return 200 with usage but fail extraction
      return makeJsonResponse(200, {
        content: [{ type: 'text', text: 'not valid json' }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      });
    };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.attempts_made, 2);

    const trace = readJson(join(root, retryTracePath(state)));
    assert.equal(trace.aggregate_usage.input_tokens, 2000);
    assert.equal(trace.aggregate_usage.output_tokens, 400);
    assert.equal(trace.attempts[0].usage.input_tokens, 1000);
    assert.equal(trace.attempts[1].usage.input_tokens, 1000);
  });

  it('persists raw provider-response.json on extraction failure after retry exhaustion', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      retry_policy: {
        enabled: true,
        max_attempts: 2,
        base_delay_ms: 0,
        max_delay_ms: 0,
        jitter: 'none',
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const rawPayload = {
      content: [{ type: 'text', text: 'Here is my review in prose, no JSON.' }],
      usage: { input_tokens: 500, output_tokens: 100 },
    };

    global.fetch = async () => makeJsonResponse(200, rawPayload);

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'turn_result_extraction_failure');

    // Raw provider response must be persisted for debugging
    const providerResponsePath = join(root, getTurnProviderResponsePath(state.current_turn.turn_id));
    assert.equal(existsSync(providerResponsePath), true);
    const persisted = readJson(providerResponsePath);
    assert.deepEqual(persisted.content, rawPayload.content);
    assert.deepEqual(persisted.usage, rawPayload.usage);
  });

  it('persists provider-response.json on successful extraction (unchanged behavior)', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const turnResult = makeTurnResult(state);
    const config = makeApiConfig();
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const rawPayload = {
      content: [{ type: 'text', text: JSON.stringify(turnResult) }],
      usage: { input_tokens: 800, output_tokens: 200 },
    };

    global.fetch = async () => makeJsonResponse(200, rawPayload);

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, true);

    const providerResponsePath = join(root, getTurnProviderResponsePath(state.current_turn.turn_id));
    assert.equal(existsSync(providerResponsePath), true);
    const persisted = readJson(providerResponsePath);
    assert.deepEqual(persisted.content, rawPayload.content);
  });

  it('does NOT persist provider-response.json on HTTP error (non-JSON response body)', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig();
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    global.fetch = async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);

    const providerResponsePath = join(root, getTurnProviderResponsePath(state.current_turn.turn_id));
    assert.equal(existsSync(providerResponsePath), false);
  });

  it('persists provider error type/code fields in api-error.json for structured provider errors', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig();
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    global.fetch = async () => makeTextResponse(
      400,
      '{"error":{"type":"invalid_request_error","code":"bad_parameter","message":"temperature must be between 0 and 1"}}'
    );

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.classified.error_class, 'invalid_request');

    const apiError = readJson(join(root, apiErrorPath(state)));
    assert.equal(apiError.provider_error_type, 'invalid_request_error');
    assert.equal(apiError.provider_error_code, 'bad_parameter');
  });

  it('keeps provider error fields null for unstructured HTTP error bodies', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig();
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    global.fetch = async () => makeTextResponse(503, '<html>unavailable</html>');

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);

    const apiError = readJson(join(root, apiErrorPath(state)));
    assert.equal(apiError.provider_error_type, null);
    assert.equal(apiError.provider_error_code, null);
  });

  it('does NOT persist provider-response.json on local preflight overflow', async () => {
    const root = createAndTrack();
    const state = makeApiState();
    const config = makeApiConfig({
      context_window_tokens: 512,
      max_output_tokens: 192,
      preflight_tokenization: {
        enabled: true,
        tokenizer: 'provider_local',
        safety_margin_tokens: 128,
      },
    });
    setupDispatchBundle(root);
    process.env.ANTHROPIC_API_KEY = 'test-key';

    global.fetch = async () => { throw new Error('fetch should not be called'); };

    const result = await dispatchApiProxy(root, state, config);
    assert.equal(result.ok, false);

    const providerResponsePath = join(root, getTurnProviderResponsePath(state.current_turn.turn_id));
    assert.equal(existsSync(providerResponsePath), false);
  });
});
