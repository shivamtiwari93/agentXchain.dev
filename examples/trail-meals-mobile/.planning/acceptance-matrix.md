# Acceptance Matrix

| Req # | Requirement | Evidence | Status |
|-------|-------------|----------|--------|
| TM-001 | Trip creation validates name, startDate, days (positive int) | `test/model.test.js` | PASS |
| TM-002 | Trip rejects zero, negative, and fractional days | `test/model.test.js` | PASS |
| TM-003 | Ingredient rejects negative calories and weight | `test/model.test.js` | PASS |
| TM-004 | Ingredient calorie computation matches formula | `test/model.test.js` | PASS |
| TM-005 | Meal type validation rejects invalid types | `test/model.test.js` | PASS |
| TM-006 | Meal totalCalories and totalWeightG are correct | `test/model.test.js` | PASS |
| TM-007 | Per-day and per-trip calorie/weight totals are correct | `test/planner.test.js` | PASS |
| TM-008 | Over-budget flag triggers when weight exceeds budget | `test/planner.test.js` | PASS |
| TM-009 | Over-budget flag does not trigger when budget is 0 | `test/planner.test.js` | PASS |
| TM-010 | Low-calorie days are correctly identified | `test/planner.test.js` | PASS |
| TM-011 | Empty trip and empty meals handled gracefully | `test/planner.test.js` | PASS |
| TM-012 | Offline store loads empty array from fresh backend | `test/storage.test.js` | PASS |
| TM-013 | Offline store saves and loads trip with roundtrip fidelity | `test/storage.test.js` | PASS |
| TM-014 | Offline store deletes trip by ID | `test/storage.test.js` | PASS |
| TM-015 | Offline store updates trip in place | `test/storage.test.js` | PASS |
| TM-016 | `agentxchain template validate --json` passes | Contract test | PASS |
| TM-017 | React Native screens use SafeAreaView, not HTML | Code review | PASS |
| TM-018 | app.json contains iOS and Android platform entries | File exists | PASS |
