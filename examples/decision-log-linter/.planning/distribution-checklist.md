# Distribution Checklist

## Packaging

- Package metadata reviewed
- Bin entry points to `bin/decision-log-linter.js`
- Version and README match the current CLI surface

## Install Paths

- Repo-local invocation: `node ./bin/decision-log-linter.js`
- Package bin invocation: `decision-log-linter`
- Test command: `npm test`

## Release Risks

- No published package name reserved yet
- Windows path quoting should stay covered if arguments expand later
- Directory glob support is intentionally out of scope for this slice
