# Acceptance Matrix

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| AX-DLL-001 | Good fixture exits `0` | `test/cli.test.js` | PASS |
| AX-DLL-002 | Bad fixture exits `1` with multiple errors | `test/lint.test.js` | PASS |
| AX-DLL-003 | JSON mode returns machine-readable lint data | `test/cli.test.js` | PASS |
| AX-DLL-004 | Duplicate IDs are rejected deterministically | `test/lint.test.js` | PASS |
