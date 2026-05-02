import { describe, it } from 'vitest';
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
    assert.doesNotMatch(content, /config --set runtimes\.manual-dev\.type manual/,
      'tutorial must not tell operators to add manual-dev runtime manually once the built-in runtime exists');
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

  it('getting-started.mdx uses config --set for QA runtime fallback', () => {
    const content = readDoc('getting-started.mdx');
    assert.match(content, /config --set roles\.qa\.runtime manual-qa/,
      'getting-started must show config --set for QA runtime fallback');
    assert.doesNotMatch(content, /[Ee]dit `agentxchain\.json` and change.*roles\.qa\.runtime/i,
      'getting-started must not tell operators to hand-edit JSON for QA runtime fallback');
  });

  it('timeouts.mdx mentions config --set as an alternative', () => {
    const content = readDoc('timeouts.mdx');
    assert.match(content, /config --set timeouts\./,
      'timeouts docs must show config --set as a CLI alternative');
  });

  it('timeouts.mdx recovery routes through config --set', () => {
    const content = readDoc('timeouts.mdx');
    assert.match(content, /config --set timeouts\.per_turn_minutes/,
      'timeouts recovery must use config --set for scalar timeout adjustment');
    assert.doesNotMatch(content, /[Aa]djust `?per_turn_minutes`?,\s*`?per_phase_minutes`?,\s*`?per_run_minutes`?/,
      'timeouts recovery must not list bare field names without config --set');
  });

  it('recovery.mdx timeout recovery routes through config --set', () => {
    const content = readDoc('recovery.mdx');
    assert.match(content, /config --set timeouts\.per_turn_minutes/,
      'recovery timeout guidance must use config --set for scalar timeout adjustment');
  });

  it('adapters.mdx routes cost_rates override through config --set', () => {
    const content = readDoc('adapters.mdx');
    assert.match(content, /config --set budget\.cost_rates\./,
      'adapters docs must show config --set for per-model cost rate override');
    assert.doesNotMatch(content, /override or extend cost rates via `budget\.cost_rates` in `agentxchain\.json`/i,
      'adapters docs must not route single-model cost rate override to manual JSON editing');
  });

  it('cli.mdx shows cost_rates as a config --set example', () => {
    const content = readDoc('cli.mdx');
    assert.match(content, /config --set budget\.cost_rates\./,
      'CLI docs must show config --set for per-model cost rate override');
  });
});
