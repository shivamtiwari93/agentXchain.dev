import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseCommandArgs } from '../src/lib/verify-command.js';

describe('parseCommandArgs', () => {
  it('returns an empty array for blank input', () => {
    assert.deepEqual(parseCommandArgs('   '), []);
  });

  it('returns array input unchanged except for non-string entries', () => {
    assert.deepEqual(parseCommandArgs(['npm', 'test', '', 123, 'run']), ['npm', 'test', 'run']);
  });

  it('splits a simple command string', () => {
    assert.deepEqual(parseCommandArgs('npm test'), ['npm', 'test']);
  });

  it('preserves quoted segments', () => {
    assert.deepEqual(parseCommandArgs('node -e "process.exit(0)"'), ['node', '-e', 'process.exit(0)']);
  });

  it('handles escaped spaces', () => {
    assert.deepEqual(parseCommandArgs('echo hello\\ world'), ['echo', 'hello world']);
  });

  it('handles single quoted segments', () => {
    assert.deepEqual(parseCommandArgs("node -e 'console.log(1)'"), ['node', '-e', 'console.log(1)']);
  });
});
