# Website Homepage CTA Logo Alignment Spec

## Purpose

Keep the end-of-page homepage CTA icon centered above the headline and buttons on all supported viewport sizes.

## Interface

- Homepage footer-adjacent CTA in `website-v2/src/pages/index.tsx`
- CTA-specific styling in `website-v2/src/css/custom.css`

## Behavior

- The end-of-page CTA icon uses a CTA-specific class instead of reusing the hero logo class.
- The CTA icon is rendered as a block-level element with horizontal auto margins.
- The icon remains visually centered relative to the CTA headline and button group on desktop and mobile layouts.

## Error Cases

- Reusing `.hero-logo` for the CTA allows hero styling changes to break footer CTA alignment.
- Relying on `text-align: center` alone does not center a block-level `<img>`.

## Acceptance Tests

- `AT-CTA-LOGO-001`: The homepage CTA icon uses `className="cta-logo"`.
- `AT-CTA-LOGO-002`: CTA CSS centers the icon with `display: block` and `margin: 0 auto 1.5rem`.
- `AT-CTA-LOGO-003`: The built homepage keeps the CTA icon horizontally centered at desktop and mobile widths.

## Open Questions

- None.
