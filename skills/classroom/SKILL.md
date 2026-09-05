---
name: classroom
description: "CLI for Google Classroom. Manage courses, coursework, grades, submissions, announcements, materials, topics, guardians, and student tasks directly from the terminal. Agent-first with structured JSON output, global date filtering (--from/--last), verbosity tiers (--full/--detailed), and a sticky course-context resolver."
---

# classroom

This CLI is a wrapper around the Google Classroom API. It is **agent-first**: it auto-detects non-interactive stdout and emits NDJSON, and you can force it with `--json`. Every list-style command supports global date filtering (`--from`, `--last`), and most commands support `--full` for exhaustive metadata and `--related` to pull nested sub-resources.

## Commands

### Core Auth
- `classroom auth login [--client-id=<id> --client-secret=<secret>]`
  - OAuth 2.0 Desktop flow. Requests all Google Classroom scopes by default; users deselect unwanted scopes in the OAuth web UI.
  - Auto-loads `credentials.json` from the standard config dir (`~/.config/classroom-cli/credentials.json` on macOS/Linux, `%APPDATA%\classroom-cli\credentials.json` on Windows).
- `classroom auth logout`
  - Clear stored credentials.
- `classroom schema`
  - Print the expected JSON envelope shape.

### Courses & Rosters
- `classroom course list`
  - List active courses. Default view shows Status/Section/Subject/Room/Description; `--full` adds Owner ID, Created, Updated, Teacher/Course Email, Guardians, Calendar ID.
- `classroom course get [id]`
  - Get one course. With `--related`, also fetches teachers, topics, coursework, materials, and announcements.
- `classroom course select [id]`
  - Pin a course as the active context. With no id, opens an interactive TUI listing your courses.
- `classroom course deselect`
  - Clear the active course context.
- `classroom course current`
  - Print the currently selected course id and name.
- `classroom course create --name="<name>" [--section="<section>"]`
  - Create a course.
- `classroom course update [id] --status=<ACTIVE|ARCHIVED|DECLINED|PROVISIONED>`
  - Update a course's status.
- `classroom course enroll [id] <code>`
  - Join a course with an enrollment code or invite link.
- `classroom course unenroll [id]`
  - Leave a course (defaults to selected course).
- `classroom roster list [course_id] [--role=teacher]`
  - List students (or `--role=teacher` for teachers) in a course.
- `classroom roster add [course_id] --email="<email>" [--role=teacher]`
  - Invite a user. Defaults to student unless `--role=teacher` is passed.
- `classroom roster remove [course_id] --email="<email>"`
  - Remove a user from the course.

### Coursework & Content
- `classroom work list [course_id]`
  - List assignments in a course. Default view shows State + Due (with relative "3d4h" formatting). `--full` adds Description, Max Points, Link.
- `classroom work get [course_id] <work_id>`
  - Show assignment details. With `--related`, also fetch your submission.
- `classroom work create [course_id] --title="<title>"`
  - Create an assignment (defaults to 100 max points, PUBLISHED).
- `classroom topic list [course_id]`
  - List topics. Default view shows Update time; `--full` adds ID and creation/update timestamps.
- `classroom topic get [course_id] <topic_id>`
  - Show topic details. With `--related`, also list the materials and assignments under this topic.
- `classroom topic create [course_id] --name="<name>"`
  - Create a topic.
- `classroom material list [course_id]`
  - List materials. **Default view shows State, Created, Updated, Link, and a one-line Description preview.** `--full` adds Course ID, Topic ID, Creator ID, and Scheduled time. `--detailed` adds a per-attachment type tally ("2 files / 1 link / 1 video") and Share Mode info. Combine `--full --detailed` to get every field.
- `classroom material get [course_id] <material_id>`
  - Show full material details with attachments.
- `classroom material create [course_id] --title="<title>" [--topic=<topic_id>] [--link="<url>"...] [--file="<local_path>"...]`
  - Create material. Multiple `--link` and `--file` flags are allowed; local files are uploaded to Google Drive.
- `classroom drive download <file_id> [dest_path]`
  - Download a Google Drive attachment. `dest_path` is optional; if omitted, the file's original title is used.
- `classroom stream list [course_id]`
  - List announcements. Default view shows Posted time and Link.
- `classroom stream get [course_id] <announcement_id>`
  - Show one announcement.
