#!/usr/bin/env node

import { stdin, stdout, stderr, exit } from 'node:process';
import { runReferenceFixture } from '../cli/src/lib/reference-conformance-adapter.js';

let input = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => {
  input += chunk;
});

stdin.on('end', () => {
  try {
    const fixture = JSON.parse(input);
    const result = runReferenceFixture(fixture);
    stdout.write(`${JSON.stringify(result)}\n`);
    exit(result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 2);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    stdout.write(`${JSON.stringify({
      status: 'error',
      message: error.message,
      actual: null,
    })}\n`);
    exit(2);
  }
});
