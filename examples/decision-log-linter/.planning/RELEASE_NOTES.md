# Release Notes

## User Impact

Teams can lint markdown decision logs before merge and fail CI when duplicate IDs or incomplete decisions slip in.

## Verification Summary

`node --test` covers parser, lint, and CLI behavior. Fixture-based smoke commands also prove the good and bad paths directly.