- `classroom stream post [course_id] --text="<content>"`
  - Post a new announcement.

### Grading & Submissions (Teacher)
- `classroom submissions list <work_id>`
  - List all student submissions for an assignment. If only one positional arg is given, the active course context is used.
- `classroom submissions grade [course_id] <work_id> <student_id> --score=<number>`
  - Set both draft and assigned grade on a submission.
- `classroom submissions return [course_id] <work_id> <student_id>`
  - Return a graded submission to the student.

### Student Actions
- `classroom submit [course_id] [work_id] [--link="<url>"...] [--file="<local_path>"...] [--turn-in]`
  - Attach a link or uploaded file to your pending submission. If `work_id` is omitted, opens an interactive TUI to select the assignment. Pass `--turn-in` to submit and turn in simultaneously.
- `classroom turn-in [course_id] [work_id]`
  - Hand in your submission (interactive TUI if `work_id` is omitted).
- `classroom unsubmit [course_id] [work_id]`
  - Reclaim (unsubmit) your submission (interactive TUI if `work_id` is omitted).
- `classroom comment list [course_id] [work_id]`
  - List private comments on an assignment via Web Engine (interactive TUI if `work_id` is omitted).
- `classroom comment post [course_id] [work_id] --text="<content>"`
  - Post a private comment to the teacher on an assignment via Web Engine (interactive TUI if `work_id` or `--text` is omitted).
- `classroom tasks pending`
  - Aggregator: every pending submission across all active courses. Default view shows Course + Due state.
- `classroom tasks due-soon`
  - Aggregator: pending submissions due in the next 7 days by default. Override the window with `--from <date>` or `--last <duration>`.

### Guardians
- `classroom guardian list <student_id>`
  - List guardians for a student.
- `classroom guardian invite <student_id> --email="<email>"`
  - Send a guardian invitation.

## Course Context & URL / Base64 Reference Resolution

- **Active Course Context:** Most course-scoped commands accept the course id positionally, but if you omit it (or pass only the trailing resource id for `* get` / `submissions list` / `submit` / `turn-in` / `unsubmit` / `comment *`), the CLI falls back to the **active course context**. Pin one with `course select <id>` (or interactively with `course select`), clear with `course deselect`, and inspect with `course current`.
- **Direct Link / Base64 ID References:** Any command accepting a course ID or resource ID can also accept a full Google Classroom URL (e.g. `https://classroom.google.com/c/ODc2NDQxOTM5MDY2` or `https://classroom.google.com/c/ODc2NDQxOTM5MDY2/a/ODc2NDQwMzA3NTk2/details`) or raw **Base64-encoded IDs** (e.g. `ODc2NDQxOTM5MDY2`). The CLI automatically decodes base64 identifiers and extracts both `courseId` and the specific `workId`/`materialId`/`announcementId`/`topicId`.

## Global Filtering Flags

Every list-style command and aggregator — `course list`, `course get` (related sub-blocks), `work list`, `work get` (related), `material list`, `material get`, `topic list`, `topic get` (related), `stream list`, `stream get`, `submissions list`, `tasks pending`, `tasks due-soon` — accepts two optional date filters:

### `--from <date>`

Include only items dated on or after `<date>`. ISO 8601 is preferred and tried first; any date-fns-parseable format also works.

- Full: `--from 2025-01-31`, `--from 2025-01-31T08:00:00Z`
- Slash/dotted: `--from 2025/01/31`, `--from 2025.01.31`
- Human: `--from "Jan 31, 2025"`
- Bare day: `--from 15` → day-15 of the current month and year
- Missing year → filled with the current year. **Missing day is an error** — the date must always be unambiguous.

Also honored via the env var `CLI_FROM`.

### `--last <duration>`

Include only items dated within the last `<duration>` from now (shortcut for `--from "<now - duration>"`).

Format: `<n>y<n>w<n>m<n>d<n>h<n>m<n>s`

| Indicator | Meaning     |
|-----------|-------------|
| `y`       | years (365d)|
| `w`       | weeks (7d)  |
| `m` (first after y/w) | months (30d) |
| `d`       | days        |
| `h`       | hours       |
| `m` (after h) | minutes |
| `s`       | seconds     |

