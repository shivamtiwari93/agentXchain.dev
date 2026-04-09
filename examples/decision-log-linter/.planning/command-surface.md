# Command Surface

## Primary Commands
| Command | Purpose | Inputs | Output / Side Effects |
|---------|---------|--------|------------------------|
| `decision-log-linter lint <file>` | Lint one markdown decision log | file path | Exit code plus human-readable summary |
| `decision-log-linter lint <file> --json` | Lint one markdown decision log for CI | file path | JSON payload to stdout |

## Flags And Options
| Command | Flag | Meaning | Default |
|---------|------|---------|---------|
| `lint` | `--json` | Emit machine-readable JSON instead of human text | `false` |

## Failure UX

- Invalid command prints usage and exits `2`
- Unreadable file prints a concrete read error and exits `2`
- Lint failures print all detected errors and exit `1`
