# UX Audit — Baby Tracker

## Audit checklist

Last audited: 2026-03-21 (QA Turn 15)

### First impressions (< 5 seconds)
- [x] Is it immediately clear what this product does?
- [x] Can the user find the primary action without scrolling?
- [ ] Does the page load in under 2 seconds? (Not measured)

### Navigation & flow
- [x] Can the user complete the core workflow without getting lost?
- [ ] Are there dead ends (pages with no next action)? (`Timeline` and `Settings` routes are placeholders)
- [x] Does the back button work as expected?

### Forms & input
- [x] Do all form fields have labels?
- [x] Are error messages specific (not just "invalid input")?
- [x] Is there feedback after submission (loading state, success message)?
- [ ] Do forms work with autofill? (Not explicitly tested)

### Visual consistency
- [x] Is spacing consistent across pages?
- [x] Are fonts consistent (max 2 font families)?
- [x] Are button styles consistent?
- [x] Are colors consistent with the design system?

### Responsive
- [x] Does it work on mobile (375px)?
- [x] Does it work on tablet (768px)?
- [x] Does it work on desktop (1440px)?
- [x] Are touch targets at least 44x44px on mobile? (Bottom nav buttons use `h-16`)

### Accessibility
- [x] Do all images have alt text? (No `<img>` elements currently)
- [ ] Is color contrast WCAG AA compliant (4.5:1 for text)? (Not instrumented)
- [ ] Can the entire app be navigated by keyboard? (quick-log controls need clearer focus behavior)
- [ ] Do focus states exist for interactive elements? (quick-log cards still rely on default focus only)
- [x] Are headings in correct hierarchy (h1 > h2 > h3)?

### Error states
- [ ] What does the user see when the network is offline? (generic/limited messaging)
- [ ] What does the user see when the server returns 500? (no global boundary pattern)
- [x] What does the user see on an empty state (no data yet)?

## Issues found

| # | Issue | Severity | Page/Component | Screenshot/Description | Status |
|---|-------|----------|---------------|----------------------|--------|
| UX-002 | `Timeline` and `Settings` routes remain dead ends with placeholder text | P2 | `App` nested routes | Route content is static "coming soon" with no next action | Open |
| UX-007 | Quick-log cards lack explicit focus-ring styling for keyboard users | P2 | `Dashboard` quick-log buttons | Buttons have hover states but no explicit `focus:` ring classes | Open |
| UX-008 | Offline/server failure messaging is generic and not actionable | P2 | `Login`, `ForgotPassword`, `AddBaby`, `BabyContext` | Users get fallback errors like "Failed..." without recovery guidance | Open |
| UX-005 | Forgot-password entry point is now functional | P2 | `Login` | Linked to `/forgot-password` page and submit flow works | Fixed (Turn 10) |
| UX-006 | Quick-log cards now provide feedback on click | P2 | `Dashboard` | Buttons display "coming soon in Phase 2" alerts | Fixed (Turn 10) |
| UX-009 | React Router v7 future-flag warnings appear during frontend test runs | P3 | Frontend routing/test setup | Console warns about `v7_startTransition` and `v7_relativeSplatPath`; no user-facing break yet | Open |
