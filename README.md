# Google Classroom CLI

A powerful, agent-first CLI for interacting with Google Classroom from your terminal. Built with Node.js and TypeScript.

## Installation

If you have the repository cloned, you can link it globally using `bun`:

```bash
bun link
```

## Setup & Authentication

Because this CLI interacts with Google Classroom, you need to provide your own Google Cloud OAuth credentials. **This is completely free and requires no credit card.**

### How to get your Client ID and Client Secret (Updated 2026 UI)

1. **Create a Project:**
   Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project.

2. **Enable the API:**
   In the search bar at the top, search for **"Google Classroom API"** and click **Enable**.

3. **Navigate to the OAuth Consent Screen:**
   In the left navigation menu, go to **APIs & Services > OAuth Consent Screen**. (Google recently redesigned this from the old "OAuth consent screen" menus).

4. **Configure Branding:**
   - Click **Branding** in the left sidebar.
   - Fill in the required fields (App name, User support email, Developer contact email) and save.

5. **Configure Audience (Test Users):**
   - Click **Audience** in the left sidebar.
   - Choose your User Type (External or Internal).
   - *Important:* If you selected "External", make sure to add your own Google email address under **Test users**, otherwise Google will block you from logging in!

6. **Create the Client Credentials:**
   - Click **Clients** in the left sidebar.
   - Click **Create Client**.
   - For **Application type**, select **Desktop app**.
   - Give it a name (e.g., "Classroom CLI") and click **Create**.

7. **Log In:**
   Run the login command:
   ```bash
   classroom auth login
   ```
   If you have downloaded the OAuth credentials JSON file from Google Cloud (usually named `client_secret_....json`), you can rename it to `credentials.json` and place it in the app's standard configuration directory. The CLI will automatically detect it!

   - **macOS / Linux:** `~/.config/classroom-cli/credentials.json`
   - **Windows:** `%APPDATA%\classroom-cli\credentials.json`
   
   *(Note: You can also just paste the Client ID and Secret when prompted interactively, pass them via `--client-id` and `--client-secret` flags, or set the `CLASSROOM_CLIENT_ID` and `CLASSROOM_CLIENT_SECRET` environment variables).*

### Can I use an API key for authentication?

**No.** Although you might see the Google Classroom API listed in the API Key restrictions menu in Google Cloud, API Keys are only designed for accessing public, anonymous data (like embedding a Google Map). 

Because Google Classroom deals with highly sensitive, private user data, the API requires credentials that "assert a principal" (i.e., it needs to know *who* the human user is). If you attempt to use an API Key, Google will reject the request with the following error:

> `API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal.`

You must use an **OAuth 2.0 Client ID and Secret** so that Google can ask the user to explicitly consent to sharing their Classroom data.

## Commands

### Core Auth
- `classroom auth login` - Authenticate (requests all scopes by default)
- `classroom auth logout` - Clear credentials

### Courses & Rosters
- `classroom course list` - List active courses
- `classroom course get <id>` - Get details of a course
- `classroom course create --name="<name>"` - Create a new course
- `classroom course update <id> --status=<STATUS>` - Update course status (ACTIVE, ARCHIVED)
- `classroom roster list <id>` - List students in a course
- `classroom roster add <id> --email="<email>"` - Add a student or teacher
- `classroom roster remove <id> --email="<email>"` - Remove a student

### Coursework & Content
- `classroom stream list <id>` - Get announcements
- `classroom stream post <id> --text="<text>"` - Post an announcement
- `classroom work list <id>` - Get assignments for a course
- `classroom work create <id> --title="<title>"` - Create an assignment
- `classroom topic list <id>` - List topics
- `classroom topic create <id> --name="<name>"` - Create a new topic
- `classroom material list <id>` - List classwork materials
- `classroom material create <id> --title="<title>" [--file="<path>"] [--link="<url>"]` - Create material (supports multiple --file and --link)
- `classroom drive download <file_id> [--dest="<path>"]` - Download an attached Google Drive file

### Grading & Submissions (Teachers)
- `classroom submissions list <course_id> <work_id>` - View all student submissions
- `classroom submissions grade <course_id> <work_id> <student_id> --score=<num>` - Grade an assignment
- `classroom submissions return <course_id> <work_id> <student_id>` - Return grades to student

### Student Actions
- `classroom submit <course_id> <work_id> [--file="<path>"] [--link="<url>"]` - Upload to Google Drive and attach files/links to your submission
- `classroom turn-in <course_id> <work_id>` - Hand in your submission
- `classroom unsubmit <course_id> <work_id>` - Retract your submission
- `classroom tasks pending` - Global aggregator: get all your missing/active work across all active courses
- `classroom tasks due-soon` - View all assignments due in the next 7 days

This CLI is designed to be easily consumed by AI agents. It detects when it is running in a non-interactive environment (like CI or an agent subprocess) and will automatically emit structured NDJSON instead of human-readable text. You can also force this mode by passing the `--json` flag.

## Verbosity Flags

Most commands accept up to three verbosity tiers:

