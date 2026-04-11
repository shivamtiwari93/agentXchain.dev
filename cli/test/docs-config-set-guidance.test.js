import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const DOCS_ROOT = resolve(import.meta.dirname, '../../website-v2/docs');

function readDoc(name) {
  return readFileSync(resolve(DOCS_ROOT, name), 'utf8');
}

describe('Docs route runtime rebinding through config --set, not manual JSON editing', () => {
  it('first-turn.mdx uses config --set for QA runtime rebind', () => {
    const content = readDoc('first-turn.mdx');
    assert.match(content, /config --set roles\.qa\.runtime manual-qa/,
      'first-turn must show config --set for QA runtime rebind');
    assert.doesNotMatch(content, /edit `agentxchain\.json` and change.*roles\.qa\.runtime/i,
      'first-turn must not tell operators to hand-edit JSON for runtime rebind');
  });

  it('tutorial.mdx uses config --set for dev and QA runtime rebind', () => {
    const content = readDoc('tutorial.mdx');
    assert.match(content, /config --set roles\.dev\.runtime manual-dev/,
      'tutorial must show config --set for dev runtime rebind');
    assert.match(content, /config --set roles\.qa\.runtime manual-qa/,
      'tutorial must show config --set for QA runtime rebind');
    assert.match(content, /config --set runtimes\.manual-dev\.type manual/,
      'tutorial must show config --set for adding manual-dev runtime');
    assert.doesNotMatch(content, /[Ee]dit `agentxchain\.json` and change.*runtime/,
      'tutorial must not tell operators to hand-edit JSON for runtime rebind');
  });

  it('quickstart.mdx uses config --set for automated-path PM runtime setup', () => {
    const content = readDoc('quickstart.mdx');
    assert.match(content, /config --set runtimes\.api-pm\.type api_proxy/,
      'quickstart must show config --set for adding api-pm runtime');
    assert.match(content, /config --set roles\.pm\.runtime api-pm/,
      'quickstart must show config --set for PM runtime rebind');
  });

  it('timeouts.mdx mentions config --set as an alternative', () => {
    const content = readDoc('timeouts.mdx');
    assert.match(content, /config --set timeouts\./,
      'timeouts docs must show config --set as a CLI alternative');
  });
});
