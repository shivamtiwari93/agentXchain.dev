import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTokenBudget, SYSTEM_PROMPT, SEPARATOR } from '../src/lib/token-budget.js';
import { countTokens } from '../src/lib/token-counter.js';

// Shared params factory for conciseness
function makeParams(overrides = {}) {
  return {
    promptMd: '# Test Prompt\nDo a thing.',
    contextMd: '',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    runtimeId: 'rt-test',
    runId: 'run-test',
    turnId: 'turn-test',
    contextWindowTokens: 200000,
    maxOutputTokens: 4096,
    safetyMarginTokens: 2048,
    ...overrides,
  };
}

// Helper: build a realistic CONTEXT.md with the current section set
function buildFullContext({
  budgetLines,
  projectGoal,
  inheritedContext,
  summary,
  decisions,
  objections,
  blockers,
  gateFiles,
  gateStatus,
} = {}) {
  const lines = [];
  lines.push('# Execution Context');
  lines.push('');
  lines.push('## Current State');
  lines.push('');
  lines.push('- **Phase:** development');
  lines.push('- **Turn:** 3');
  if (budgetLines !== false) {
    lines.push('- **Budget spent:** $0.05');
    lines.push('- **Budget remaining:** $9.95');
  }
  lines.push('');
  if (projectGoal !== false) {
    lines.push('## Project Goal');
    lines.push('');
    lines.push(projectGoal || 'Ship a governed implementation without losing context under token pressure.');
    lines.push('');
  }
  if (inheritedContext !== false) {
    lines.push('## Inherited Run Context');
    lines.push('');
    lines.push('- **Parent run:** run_parent');
    lines.push('- **Parent status:** completed');
    lines.push('');
  }
  lines.push('## Last Accepted Turn');
  lines.push('');
  lines.push('- Turn: turn_002');
  lines.push('- Role: qa_reviewer');
  if (summary !== false) {
    lines.push('- **Summary:** The previous turn reviewed the implementation and found no critical issues.');
  }
  if (decisions !== false) {
    lines.push('- **Decisions:**');
    lines.push('  - DEC-001: Accept the API design');
    lines.push('  - DEC-002: Defer caching to post-v1');
  }
  if (objections !== false) {
    lines.push('- **Objections:**');
    lines.push('  - OBJ-001: Error messages need improvement');
  }
  lines.push('');
  if (blockers) {
    lines.push('## Blockers');
    lines.push('');
    lines.push('- Waiting for API key setup');
    lines.push('');
  }
  if (gateFiles) {
    lines.push('## Gate Required Files');
    lines.push('');
    lines.push('- src/index.js');
    lines.push('- src/lib/config.js');
    lines.push('');
  }
  if (gateStatus) {
    lines.push('## Phase Gate Status');
    lines.push('');
    lines.push('- gate: development -> review');
    lines.push('- status: pending');
    lines.push('');
  }
  return lines.join('\n');
}

