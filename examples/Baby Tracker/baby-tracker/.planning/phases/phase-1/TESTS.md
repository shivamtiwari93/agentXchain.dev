# Phase 1 Tests — Project Setup & Auth

## Automated (backend)

| ID | Area | Test | Runner | Status |
|----|------|------|--------|--------|
| A0.1 | Health | `GET /health` returns `{ "status": "ok" }` | Vitest + Supertest | Pass |

## Test Matrix

| ID | Requirement | Test Description | Type | Expected Result | Status |
|----|-------------|-----------------|------|----------------|--------|
| T1.1 | R1 | Register with valid email/password/name | API | 201 + JWT token returned | Untested |
| T1.2 | R1 | Register with duplicate email | API | 409 Conflict + clear error message | Untested |
| T1.3 | R1 | Register with invalid email format | API | 400 + validation error | Untested |
| T1.4 | R1 | Register with weak password (< 8 chars) | API | 400 + validation error | Untested |
| T1.5 | R1 | Login with valid credentials | API | 200 + JWT token returned | Untested |
| T1.6 | R1 | Login with wrong password | API | 401 + "invalid credentials" (not "wrong password") | Untested |
| T1.7 | R1 | Login with non-existent email | API | 401 + "invalid credentials" (same message as wrong password) | Untested |
| T1.8 | R1 | Access protected route without token | API | 401 Unauthorized | Untested |
| T1.9 | R1 | Access protected route with expired token | API | 401 Unauthorized | Untested |
| T1.10 | R1 | Session persists across browser restart | E2E | User remains logged in after closing and reopening browser | Untested |
| T1.11 | R2 | Create baby with name, DOB, gender | API | 201 + baby object returned with auto-linked caregiver | Untested |
| T1.12 | R2 | Create baby with missing required fields | API | 400 + specific field validation errors | Untested |
| T1.13 | R2 | List babies for authenticated user | API | 200 + array of user's babies only | Untested |
| T1.14 | R2 | Update baby profile | API | 200 + updated baby object | Untested |
| T1.15 | R2 | Delete baby profile (as creator) | API | 200 + baby removed from list | Untested |
| T1.16 | R2 | Delete baby profile (not creator) | API | 403 Forbidden | Untested |
| T1.17 | R2 | Switch between multiple babies in UI | E2E | Dashboard updates to show selected baby's name and age | Untested |
| T1.18 | R11 | App renders at 375px width | Visual | No horizontal scroll, bottom nav visible, all content accessible | Untested |
| T1.19 | R11 | App renders at 768px width | Visual | Layout adapts appropriately for tablet | Untested |
| T1.20 | R11 | App renders at 1440px width | Visual | Sidebar nav visible, content well-spaced | Untested |
| T1.21 | R11 | Touch targets on mobile | Visual | All interactive elements are at least 44px | Untested |
| T1.22 | R2 | Baby age calculation | Unit | Age displays correctly: "2 months, 5 days" or similar human-readable format | Untested |

## Security Tests

| ID | Test Description | Expected Result | Status |
|----|-----------------|----------------|--------|
| S1.1 | Passwords are hashed (not stored in plaintext) | Database contains bcrypt/argon2 hash, not raw password | Untested |
| S1.2 | JWT contains no sensitive data | Decoding JWT shows only user ID and expiry, not password or email | Untested |
| S1.3 | SQL injection in login fields | Input is sanitized; no SQL error or data leak | Untested |
| S1.4 | XSS in baby name field | Script tags are escaped in rendered output | Untested |
| S1.5 | User A cannot access User B's babies | GET /babies returns only the authenticated user's babies | Untested |

## Edge Cases

| ID | Test Description | Expected Result | Status |
|----|-----------------|----------------|--------|
| E1.1 | Register with emoji in name | Accepted and displayed correctly | Untested |
| E1.2 | Baby name with special characters | Accepted and displayed correctly | Untested |
| E1.3 | Baby DOB in the future | Rejected with validation error | Untested |
| E1.4 | Baby DOB more than 5 years ago | Accepted (toddler tracking is valid) | Untested |
| E1.5 | Create 10+ babies for one user | All listed correctly, switcher remains usable | Untested |
