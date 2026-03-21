# UX Audit — Baby Tracker

## Audit checklist

Last audited: 2026-03-21 (QA Turn 6)

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
- [ ] Do focus states exist for interactive elements? (quick-log cards missing explicit focus style)
- [x] Are headings in correct hierarchy (h1 > h2 > h3)?

### Error states
- [ ] What does the user see when the network is offline? (backend-down handling is weak)
- [ ] What does the user see when the server returns 500? (no global boundary pattern)
- [x] What does the user see on an empty state (no data yet)?

## Issues found

| # | Issue | Severity | Page/Component | Screenshot/Description | Status |
|---|-------|----------|---------------|----------------------|--------|
| UX-002 | `Timeline` and `Settings` routes remain dead ends with placeholder text | P2 | `App` nested routes | Route content is static "coming soon" with no next action | Open |
| UX-005 | Forgot-password entry point is a non-functional link | P2 | `Login` | `href="#"` does not start reset flow | Open |
| UX-006 | Quick-log cards look actionable but do not do anything | P2 | `Dashboard` | No click handler/feedback for Feed/Sleep/Diaper/Note buttons | Open |