| Tier       | Flag          | Adds                                                         |
|------------|---------------|--------------------------------------------------------------|
| Default    | _(none)_      | State, Created, Updated, Link, Description (when present)    |
| Exhaustive | `--full`      | + Course ID, Topic ID, Creator ID, Scheduled time            |
| Detailed   | `--detailed`  | + per-attachment type tally (files / links / videos / forms) and Share Mode info |

`--full` and `--detailed` can be combined to get every field at once. Tier differences are most visible in `material list` / `course get`; other commands fall back to a binary default-vs-`--full` model.

## Global Filtering Flags

Every list-style command (`course list`, `work list`, `stream list`, `material list`, `topic list`, `submissions list`, `tasks pending`, `tasks due-soon`, plus the related sub-blocks of `get` commands) accepts two optional flags that filter the returned items by date.

### `--from <date>`

Include only items dated on or after `<date>`. ISO 8601 is preferred and tried first; any [date-fns-parseable](https://date-fns.org/v4.4.0/docs/parse) format is also accepted.

- **Full date / timestamp:** `--from 2025-01-31`, `--from 2025-01-31T08:00:00Z`
- **Slash / dotted variants:** `--from 2025/01/31`, `--from 2025.01.31`
- **Human formats:** `--from "Jan 31, 2025"`
- **Year omitted:** missing year is filled with the current one.
- **Year + month only:** missing day is **not** auto-filled — the day is required so the date is unambiguous.

You can also pass a bare day number, which resolves to day-N of the current month and year:

- `--from 15` → the 15th of the current month of the current year

You may also use the environment variable `CLI_FROM`.

### `--last <duration>`

Include only items dated within the last `<duration>` from now. This is a shortcut for `--from "<now - duration>"`.

Format: `<n>y<n>w<n>m<n>d<n>h<n>m<n>s`

| Indicator | Meaning     |
|-----------|-------------|
| `y`       | years (365d)|
| `w`       | weeks (7d)  |
| `m`       | months (30d) — first `m` after a year/week is months|
| `d`       | days        |
| `h`       | hours       |
| `m`       | minutes — second `m` after hours is minutes|
| `s`       | seconds     |

- At least **one** indicator is required.
- Each indicator may appear **at most once**.
- Examples: `--last 7d`, `--last 24h`, `--last 1y2m3d`, `--last 30m`, `--last 1w2d`, `--last 1h30m` (invalid — minute indicator repeated).

You may also use the environment variable `CLI_LAST`.

### Combining flags

- `--from` and `--last` are **mutually exclusive** — passing both is an error.
- Without either flag, every list command behaves exactly as before.

### Which date is used per command

| Command                                | Primary date field                | Fallback     |
|----------------------------------------|-----------------------------------|--------------|
| `course list` / `course get`           | `updateTime`                      | `creationTime` |
| `work list` / `work get`               | `dueDate`                         | `updateTime` |
| `material list` / `material get`       | `updateTime`                      | —            |
| `topic list` / `topic get`             | `updateTime`                      | —            |
| `stream list` / `stream get`           | `updateTime`                      | —            |
| `submissions list`                     | `updateTime`                      | `creationTime` |
| `tasks pending`                        | `dueDate`                         | —            |
| `tasks due-soon`                       | `dueDate`                         | —            |

The same filter is also applied to the related sub-blocks (`topics`, `coursework`, `materials`, `stream`) inside `course get` and `topic get`.

### Examples

```bash
# Assignments due this week
classroom work list <course_id> --last 7d

# All coursework created since the start of the school year
classroom course list --from 2025-08-01

# Bare day → 15th of this month
classroom stream list <course_id> --from 15

# Announcements in the last 24 hours, in JSON for an agent
classroom stream list <course_id> --last 24h --json

# Tasks due over the next 30 days instead of the default 7
classroom tasks due-soon --last 30d

# Combine with --related; related items are also filtered
classroom course get <course_id> --related --from 2025-01-01
```

## ⚠️ Known API Limitations & Quirks
During the development and dogfooding of this CLI, we uncovered several strict security boundaries enforced by the Google Classroom API:

1. **Student Submit & Turn-In Restrictions (`@ProjectPermissionDenied`):**
   Google Classroom strictly prohibits third-party apps from modifying student submissions (attaching files, turning in, or unsubmitting) if the original assignment (`courseWork`) was created manually by a teacher in the Google Classroom Web UI, or by a different Google Cloud project. Attempting to do so will result in a `@ProjectPermissionDenied` error. Student write-actions via this CLI only work on assignments that were originally created via the CLI.
2. **Google Drive API Requirement:**
   While the Classroom API handles metadata, all physical file attachments live in Google Drive. To use `--file` uploads in materials/submissions or the `classroom drive download` command, you **must** manually enable the "Google Drive API" in your Google Cloud Console project.
3. **Course Creation States (`@CourseStateDenied`):**
   Depending on your Google Workspace domain policy (or if you are a standard `@gmail.com` user), creating a new course via the CLI may force the course into a `PROVISIONED` state. The API will reject attempts to transition a `PROVISIONED` course directly to `ARCHIVED`. You must accept/activate the course in the Classroom Web UI first.
