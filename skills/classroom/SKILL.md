---
name: classroom
description: "CLI for Google Classroom. View courses and course work directly from the terminal."
---

# classroom

This CLI provides a wrapper around the Google Classroom API. It is agent-first, meaning it emits structured JSON automatically when run non-interactively or with the `--json` flag.

## Commands

- `classroom auth login [--client-id=<id> --client-secret=<secret>]`
  - Authenticate the CLI using an OAuth 2.0 Desktop flow. Opens your browser and runs a local server on port 3000 to capture the Google authorization code.
  - Automatically attempts to load credentials from `credentials.json` if placed in the standard configuration directory (e.g., `~/.config/classroom-cli/credentials.json` on macOS/Linux).
  - If no JSON file is found and flags are missing, prompts interactively. Non-interactive environments must provide these flags, environment variables, or a `credentials.json` file.
- `classroom auth logout`
  - Clear the stored credentials.
- `classroom course list`
  - Lists all active courses.
- `classroom course get <id>`
  - Gets detailed information for a specific course ID.
- `classroom schema`
  - Outputs the expected JSON shape of CLI responses.
- `classroom course stream <id>`
  - Get announcements for a course.
- `classroom course work <id>`
  - Get coursework (assignments, quizzes, materials) for a course.
- `classroom tasks pending`
  - List pending (not turned in) assignments across all active courses.
- `classroom tasks due-soon`
  - List pending assignments due in the next 7 days across all active courses.

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