describe('token-budget evaluator', () => {
  describe('fit without compression', () => {
    it('returns sent_to_provider=true when everything fits', () => {
      const contextMd = buildFullContext();
      const result = evaluateTokenBudget(makeParams({ contextMd }));

      assert.equal(result.sent_to_provider, true);
      assert.equal(result.report.sent_to_provider, true);
      assert.equal(result.report.truncated, false);
      assert.equal(result.report.tokenizer, 'provider_local');
      assert.ok(result.report.estimated_input_tokens > 0);
      assert.ok(result.report.estimated_input_tokens <= result.report.available_input_tokens);
      assert.equal(result.effective_context, contextMd);
    });

    it('marks all sections as kept', () => {
      const contextMd = buildFullContext();
      const result = evaluateTokenBudget(makeParams({ contextMd }));

      for (const section of result.report.sections) {
        assert.equal(section.action, 'kept');
        assert.ok(section.original_tokens > 0);
        assert.equal(section.final_tokens, section.original_tokens);
      }
    });

    it('counts system_prompt_tokens correctly', () => {
      const result = evaluateTokenBudget(makeParams({ contextMd: buildFullContext() }));
      const expected = countTokens(SYSTEM_PROMPT, 'anthropic');
      assert.equal(result.report.system_prompt_tokens, expected);
    });

    it('counts prompt_tokens correctly', () => {
      const promptMd = '# Big Prompt\nDo many things.\nMore instructions here.';
      const result = evaluateTokenBudget(makeParams({ promptMd, contextMd: buildFullContext() }));
      const expected = countTokens(promptMd, 'anthropic');
      assert.equal(result.report.prompt_tokens, expected);
    });

    it('counts separator_tokens when context exists', () => {
      const result = evaluateTokenBudget(makeParams({ contextMd: buildFullContext() }));
      const expected = countTokens(SEPARATOR, 'anthropic');
      assert.equal(result.report.separator_tokens, expected);
      assert.ok(result.report.separator_tokens > 0);
    });

    it('omits separator when context is empty', () => {
      const result = evaluateTokenBudget(makeParams({ contextMd: '' }));
      assert.equal(result.report.separator_tokens, 0);
    });
  });

  describe('no context', () => {
    it('returns sent_to_provider=true with zero context tokens', () => {
      const result = evaluateTokenBudget(makeParams({ contextMd: '' }));

      assert.equal(result.sent_to_provider, true);
      assert.equal(result.report.sent_to_provider, true);
      assert.equal(result.report.original_context_tokens, 0);
      assert.equal(result.report.final_context_tokens, 0);
      assert.deepEqual(result.report.sections, []);
      assert.equal(result.effective_context, '');
    });
  });

  describe('fit after compression', () => {
    it('preserves Project Goal and Inherited Run Context when compression is required', () => {
      const contextMd = buildFullContext({ gateFiles: true, gateStatus: true });
      const systemTokens = countTokens(SYSTEM_PROMPT, 'anthropic');
      const promptMd = '# Test Prompt\nDo a thing.';
      const promptTokens = countTokens(promptMd, 'anthropic');
      const sepTokens = countTokens(SEPARATOR, 'anthropic');
      const contextTokens = countTokens(contextMd, 'anthropic');
      const immutable = systemTokens + promptTokens + sepTokens;
      const budgetSection = '- **Budget spent:** $0.05\n- **Budget remaining:** $9.95';
      const budgetTokens = countTokens(budgetSection, 'anthropic');
      const tightBudget = immutable + contextTokens - Math.max(1, Math.floor(budgetTokens / 2));

      const result = evaluateTokenBudget(makeParams({
        promptMd,
        contextMd,
        contextWindowTokens: tightBudget + 4096 + 2048,
        maxOutputTokens: 4096,
        safetyMarginTokens: 2048,
      }));

      assert.equal(result.sent_to_provider, true);
      assert.ok(result.effective_context.includes('## Project Goal'));
      assert.ok(result.effective_context.includes('## Inherited Run Context'));
      assert.ok(result.effective_context.includes('Ship a governed implementation without losing context under token pressure.'));
      assert.ok(result.effective_context.includes('- **Parent run:** run_parent'));
      assert.equal(result.report.sections.find((section) => section.id === 'project_goal')?.action, 'kept');
      assert.equal(result.report.sections.find((section) => section.id === 'inherited_run_context')?.action, 'kept');
      assert.equal(result.report.sections.find((section) => section.id === 'budget')?.action, 'dropped');
    });

    it('drops budget lines first when just over budget', () => {
      const contextMd = buildFullContext({ gateFiles: true, gateStatus: true });
      // Compute token counts to find a tight budget
      const systemTokens = countTokens(SYSTEM_PROMPT, 'anthropic');
      const promptMd = '# Test Prompt\nDo a thing.';
      const promptTokens = countTokens(promptMd, 'anthropic');
      const sepTokens = countTokens(SEPARATOR, 'anthropic');
      const contextTokens = countTokens(contextMd, 'anthropic');
      const immutable = systemTokens + promptTokens + sepTokens;

      // Set budget so it's just a few tokens too tight for the full context
      // but fits after dropping budget lines
      const budgetLineTokens = countTokens('- **Budget spent:** $0.05\n- **Budget remaining:** $9.95', 'anthropic');
      const tightBudget = immutable + contextTokens - Math.floor(budgetLineTokens / 2);

      const result = evaluateTokenBudget(makeParams({
        promptMd,
        contextMd,
        contextWindowTokens: tightBudget + 4096 + 2048,
        maxOutputTokens: 4096,
        safetyMarginTokens: 2048,
      }));

      assert.equal(result.sent_to_provider, true);
      assert.equal(result.report.truncated, true);

      const budgetSection = result.report.sections.find((s) => s.id === 'budget');
      if (budgetSection) {
        assert.equal(budgetSection.action, 'dropped');
        assert.equal(budgetSection.final_tokens, 0);
      }
    });

    it('drops multiple sections in order when needed', () => {
      const contextMd = buildFullContext({ gateFiles: true, gateStatus: true });
      const systemTokens = countTokens(SYSTEM_PROMPT, 'anthropic');
      const promptMd = '# Test Prompt\nDo a thing.';
      const promptTokens = countTokens(promptMd, 'anthropic');
      const sepTokens = countTokens(SEPARATOR, 'anthropic');
      const immutable = systemTokens + promptTokens + sepTokens;

      // Set a very tight budget that requires dropping several sections
      // Keep only sticky sections: current_state, project_goal, inherited_run_context, last_turn_header
      // Need to drop: budget, phase_gate_status, gate_required_files, objections, decisions
      const stickyOnly = buildFullContext({
        budgetLines: false, summary: false, decisions: false,
        objections: false, gateFiles: false, gateStatus: false,
      });
      const stickyTokens = countTokens(stickyOnly, 'anthropic');

      // Budget allows immutable + sticky + small margin
      const tightBudget = immutable + stickyTokens + 20;

      const result = evaluateTokenBudget(makeParams({
        promptMd,
        contextMd,
        contextWindowTokens: tightBudget + 4096 + 2048,
        maxOutputTokens: 4096,
        safetyMarginTokens: 2048,
      }));

      assert.equal(result.sent_to_provider, true);
      assert.equal(result.report.truncated, true);

      // Verify dropped sections have final_tokens = 0
      for (const section of result.report.sections) {
        if (section.action === 'dropped') {
          assert.equal(section.final_tokens, 0);
        }
      }
    });
  });

  describe('prompt-only overflow', () => {
    it('fails with sent_to_provider=false when prompt alone exceeds budget', () => {
      // A huge prompt with a tiny context window
      const bigPrompt = 'x '.repeat(50000);
      const result = evaluateTokenBudget(makeParams({
        promptMd: bigPrompt,
        contextMd: buildFullContext(),
        contextWindowTokens: 100,
        maxOutputTokens: 10,
        safetyMarginTokens: 10,
      }));

      assert.equal(result.sent_to_provider, false);
      assert.equal(result.report.sent_to_provider, false);
      assert.ok(result.report.estimated_input_tokens > result.report.available_input_tokens);
    });
  });

  describe('compression exhausted', () => {
    it('fails with sent_to_provider=false when context cannot fit after max compression', () => {
      // Huge sticky context that can't be compressed away
      const hugeCurrentState = '- **Phase:** development\n' + '- **Detail:** '.repeat(1000) + 'important data';
      const lines = [
        '# Execution Context',
        '',
        '## Current State',
        '',
        hugeCurrentState,
      ];
      const contextMd = lines.join('\n');

      const result = evaluateTokenBudget(makeParams({
        contextMd,
        contextWindowTokens: 200,
        maxOutputTokens: 10,
        safetyMarginTokens: 10,
      }));

      assert.equal(result.sent_to_provider, false);
      assert.equal(result.report.sent_to_provider, false);
    });
  });

  describe('unsupported provider', () => {
    it('throws on unsupported provider', () => {
      assert.throws(
        () => evaluateTokenBudget(makeParams({ provider: 'openai' })),
        /Unsupported token counter provider/
      );
    });
  });

  describe('report shape', () => {
    it('includes all required report fields', () => {
      const contextMd = buildFullContext();
      const result = evaluateTokenBudget(makeParams({ contextMd }));
      const r = result.report;

      assert.equal(typeof r.provider, 'string');
      assert.equal(typeof r.model, 'string');
      assert.equal(typeof r.runtime_id, 'string');
      assert.equal(typeof r.run_id, 'string');
      assert.equal(typeof r.turn_id, 'string');
      assert.equal(r.tokenizer, 'provider_local');
      assert.equal(typeof r.context_window_tokens, 'number');
      assert.equal(typeof r.reserved_output_tokens, 'number');
      assert.equal(typeof r.safety_margin_tokens, 'number');
      assert.equal(typeof r.available_input_tokens, 'number');
      assert.equal(typeof r.system_prompt_tokens, 'number');
      assert.equal(typeof r.prompt_tokens, 'number');
      assert.equal(typeof r.separator_tokens, 'number');
      assert.equal(typeof r.original_context_tokens, 'number');
      assert.equal(typeof r.final_context_tokens, 'number');
      assert.equal(typeof r.estimated_input_tokens, 'number');
      assert.equal(typeof r.truncated, 'boolean');
      assert.equal(typeof r.sent_to_provider, 'boolean');
      assert.equal(r.effective_context_path, '.agentxchain/dispatch/turns/turn-test/CONTEXT.effective.md');
      assert.ok(Array.isArray(r.sections));
    });

    it('computes available_input_tokens correctly', () => {
      const result = evaluateTokenBudget(makeParams({
        contextWindowTokens: 100000,
        maxOutputTokens: 8192,
        safetyMarginTokens: 1024,
      }));

      assert.equal(result.report.available_input_tokens, 100000 - 8192 - 1024);
    });

    it('uses default maxOutputTokens=4096 when not specified', () => {
      const result = evaluateTokenBudget(makeParams({
        contextWindowTokens: 100000,
        maxOutputTokens: undefined,
        safetyMarginTokens: 2048,
      }));

      assert.equal(result.report.reserved_output_tokens, 4096);
      assert.equal(result.report.available_input_tokens, 100000 - 4096 - 2048);
    });

    it('uses default safetyMarginTokens=2048 when not specified', () => {
      const result = evaluateTokenBudget(makeParams({
        contextWindowTokens: 100000,
        maxOutputTokens: 4096,
        safetyMarginTokens: undefined,
      }));

      assert.equal(result.report.safety_margin_tokens, 2048);
    });
  });

  describe('estimated_input_tokens consistency', () => {
    it('equals system + prompt + separator + final context tokens', () => {
      const contextMd = buildFullContext({ gateFiles: true, gateStatus: true });
      const result = evaluateTokenBudget(makeParams({ contextMd }));
      const r = result.report;

      const expected = r.system_prompt_tokens + r.prompt_tokens + r.separator_tokens + r.final_context_tokens;
      assert.equal(r.estimated_input_tokens, expected);
    });
  });
});
