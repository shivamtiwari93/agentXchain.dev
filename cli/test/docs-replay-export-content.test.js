import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const CLI_DOCS = read('website-v2/docs/cli.mdx');
const SPEC = read('.planning/REPLAY_EXPORT_SPEC.md');
const REAL_ARTIFACT_SPEC = read('.planning/REPLAY_EXPORT_REAL_ARTIFACT_SPEC.md');

describe('replay export docs contract', () => {
  it('documents replay export in the CLI command map and dedicated section', () => {
    assert.match(CLI_DOCS, /\| `replay export` \| Observability \|/);
    assert.match(CLI_DOCS, /### `replay export`/);
    assert.match(CLI_DOCS, /agentxchain replay export <export-file> \[--port <port>\] \[--json\] \[--no-open\]/);
  });

  it('keeps replay export broader than restore and honest about coordinator replay', () => {
    assert.match(CLI_DOCS, /Unlike `restore`, `replay export` is an observability surface, not a continuity surface\./);
    assert.match(CLI_DOCS, /accepts both governed run exports and coordinator exports/i);
    assert.match(CLI_DOCS, /temporary workspace/i);
    assert.match(CLI_DOCS, /Coordinator exports.*rehydrate the coordinator workspace plus every successful embedded child repo export/i);
    assert.match(CLI_DOCS, /failed child repo export/i);
    assert.match(CLI_DOCS, /minimal placeholder governed repo/i);
    assert.match(CLI_DOCS, /cleaned up automatically/i);
    assert.match(CLI_DOCS, /fully read-only: no gate approval and no live mutation path/i);
  });
});

describe('replay export spec contract', () => {
  it('freezes the broader-than-restore replay boundary in the main spec', () => {
    assert.match(SPEC, /This command is intentionally broader than `restore`\./);
    assert.match(SPEC, /accepts both governed run exports and coordinator exports\./);
    assert.match(SPEC, /agentxchain_run_export/);
    assert.match(SPEC, /agentxchain_coordinator_export/);
    assert.match(SPEC, /files_restored, temp_dir/);
    assert.match(SPEC, /placeholder governed repo/i);
    assert.match(SPEC, /AT-REPLAY-EXPORT-008/);
    assert.match(SPEC, /AT-REPLAY-EXPORT-009/);
  });

  it('keeps the real-artifact spec aligned with coordinator replay truth', () => {
    assert.match(REAL_ARTIFACT_SPEC, /Run export.*agentxchain_run_export/is);
    assert.match(REAL_ARTIFACT_SPEC, /Coordinator export.*agentxchain_coordinator_export/is);
    assert.match(REAL_ARTIFACT_SPEC, /restore the nested run-export files relative to that repo root/i);
    assert.match(REAL_ARTIFACT_SPEC, /failed child repos.*minimal governed placeholder repo/i);
    assert.match(REAL_ARTIFACT_SPEC, /files_restored/);
    assert.match(REAL_ARTIFACT_SPEC, /temp_dir/);
    assert.match(REAL_ARTIFACT_SPEC, /AT-REPLAY-REAL-003/);
    assert.match(REAL_ARTIFACT_SPEC, /AT-REPLAY-REAL-005/);
  });
});
