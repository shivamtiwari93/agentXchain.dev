# Phase 1 Tests — Project Setup & Auth

## Automated (backend)

| ID | Area | Test | Runner | Status |
|----|------|------|--------|--------|
| A0.1 | Health | `GET /health` returns `{ "status": "ok" }` | Vitest + Supertest | Pass |
| A0.2 | Auth | Register/login/duplicate/weak password/logout invalidation/forgot password | Vitest + Supertest | Pass |
| A0.3 | Babies | 401 without token, create/list, update, delete creator vs non-creator | Vitest + Supertest | Pass |
| A0.4 | Health edge | `POST /health` returns `404` | Vitest + Supertest | Pass |
| A0.5 | Auth edge (QA-added) | `POST /auth/forgot-password` with missing email returns `400` | Vitest + Supertest | Pass |
| A0.6 | Migrations (BUG-006) | Second open of same DB file does not repeat `ALTER` migrations | Vitest + temp file | Pass |
| A0.7 | Babies PUT (BUG-007) | `PUT /babies/:id` with `name: 123` returns `400` | Vitest + Supertest | Pass |
| A0.8 | Babies PUT edge (QA-added) | `PUT /babies/:id` with non-string `date_of_birth` returns `400` | Vitest + Supertest | Pass |
| A0.9 | Auth edge (QA-added) | `POST /auth/login` accepts surrounding whitespace in email | Vitest + Supertest | Pass |

## Test Matrix

| ID | Requirement | Test Description | Type | Expected Result | Status |
|----|-------------|-----------------|------|----------------|--------|
| T1.1 | R1 | Register with valid email/password/name | API | 201 + JWT token returned | Pass |
| T1.2 | R1 | Register with duplicate email | API | 409 Conflict + clear error message | Pass |
| T1.3 | R1 | Register with invalid email format | API | 400 + validation error | Pass |
| T1.4 | R1 | Register with weak password (< 8 chars) | API | 400 + validation error | Pass |
| T1.5 | R1 | Login with valid credentials | API | 200 + JWT token returned | Pass |
| T1.6 | R1 | Login with wrong password | API | 401 + "invalid credentials" | Pass |
| T1.7 | R1 | Login with non-existent email | API | 401 + "invalid credentials" | Pass |
| T1.8 | R1 | Access protected route without token | API | 401 Unauthorized | Pass |
| T1.9 | R1 | Access protected route with invalidated session token | API | 401 Unauthorized | Pass |
| T1.10 | R1 | Session persists across browser restart | E2E | User remains logged in after restart | Partial (token persists in localStorage; no automated restart proof) |
| T1.11 | R2 | Create baby with name, DOB, gender | API | 201 + baby object returned with auto-linked caregiver | Pass |
| T1.12 | R2 | Create baby with missing required fields | API | 400 + specific field validation errors | Pass |
| T1.13 | R2 | List babies for authenticated user | API | 200 + array of user's babies only | Pass |
| T1.14 | R2 | Update baby profile | API | 200 + updated baby object | Pass |
| T1.15 | R2 | Delete baby profile (as creator) | API | 204 + baby removed from list | Pass |
| T1.16 | R2 | Delete baby profile (not creator) | API | 403 Forbidden | Pass |
| T1.17 | R2 | Switch between multiple babies in UI | E2E | Dashboard updates to selected baby's name/age | Pass (manual) |
| T1.18 | R11 | App renders at 375px width | Visual | No horizontal scroll, bottom nav visible, all content accessible | Pass (manual) |
| T1.19 | R11 | App renders at 768px width | Visual | Layout adapts for tablet | Pass (manual) |
| T1.20 | R11 | App renders at 1440px width | Visual | Sidebar nav visible, content well-spaced | Pass (manual) |
| T1.21 | R11 | Touch targets on mobile | Visual | All interactive elements are at least 44px | Pass |
| T1.22 | R2 | Baby age calculation | Unit/UI | Age displays human-readable value | Pass |

## Security Tests

| ID | Test Description | Expected Result | Status |
|----|-----------------|----------------|--------|
| S1.1 | Passwords are hashed (not stored in plaintext) | Database contains hash, not raw password | Pass (bcrypt in auth flow; indirect verification) |
| S1.2 | JWT contains no sensitive data | JWT payload excludes password/email plaintext | Pass (manual decode check) |
| S1.3 | SQL injection in login fields | Input is sanitized; no SQL error or data leak | Pass (`401 Invalid credentials`) |
| S1.4 | XSS in baby/user fields | Script tags are escaped in rendered output | Partial (API accepts raw string; rendering escapes by React, no sanitization policy) |
| S1.5 | User A cannot access User B's babies | GET /babies returns only authenticated user's babies | Pass (route joins by caregiver and tests cover authorization) |

## Edge Cases

| ID | Test Description | Expected Result | Status |
|----|-----------------|----------------|--------|
| E1.1 | Register with emoji in name | Accepted and displayed correctly | Untested |
| E1.2 | Baby name with special characters | Accepted and displayed correctly | Untested |
| E1.3 | Baby DOB in the future | Rejected with validation error | Pass |
| E1.4 | Baby DOB more than 5 years ago | Accepted (toddler tracking is valid) | Untested |
| E1.5 | Create 10+ babies for one user | All listed correctly, switcher remains usable | Untested |

## Turn 10 QA verification notes

- Re-verified BUG-006 fix by restarting backend against persisted DB; startup succeeded without migration crash.
- Re-verified BUG-007 fix using manual API probes for wrong types on `name` and `gender`.
- Re-verified BUG-008 and BUG-009 frontend fixes (forgot-password route and quick-log feedback).
- New blocker found: UI still lacks edit/delete baby profile flows (BUG-010, P1).

## Turn 15 QA verification notes

- Re-ran full test suite: backend `19/19` pass, frontend `3/3` pass.
- Re-checked unhappy paths for auth/API security and session invalidation; all expected responses observed.
- Verified BUG-010 implementation via route/component inspection and updated acceptance status.
- Added QA auth edge-case regression for login email trimming.
