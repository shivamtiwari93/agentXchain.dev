# AgentXchain.dev — Brand Guidelines

---

## Logo

The logo is an interlocking chain-link "X" mark in blue and green, representing multi-agent coordination (two links working together). Three variants exist:

| Variant | Use |
|---------|-----|
| **App icon** (square, dark gradient bg + wordmark below) | Favicons, app icons, social avatars |
| **Horizontal lockup** (dark pill bg + wordmark right of icon) | Headers, nav bars, GitHub social preview |
| **Icon only** (no background, no text) | Small sizes, watermarks, loading states |

The TLD `.dev` is rendered in **orange** to distinguish from `.ai`.

---

## Colors

### Primary palette

| Name | Hex | Usage |
|------|-----|-------|
| **Chain Blue** | `#2B7CB6` | Left chain link, primary accent, links, buttons |
| **Chain Green** | `#6BB536` | Right chain link, success states, secondary accent |
| **Dev Orange** | `#E8752A` | `.dev` TLD in wordmark; use sparingly for highlights |

### Backgrounds

| Name | Hex | Usage |
|------|-----|-------|
| **Deep Navy** | `#0D1B2A` | Page background, dark mode default |
| **Card Dark** | `#152238` | Cards, code blocks, elevated surfaces |
| **Gradient start** | `#0F2027` | Logo background gradient (left/top) |
| **Gradient end** | `#1A4A2E` | Logo background gradient (right/bottom) |

### Text

| Name | Hex | Usage |
|------|-----|-------|
| **Primary text** | `#E6EDF3` | Body text, headings |
| **Muted text** | `#8B949E` | Captions, secondary labels, footer |
| **White** | `#FFFFFF` | Text on colored buttons, wordmark "agent" and "chain" |

---

## Typography

| Element | Font | Weight | Size (web) |
|---------|------|--------|------------|
| **Headings** | `system-ui, -apple-system, "Segoe UI", sans-serif` | 700 (Bold) | H1: 1.75rem, H2: 1.15rem |
| **Body** | Same stack | 400 (Regular) | 1rem / 16px |
| **Code / mono** | `"SF Mono", "Fira Code", "JetBrains Mono", monospace` | 400 | 0.9rem |
| **Wordmark** | Custom / logo asset (do not recreate in CSS) | — | — |

---

## Spacing and layout

- Max content width: **720px** (centered).
- Base spacing unit: **0.5rem** (8px). Use multiples: 1rem, 1.5rem, 2rem.
- Border radius: **6px** for buttons/cards, **8px** for larger containers.

---

## Do's and Don'ts

- **Do** use the icon-only variant at small sizes (< 32px).
- **Do** keep generous whitespace around the logo (min clear space = height of the "X" icon).
- **Do** use Chain Blue for interactive elements (links, buttons).
- **Don't** recreate the wordmark in CSS — always use the logo asset.
- **Don't** place the logo on a busy or light background without the dark pill/square container.
- **Don't** recolor the chain links — always blue-left, green-right.

---

## File reference

Logo files are in `website/assets/logos/`. Use the appropriate variant for the context.
