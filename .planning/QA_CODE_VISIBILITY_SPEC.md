# QA Code Visibility Spec

## Purpose

Close the remaining QA evidence gap after `DEC-QA-EVIDENCE-001` and `DEC-QA-EVIDENCE-002`.

Review turns can now see the previous turn's files changed and verification summary, but not the actual changed file contents. In live Scenario A rerun Turn 72, QA still raised false objections because it had to guess:

- `test.js` already used `execFileSync(...)`, so the cross-process persistence objection was wrong.
- `todo.js` already returned immediately after setting `process.exitCode`, so the "error path keeps executing" objection overstated the risk.

The product gap is not only evidence visibility. It is **code visibility for review turns**.

## Interface

### CONTEXT.md

For a `review_only` turn, `renderContext()` adds a new section under "Last Accepted Turn":

`### Changed File Previews`

Each preview contains:

- the relative file path from `lastTurn.files_changed`
- a fenced code block with a bounded preview of the file contents from the working tree
- a truncation note when the preview exceeds the configured limit

Example shape:

```md
### Changed File Previews

#### `test.js`

```js
const { execFileSync } = require('child_process');
...
```

#### `todo.js`

```js
function done(idStr) {
  ...
  process.exitCode = 1;
  return;
}
```
```

## Behavior

- Only `review_only` target turns get file previews.
- Only files from `lastTurn.files_changed` are considered.
- Missing files are skipped silently; this is a context aid, not a hard requirement.
- Preview size is bounded to avoid prompt bloat:
  - at most 5 files
  - at most 80 lines per file
- If a file exceeds the line cap, append a truncation marker after the preview.
- Existing context sections remain unchanged.

## Error Cases

- Binary or unreadable files: skip them and leave the rest of the context intact.
- Deleted files from `lastTurn.files_changed`: skip them.
- Extremely large changed-file sets: preview the first 5 files only.

## Acceptance Tests

1. `AT-QCV-001`: A QA dispatch bundle following a dev turn includes a `Changed File Previews` section with the contents of changed product files.
2. `AT-QCV-002`: File previews are omitted for authoritative target turns.
3. `AT-QCV-003`: Long files are truncated with an explicit truncation marker.
4. `AT-QCV-004`: Missing changed files do not break bundle generation or emit empty preview headings.

## Open Questions

- Whether verification machine evidence should later capture stdout/stderr excerpts in addition to exit codes. That is a separate slice and not required for this visibility fix.
