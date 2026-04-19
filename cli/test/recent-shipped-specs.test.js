import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function readSpec(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

describe('recent shipped specs stay marked shipped', () => {
  const shippedSpecs = [
    '.planning/BUG_46_VERIFICATION_PRODUCED_FILES_SPEC.md',
    '.planning/AUTHORITATIVE_LOCAL_CLI_ROLE_PROOF_SPEC.md',
    '.planning/RUN_EXPORT_ROOT_CENTRALIZATION_SPEC.md',
    '.planning/FRAMEWORK_PATH_CLASSIFICATION_SPEC.md',
    // Turn 269 — 14 stale "Active" specs corrected to Shipped
    '.planning/PROPOSAL_APPLY_REJECT_SPEC.md',
    '.planning/PROPOSAL_LIFECYCLE_E2E_SPEC.md',
    '.planning/PROPOSAL_AWARE_GATES_SPEC.md',
    '.planning/PROPOSAL_CONFLICT_DETECTION_SPEC.md',
    '.planning/PROPOSAL_REVIEW_CONTEXT_SPEC.md',
    '.planning/COORDINATOR_BARRIER_LEDGER_NARRATIVE_SPEC.md',
    '.planning/ADAPTER_DISPATCH_PROGRESS_SPEC.md',
    '.planning/BUDGET_RECOVERY_E2E_SPEC.md',
    '.planning/BUDGET_ENFORCEMENT_SPEC.md',
    '.planning/BUDGET_CONFIG_VALIDATION_SPEC.md',
    '.planning/RELEASE_DOWNSTREAM_TRUTH_SPEC.md',
    '.planning/API_PROXY_PROPOSED_AUTHORING_SPEC.md',
  ];

  for (const specPath of shippedSpecs) {
    it(`${specPath} is marked shipped`, () => {
      const content = readSpec(specPath);
      // Match both formats: "**Status:** Shipped" and "> Status: **Shipped**"
      assert.match(content, /\*\*Status:\*\*\s*shipped|\*\*Shipped\*\*/i);
      assert.doesNotMatch(
        content,
        /\*\*(Status:\*\*\s*|)(proposed|draft|in.progress|active)\**/i,
        `${specPath} still claims proposed/draft/in-progress/active status`,
      );
    });
  }

  // Workflow-kit specs use blockquote status format
  const workflowKitShippedSpecs = [
    '.planning/WORKFLOW_KIT_PROMPT_GUIDANCE_SPEC.md',
    '.planning/WORKFLOW_KIT_RUNTIME_CONTEXT_SPEC.md',
  ];

  for (const specPath of workflowKitShippedSpecs) {
    it(`${specPath} is marked shipped`, () => {
      const content = readSpec(specPath);
      assert.match(content, /\*\*Shipped\*\*/i);
      assert.doesNotMatch(
        content,
        /\*\*Active\*\*/i,
        `${specPath} still claims Active status`,
      );
    });
  }
});
