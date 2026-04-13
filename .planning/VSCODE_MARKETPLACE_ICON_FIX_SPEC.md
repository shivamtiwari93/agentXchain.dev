# VS Code Marketplace Icon Fix Spec

## Purpose

Replace the broken placeholder icon shipped by the AgentXchain VS Code extension with the real website brand mark so the Marketplace listing and VS Code extension sidebar render the correct AgentXchain identity.

## Interface

- Extension package: `cli/vscode-extension/package.json`
  - `icon` must point to `media/icon.png`
- Icon asset: `cli/vscode-extension/media/icon.png`
  - must be a valid 128x128 PNG
  - must be derived from the website's AgentXchain icon asset, not a placeholder fill image
- Proof surface: `cli/test/vscode-marketplace-readiness.test.js`

## Behavior

- The packaged VSIX must include `extension/media/icon.png`.
- The packaged icon must be a real branded image, not a solid-color placeholder.
- The icon contract must remain explicit enough that a future release cannot silently regress to a tiny placeholder file while leaving the `package.json` path untouched.
- The extension version must bump before republishing so Marketplace caches are forced to refresh on a new release.

## Error Cases

- `package.json` points at `media/icon.png` but the file is missing.
- `media/icon.png` exists but is not 128x128.
- `media/icon.png` is a tiny placeholder asset that technically parses as PNG but does not contain the real brand image.
- The VSIX is rebuilt without the updated icon asset.

## Acceptance Tests

- `cli/test/vscode-marketplace-readiness.test.js` asserts:
  - the icon file exists
  - the icon file is a PNG
  - the icon dimensions are exactly 128x128
  - the icon file size is materially larger than the previous 306-byte placeholder
- Local packaging includes `extension/media/icon.png` in the VSIX.
- After version bump and `vsce-v*` tag publish, Marketplace verification shows the new extension version live.

## Open Questions

- None for this repair slice. The correct brand source is already present in `website-v2/static/img/agentXchain.dev_icon_only_280x280px.png`.
