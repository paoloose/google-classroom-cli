---
name: classroom
description: "CLI for Google Classroom. Manage courses, coursework, grades, and submissions directly from the terminal."
---

# classroom

This CLI provides a wrapper around the Google Classroom API. It is agent-first, meaning it emits structured JSON automatically when run non-interactively or with the `--json` flag.

## Commands

### Core Auth
- `classroom auth login [--client-id=<id> --client-secret=<secret>]`
  - Authenticate the CLI using an OAuth 2.0 Desktop flow. Requests all available Google Classroom scopes. Users can deselect scopes they don't want in the Google OAuth web UI.
  - Automatically attempts to load credentials from `credentials.json` if placed in the standard configuration directory (e.g., `~/.config/classroom-cli/credentials.json` on macOS/Linux).
- `classroom auth logout`
  - Clear the stored credentials.
- `classroom schema`
  - Outputs the expected JSON shape of CLI responses.

### Courses & Rosters
- `classroom course list`
  - Lists all active courses.
- `classroom course get <id>`
  - Gets detailed information for a specific course ID.
- `classroom course create --name="<name>" [--section="<section>"]`
  - Creates a new Google Classroom course (requires teacher auth).
- `classroom course update <id> --status=<ACTIVE|ARCHIVED|DECLINED>`
  - Updates the status of a course.
- `classroom roster list <id> [--role=teacher]`
  - Lists students (or teachers) in a course.
- `classroom roster add <id> --email="<email>" [--role=teacher]`
  - Invites a user to the course.
- `classroom roster remove <id> --email="<email>"`
  - Removes a user from the course.

### Coursework & Content
- `classroom work list <course_id>`
  - List all coursework (assignments, quizzes, questions) in a course, including formatting of dates and time-left.
- `classroom work create <course_id> --title="<title>"`
  - Create a new assignment in a course.
- `classroom topic list <course_id>`
  - List all topics in a course.
- `classroom topic create <course_id> --name="<name>"`
  - Create a new topic for organizing coursework.
- `classroom material list <course_id>`
  - List all classwork materials.
- `classroom material create <course_id> --title="<title>" [--topic=<topic_id>] [--link="<url>"] [--file="<local_path>"]`
  - Create new material. Can specify multiple `--link` or `--file` flags. Local files are automatically uploaded to Google Drive.
- `classroom drive download <file_id> [--dest="<path>"]`
  - Download a Google Drive file attached to coursework to a local path.
- `classroom stream list <course_id>`
  - List all announcements on the course stream.
- `classroom stream post <course_id> --text="<content>"`
  - Post a new announcement to the course stream.

### Grading & Submissions (Teacher)
- `classroom submissions list <course_id> <work_id>`
  - List all student submissions for a specific coursework.
- `classroom submissions grade <course_id> <work_id> <student_id> --score=<number>`
  - Set the draft and assigned grade for a student's submission.
- `classroom submissions return <course_id> <work_id> <student_id>`
  - Return a graded submission to the student.

### Student Actions
- `classroom submit <course_id> <work_id> --link="<url>"`
  - Attach a URL to a pending assignment submission.
- `classroom turn-in <course_id> <work_id>`
  - Mark an assignment as turned in.
- `classroom unsubmit <course_id> <work_id>`
  - Unsubmit (reclaim) an assignment.
- `classroom tasks pending`
  - List pending (not turned in) assignments across all active courses.
- `classroom tasks due-soon`
  - List pending assignments due in the next 7 days across all active courses.

### Guardians
- `classroom guardian list <student_id>`
  - List guardians for a student.
- `classroom guardian invite <student_id> --email="<email>"`
  - Send a guardian invitation.

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
## API Limitations & Quirks
Agents should be aware of the following Google API restrictions when operating this CLI:

1. **Student Submit & Turn-In Restrictions (`@ProjectPermissionDenied`)**: Google Classroom blocks API clients from modifying submissions (turning in, attaching files) if the assignment was created manually by a teacher in the Web UI. The CLI can only submit/turn-in assignments that the CLI created. Agents should fallback to using the Web UI (or instruct the user) for manual assignment submissions.
2. **Google Drive Scopes**: The Classroom API relies on Google Drive for all file attachments. Agents attempting to use `--file` uploads or `drive download` will encounter 403 errors if the user has not enabled the "Google Drive API" in their Google Cloud Console.
3. **Course Creation (`@CourseStateDenied`)**: Courses created via the CLI may default to a `PROVISIONED` state based on domain policy. Agents cannot archive a `PROVISIONED` course via the API; it must be activated in the Web UI first.
## Global Flags

- `--json`: Force JSON output mode (implied when piped or not in TTY).
- `--dry-run`: Evaluate command without mutating state.
- `--no-input`: Never prompt, fail fast (useful for agents/CI).
- `-q, --quiet`: Suppress non-essential output (like notes on stderr).
- `-v, --verbose`: Show verbose logging on stderr.
