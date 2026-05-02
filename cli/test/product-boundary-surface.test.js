import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

const ROOT_README = read('README.md');
const HOME_PAGE = read('website-v2/src/pages/index.tsx');
const LANGGRAPH_DOC = read('website-v2/docs/compare/vs-langgraph.mdx');
const CODEGEN_PAGE = read('website-v2/docs/compare/vs-codegen.mdx');
const METAGPT_PAGE = read('website-v2/docs/compare/vs-metagpt.mdx');
const OPENHANDS_PAGE = read('website-v2/docs/compare/vs-openhands.mdx');
const SPEC = read('.planning/PRODUCT_BOUNDARY_SURFACE_SPEC.md');

describe('product boundary surface', () => {
  it('AT-PBS-001: README keeps the .dev vs .ai boundary truthful', () => {
    assert.match(
      ROOT_README,
      /AgentXchain\.dev is the open-source surface[\s\S]*AgentXchain\.ai is the managed cloud surface in early access/i,
    );
    assert.match(ROOT_README, /\[AgentXchain\.ai \(managed cloud early access\)\]\(https:\/\/agentxchain\.ai\)/);
    assert.doesNotMatch(ROOT_README, /AgentXchain\.ai \(commercial cloud\)/i);
  });

  it('AT-PBS-002: homepage presents agentxchain.ai as a managed cloud preview', () => {
    assert.match(HOME_PAGE, /platform-desc">Managed cloud preview</);
    assert.match(HOME_PAGE, /Early-access web dashboard for project setup and run visibility/);
    assert.match(HOME_PAGE, /Built on the open-source core from agentxchain\.dev/);
    assert.match(HOME_PAGE, /Request early access while the managed surface is opening up/);
    assert.match(HOME_PAGE, /Request early access &rarr;/);
    assert.doesNotMatch(HOME_PAGE, /Managed cloud experience/);
    assert.doesNotMatch(HOME_PAGE, /No infrastructure to manage/);
  });

  it('AT-PBS-003: LangGraph comparison does not make false cloud claims', () => {
    assert.doesNotMatch(LANGGRAPH_DOC, /planned agentxchain\.ai cloud/);
    assert.doesNotMatch(LANGGRAPH_DOC, /No infrastructure to manage/);
  });

  it('AT-PBS-005: Codegen comparison keeps AgentXchain hosting truthful', () => {
    assert.match(
      CODEGEN_PAGE,
      /\| \*\*Hosting model\*\* \| Managed SaaS with SOC 2 Type II; on-premises Kubernetes deployment available for Enterprise \| Open-source self-hosted core \+ `agentxchain\.ai` managed-cloud early access \|/,
    );
    assert.match(CODEGEN_PAGE, /optional managed-cloud early-access path/i);
    assert.doesNotMatch(CODEGEN_PAGE, /\| \*\*Hosting model\*\* \|.*\| Self-hosted, local-first, open source \|/);
  });

  it('AT-PBS-006: MetaGPT comparison keeps AgentXchain hosted-product boundary truthful', () => {
    assert.match(
      METAGPT_PAGE,
      /\| \*\*Hosted product\*\* \| Atoms \(formerly MGX \/ MetaGPT X\) for hosted app building and deployment \| Open-source self-hosted core \+ `agentxchain\.ai` managed-cloud early access \|/,
    );
    assert.match(METAGPT_PAGE, /managed-cloud early access/i);
    assert.doesNotMatch(METAGPT_PAGE, /managed `?\.ai`? surface later/i);
  });

  it('AT-PBS-007: OpenHands comparison keeps AgentXchain hosting truthful', () => {
    assert.match(
      OPENHANDS_PAGE,
      /\| \*\*Hosting\*\* \|.*Enterprise.*\| Open-source self-hosted core \+ `agentxchain\.ai` managed-cloud early access \|/,
    );
    assert.match(OPENHANDS_PAGE, /managed-cloud early access/i);
    assert.doesNotMatch(OPENHANDS_PAGE, /\| \*\*Hosting\*\* \|.*\| Self-hosted, local-first, open source \|/);
  });

  it('records the product boundary contract in a standalone spec', () => {
    assert.match(SPEC, /# Product Boundary Surface Spec/);
    assert.match(SPEC, /AT-PBS-001/);
    assert.match(SPEC, /AT-PBS-007/);
  });
});
