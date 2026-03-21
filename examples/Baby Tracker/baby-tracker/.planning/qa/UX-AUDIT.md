# UX Audit — Baby Tracker

## Audit checklist

QA updates this every turn when the project has a user interface.

### First impressions (< 5 seconds)
- [ ] Is it immediately clear what this product does?
- [ ] Can the user find the primary action without scrolling?
- [ ] Does the page load in under 2 seconds?

### Navigation & flow
- [ ] Can the user complete the core workflow without getting lost?
- [ ] Are there dead ends (pages with no next action)?
- [ ] Does the back button work as expected?

### Forms & input
- [ ] Do all form fields have labels?
- [ ] Are error messages specific (not just "invalid input")?
- [ ] Is there feedback after submission (loading state, success message)?
- [ ] Do forms work with autofill?

### Visual consistency
- [ ] Is spacing consistent across pages?
- [ ] Are fonts consistent (max 2 font families)?
- [ ] Are button styles consistent?
- [ ] Are colors consistent with the design system?

### Responsive
- [ ] Does it work on mobile (375px)?
- [ ] Does it work on tablet (768px)?
- [ ] Does it work on desktop (1440px)?
- [ ] Are touch targets at least 44x44px on mobile?

### Accessibility
- [ ] Do all images have alt text?
- [ ] Is color contrast WCAG AA compliant (4.5:1 for text)?
- [ ] Can the entire app be navigated by keyboard?
- [ ] Do focus states exist for interactive elements?
- [ ] Are headings in correct hierarchy (h1 > h2 > h3)?

### Error states
- [ ] What does the user see when the network is offline?
- [ ] What does the user see when the server returns 500?
- [ ] What does the user see on an empty state (no data yet)?

## Issues found

| # | Issue | Severity | Page/Component | Screenshot/Description | Status |
|---|-------|----------|---------------|----------------------|--------|
| UX-001 | No UI in repository yet — checklist items not applicable until frontend ships | Info | — | Backend scaffold only | Open |
