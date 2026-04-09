# Acceptance Matrix

## Template Guidance

- [x] Public API surface reviewed and intentionally versioned
- [x] Compatibility or migration expectations documented for consumers
- [x] Install/import or package-consumer smoke path verified

| Req # | Assertion | Proof | Status |
|-------|-----------|-------|--------|
| SG-001 | Primitive schemas parse valid inputs | `test/schema.test.js` | PASS |
| SG-002 | `parse()` throws `SchemaGuardError` with issue metadata | `test/schema.test.js` | PASS |
| SG-003 | Nested objects preserve accurate error paths | `test/object.test.js` | PASS |
| SG-004 | Unknown keys are rejected by default | `test/object.test.js` | PASS |
| SG-005 | Composition supports refine, transform, pipe, and union | `test/composition.test.js` | PASS |
| SG-006 | Optional, nullable, and default behaviors are predictable | `test/object.test.js`, `test/composition.test.js` | PASS |
| SG-007 | Realistic nested payload validation works end-to-end | `test/smoke.js` | PASS |
| SG-008 | Library workflow-kit validates cleanly | `agentxchain template validate --json` | PASS |
| SG-009 | Package metadata is distribution-ready | `npm pack --dry-run` | PASS |
