# Phase 2 Tests — Core Tracking + Timeline

## Automated (target)

| ID | Area | Test | Runner | Status |
|----|------|------|--------|--------|
| A2.1 | Feeding | Create/list/update/delete feeding entry | Vitest + Supertest | Untested |
| A2.2 | Diaper | Create/list/update/delete diaper entry | Vitest + Supertest | Untested |
| A2.3 | Sleep | Start/stop sleep and manual sleep logging | Vitest + Supertest | Untested |
| A2.4 | Timeline | Unified timeline returns mixed events in correct order | Vitest + Supertest | Untested |
| A2.5 | Frontend | Timeline route renders fetched events and empty state | Vitest + RTL | Untested |
| A2.6 | Frontend | One quick-log flow submits and handles API errors | Vitest + RTL | Untested |

## Test Matrix

| ID | Requirement | Test Description | Type | Expected Result | Status |
|----|-------------|-----------------|------|----------------|--------|
| T2.1 | R3 | Create feeding with valid type, amount/duration, timestamp | API | 201 + feeding returned | Untested |
| T2.2 | R3 | Reject feeding with invalid type | API | 400 + validation error | Untested |
| T2.3 | R3 | Edit feeding entry | API/UI | Updated values reflected in timeline | Untested |
| T2.4 | R3 | Delete feeding entry | API/UI | Entry removed from timeline | Untested |
| T2.5 | R4 | Create diaper with valid type and timestamp | API | 201 + diaper returned | Untested |
| T2.6 | R4 | Reject diaper with invalid type | API | 400 + validation error | Untested |
| T2.7 | R4 | Edit/delete diaper entry | API/UI | Entry updates and disappears correctly | Untested |
| T2.8 | R5 | Start active sleep session | API/UI | Active sleep indicator appears | Untested |
| T2.9 | R5 | Stop active sleep session | API/UI | Duration calculated and timeline updated | Untested |
| T2.10 | R5 | Manual sleep entry with start and end | API/UI | Duration calculated correctly | Untested |
| T2.11 | R5 | Prevent invalid sleep ranges or overlapping active state | API | 400 + clear error | Untested |
| T2.12 | R8 | Timeline defaults to today | UI | Today's entries shown first | Untested |
| T2.13 | R8 | Timeline shows mixed event types in reverse chronological order | API/UI | Ordered unified feed | Untested |
| T2.14 | R8 | Navigate to past days | UI | Prior-day entries load correctly | Untested |
| T2.15 | R8 | Empty timeline state | UI | Clear empty-state guidance shown | Untested |

## Security Tests

| ID | Test Description | Expected Result | Status |
|----|-----------------|----------------|--------|
| S2.1 | User A cannot create/update/delete entries for User B's baby | 403/404 and no data change | Untested |
| S2.2 | Invalid enum or wrong-type payload for tracking routes | 400 + specific validation error | Untested |
| S2.3 | SQL injection payloads in notes/fields | No SQL error or data leak | Untested |
| S2.4 | XSS payloads in notes | Rendered safely in timeline | Untested |
| S2.5 | Reusing invalidated token against tracking routes | 401 Unauthorized | Untested |

## Edge Cases

| ID | Test Description | Expected Result | Status |
|----|-----------------|----------------|--------|
| E2.1 | Feeding timestamp in the future | Rejected with validation error | Untested |
| E2.2 | Diaper note longer than expected UI field | Stored or rejected consistently with validation rules | Untested |
| E2.3 | Double-stop active sleep | Second stop rejected safely | Untested |
| E2.4 | Sleep entry crossing midnight | Duration correct and timeline placement correct | Untested |
| E2.5 | Multiple events logged in same minute | Stable ordering and no dropped entries | Untested |
