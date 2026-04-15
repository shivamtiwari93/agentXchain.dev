import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shouldSuggestManualQaFallback } from '../src/lib/manual-qa-fallback.js';

function makeConfig() {
  return {
    roles: {
      qa: {
        runtime_id: 'api-qa',
      },
    },
    runtimes: {
      'api-qa': {
        type: 'api_proxy',
      },
      'manual-qa': {
        type: 'manual',
      },
    },
  };
}

describe('manual QA fallback guidance', () => {
  it('AT-MANUAL-QA-FALLBACK-001: uses normalized config for the built-in QA fallback path', () => {
    assert.equal(shouldSuggestManualQaFallback({
      roleId: 'qa',
      runtimeId: 'api-qa',
      classified: { error_class: 'missing_credentials' },
      config: makeConfig(),
    }), true);
  });

  it('AT-MANUAL-QA-FALLBACK-002: suppresses stale edit guidance after QA already moved to manual-qa', () => {
    const config = makeConfig();
    config.roles.qa.runtime_id = 'manual-qa';

    assert.equal(shouldSuggestManualQaFallback({
      roleId: 'qa',
      runtimeId: 'api-qa',
      classified: { error_class: 'missing_credentials' },
      config,
    }), false);
  });

  it('returns false when the fallback runtime is missing or not manual', () => {
    const config = makeConfig();
    config.runtimes['manual-qa'] = { type: 'local_cli' };

    assert.equal(shouldSuggestManualQaFallback({
      roleId: 'qa',
      runtimeId: 'api-qa',
      classified: { error_class: 'missing_credentials' },
      config,
    }), false);
  });
});