- At least one indicator is required.
- Each indicator may appear **at most once** (so `--last 1y2y` and `--last 1h30m15m` are rejected).
- Examples: `--last 7d`, `--last 24h`, `--last 1w`, `--last 2w3d`, `--last 1y2m3d`, `--last 30m`.

Also honored via the env var `CLI_LAST`.

### Combining

- `--from` and `--last` are **mutually exclusive** — passing both is an error.
- Without either flag, every list command behaves exactly as before.
- Filtering happens before JSON emission, so `--json` mode honors the filter too.

### Per-command date field

| Command                          | Primary date field  | Fallback         |
|----------------------------------|---------------------|------------------|
| `course list` / `course get`     | `updateTime`        | `creationTime`   |
| `work list` / `work get`         | `dueDate`           | `updateTime`     |
| `material list` / `material get` | `updateTime`        | —                |
| `topic list` / `topic get`       | `updateTime`        | —                |
| `stream list` / `stream get`     | `updateTime`        | —                |
| `submissions list`               | `updateTime`        | `creationTime`   |
| `tasks pending`                  | `dueDate`           | —                |
| `tasks due-soon`                 | `dueDate`           | —                |

The same filter is applied to the related sub-blocks (`topics`, `coursework`, `materials`, `stream`) inside `course get` and `topic get`.

### Examples

```bash
classroom work list                          --last 7d
classroom course list                        --from 2025-08-01
classroom stream list                        --from 15
classroom stream list --json                 --last 24h
classroom tasks due-soon                     --last 30d
classroom course get <id> --related --full   --from 2025-01-01
```

## Verbosity Flags

Most commands accept up to three verbosity tiers:

| Tier       | Flag          | Adds                                                         |
|------------|---------------|--------------------------------------------------------------|
| Default    | _(none)_      | State, Created, Updated, Link, Description (when present)    |
| Exhaustive | `--full`      | + Course ID, Topic ID, Creator ID, Scheduled time            |
| Detailed   | `--detailed`  | + per-attachment type tally (files / links / videos / forms) and Share Mode info |

`--full` and `--detailed` can be combined. `material list` is the only command that distinguishes all three tiers today; other commands fall back to a binary default-vs-`--full` model.

## Other Common Flags

- `--json`: Force JSON output mode (auto-enabled when stdout is piped).
- `--related`: Fetch related sub-resources (teachers, topics, coursework, materials, announcements, submission). Auto-on under `--json`.
- `--quiet` / `-q`: Suppress non-essential stderr notes.
- `--verbose` / `-v`: Verbose stderr logging.
- `--dry-run`: Evaluate without mutating upstream state.
- `--no-input`: Never prompt; fail fast. Useful for agents and CI.
- `--profile <name>`: Use a named config profile.

## JSON Envelope

NDJSON (one object per line) for arrays, single object otherwise. Errors:

```json
{
  "ok": false,
  "error": "Error message",
  "name": "ErrorName",
  "hint": "Optional hint on how to fix"
}
```

## API Limitations & Quirks

1. **Student Submit & Turn-In Restrictions (`@ProjectPermissionDenied`)** — Google Classroom blocks API clients from modifying submissions (attaching files, turning in) when the assignment was created manually by a teacher in the Web UI or by a different Google Cloud project. The CLI can only submit/turn-in assignments that the CLI itself created. Agents should fall back to the Web UI (or instruct the user) for manual assignment submissions.
2. **Google Drive API Requirement** — All file attachments live in Google Drive. `--file` uploads and `drive download` need the "Google Drive API" enabled in the user's Google Cloud project, otherwise they 403.
3. **Course Creation States (`@CourseStateDenied`)** — Courses created via the CLI may default to `PROVISIONED` depending on Workspace domain policy. The API rejects direct `PROVISIONED → ARCHIVED` transitions; the course must be activated in the Web UI first.
4. **Course Enrollment Requires Course ID (`enroll [id] <code>`)** — In the Classroom Web UI, students join classes by typing only a 7-character code because Google performs a global lookup. In the REST API, the endpoint is course-scoped (`courses.students.create`) and requires both `courseId` and `enrollmentCode`. Pass the full invite link (`https://classroom.google.com/c/...`) to let the CLI extract both automatically, or join via the Web UI if only given the 7-character code.
5. **Schedule time on stream** — `stream post` accepts an optional `--scheduled` parameter; the value is passed through unchanged, so format it per the Google Classroom API expectation.