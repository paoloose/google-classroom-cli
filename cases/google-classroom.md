# Google Classroom CLI Case

**Target:** Node.js (via bun) published to npm, globally linked
**Terrain:** Wrapping a discovered 3rd-party API (Google Classroom). Data shapes are defined by `googleapis`.
**Blocks Adopted:**
- `error-map`, `argv`, `global-flags`, `json-mode`, `detect`, `style`, `banner`, `session`, `xdg-paths`, `prompt-secret`
**Blocks Rejected:**
- `audit-log`, `audit-lifecycle`, `killswitch`: The domain right now only fetches read-only information (`course list`, `course get`). Destructive/mutation operations haven't been implemented yet, so safety primitives were not strictly required.
- `doctor`: The API is simple enough that `auth login` and subsequent requests fail clearly.
- `telemetry`: Not needed for this MVP.
- `api-key-wizard`: Substituted for `prompt-secret` since we just needed a raw OAuth token.

## Friction Log

### Phase 0: Contract Origin
**Classification:** Discovered
**Reason:** The CLI wraps Google Classroom, a third-party API that we do not control.

### Phase 1: Target
**Distribution Target:** Node CLI (published to npm)
**Reason:** Easiest distribution via JS ecosystem using `googleapis`. `bun link` registers it quickly for agent iteration.

### Breakages & Learnings
- `@cligentic/argv` structure requires accessing arguments via `argv._` instead of positional spread.
- `cligentic/session` expects a direct directory for saving sessions (`sessionsDir`). This required adding the `xdg-paths` block to resolve OS-specific base directories instead of hardcoding `~/.classroom`.
- Default Agent TTY emulation suppresses colors and interactive prompts. The `detectMode()` function correctly fell back to `json` mode and prevented interactive secret prompts when run without `--token`.
