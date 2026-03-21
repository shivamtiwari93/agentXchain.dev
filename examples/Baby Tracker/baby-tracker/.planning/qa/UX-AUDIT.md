# UX Audit — Baby Tracker

## Audit checklist

Last audited: 2026-03-21 (QA Turn 2)

### First impressions (< 5 seconds)
- [x] Is it immediately clear what this product does?
- [x] Can the user find the primary action without scrolling?
- [ ] Does the page load in under 2 seconds? (Not measured)

### Navigation & flow
- [ ] Can the user complete the core workflow without getting lost? (Auth + baby flows missing)
- [ ] Are there dead ends (pages with no next action)? (`History` and `Settings` are placeholders)
- [ ] Does the back button work as expected? (No route-based navigation yet)

### Forms & input
- [ ] Do all form fields have labels? (Auth/baby forms not implemented)
- [ ] Are error messages specific (not just "invalid input")? (No validation flows yet)
- [ ] Is there feedback after submission (loading state, success message)? (No submit flows yet)
- [ ] Do forms work with autofill? (Not testable yet)

### Visual consistency
- [ ] Is spacing consistent across pages?
- [ ] Are fonts consistent (max 2 font families)?
- [ ] Are button styles consistent?
- [ ] Are colors consistent with the design system?

### Responsive
- [ ] Does it work on mobile (375px)? (Needs browser-level verification)
- [ ] Does it work on tablet (768px)? (Desktop/tablet-specific nav not implemented)
- [ ] Does it work on desktop (1440px)? (Expected sidebar absent)
- [x] Are touch targets at least 44x44px on mobile? (Bottom nav buttons use `h-16`)

### Accessibility
- [x] Do all images have alt text? (No `<img>` elements currently)
- [ ] Is color contrast WCAG AA compliant (4.5:1 for text)? (Not measured)
- [ ] Can the entire app be navigated by keyboard? (Not validated end-to-end)
- [ ] Do focus states exist for interactive elements? (No explicit focus styling)
- [x] Are headings in correct hierarchy (h1 > h2 > h3)?

### Error states
- [ ] What does the user see when the network is offline? (No handling UI)
- [ ] What does the user see when the server returns 500? (No handling UI)
- [ ] What does the user see on an empty state (no data yet)? (Required empty state missing)

## Issues found

| # | Issue | Severity | Page/Component | Screenshot/Description | Status |
|---|-------|----------|---------------|----------------------|--------|
| UX-001 | Core user flow cannot be completed because auth and baby profile screens are missing | P1 | `App` | No sign-up/login/add-baby paths are present in current UI | Open |
| UX-002 | `History` and `Settings` screens are dead ends with placeholder text only | P2 | `History`, `Settings` tabs | "coming soon" content has no next action | Open |
| UX-003 | Phase 1 desktop/tablet navigation spec not met (sidebar absent) | P2 | App shell navigation | Bottom nav is fixed at all breakpoints | Open |
| UX-004 | Empty state for dashboard ("No events logged yet...") is missing | P1 | Dashboard/Home | Hardcoded event cards shown instead of true empty state | Open |
