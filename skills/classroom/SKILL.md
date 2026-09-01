---
name: classroom
description: "CLI for Google Classroom. View courses and course work directly from the terminal."
---

# classroom

This CLI provides a wrapper around the Google Classroom API. It is agent-first, meaning it emits structured JSON automatically when run non-interactively or with the `--json` flag.

## Commands

- `classroom auth login [--token=<token>]`
  - Authenticate the CLI using an OAuth 2.0 access token.
  - If `--token` is missing, prompts interactively. Non-interactive environments must provide `--token`.
- `classroom auth logout`
  - Clear the stored credentials.
- `classroom course list`
  - Lists all active courses.
- `classroom course get <id>`
  - Gets detailed information for a specific course ID.
- `classroom schema`
  - Outputs the expected JSON shape of CLI responses.

## JSON Envelope

All JSON outputs from commands are NDJSON (one object per line) or a single object.
Errors follow the AppError format:
```json
{
  "ok": false,
  "error": "Error message",
  "name": "ErrorName",
  "hint": "Optional hint on how to fix"
}
```

## Global Flags

- `--json`: Force JSON output mode (implied when piped or not in TTY).
- `--dry-run`: Evaluate command without mutating state.
- `--no-input`: Never prompt, fail fast (useful for agents/CI).
- `-q, --quiet`: Suppress non-essential output (like notes on stderr).
- `-v, --verbose`: Show verbose logging on stderr.
