# Platform Support

## Supported Environments

- Operating systems: macOS, Linux, Windows
- Shells / terminals: any shell that can invoke Node.js
- Node / runtime versions: Node.js 18.17+

## Compatibility Risks
| Surface | Risk | Mitigation |
|---------|------|------------|
| Newline styles | Windows `CRLF` can break naive parsers | Parse with `\r?\n` handling |
| CI pipelines | Human-only output is hard to automate | `--json` mode for machine parsing |
| Large files | Repeated file reads waste work | Single-pass parse plus in-memory linting |

## Manual Checks

- Install path verified via repo-local `node ./bin/decision-log-linter.js`
- Non-interactive behavior verified through `node --test`
- Path / permission edge cases covered by unreadable-file CLI test
