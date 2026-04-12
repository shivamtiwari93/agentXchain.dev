import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

const SPEC = read('.planning/WEBSITE_COMMUNITY_LINKS_SPEC.md');
const DOCUSAURUS_CONFIG = read('website-v2/docusaurus.config.ts');
const HOME_PAGE = read('website-v2/src/pages/index.tsx');

describe('website community links spec', () => {
  it('records the public contract and acceptance tests', () => {
    assert.match(SPEC, /# Website Community Links Spec/);
    assert.match(SPEC, /AT-WCL-001/);
    assert.match(SPEC, /AT-WCL-004/);
  });
});

describe('website community navigation surfaces', () => {
  it('keeps community links in both navbar and footer', () => {
    assert.match(DOCUSAURUS_CONFIG, /label: 'Community'/);
    assert.match(DOCUSAURUS_CONFIG, /href: 'https:\/\/www\.linkedin\.com\/company\/agentxchain-dev\/'/);
    assert.match(DOCUSAURUS_CONFIG, /href: 'https:\/\/x\.com\/agentxchaindev'/);
    assert.match(DOCUSAURUS_CONFIG, /href: 'https:\/\/www\.reddit\.com\/r\/agentXchain_dev\/'/);
    assert.doesNotMatch(DOCUSAURUS_CONFIG, /https:\/\/x\.com\/agentXchain_dev/);
    assert.match(DOCUSAURUS_CONFIG, /title: 'Community'/);
  });

  it('keeps the homepage community section with explicit new-tab links', () => {
    assert.match(HOME_PAGE, /Build in public with other AgentXchain operators/);
    assert.match(HOME_PAGE, /href="https:\/\/www\.linkedin\.com\/company\/agentxchain-dev\/"/);
    assert.match(HOME_PAGE, /href="https:\/\/x\.com\/agentxchaindev"/);
    assert.match(HOME_PAGE, /href="https:\/\/www\.reddit\.com\/r\/agentXchain_dev\/"/);
    assert.doesNotMatch(HOME_PAGE, /https:\/\/x\.com\/agentXchain_dev/);
    assert.doesNotMatch(HOME_PAGE, /@agentXchain_dev/);
    assert.match(HOME_PAGE, /target="_blank"/);
    assert.match(HOME_PAGE, /rel="noopener noreferrer"/);
  });

  it('uses recognizable LinkedIn, X, and Reddit icons on the homepage', () => {
    assert.match(HOME_PAGE, /function LinkedInIcon\(/);
    assert.match(HOME_PAGE, /function XIcon\(/);
    assert.match(HOME_PAGE, /function RedditIcon\(/);
    assert.match(HOME_PAGE, /<LinkedInIcon \/>/);
    assert.match(HOME_PAGE, /<XIcon \/>/);
    assert.match(HOME_PAGE, /<RedditIcon \/>/);
    assert.doesNotMatch(HOME_PAGE, /suspended/);
  });
});
