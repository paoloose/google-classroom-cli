# Google Classroom CLI

A powerful, agent-first CLI for interacting with Google Classroom from your terminal. Built with Node.js and TypeScript.

## Installation

### One-line installer

A bash installer ships with every release. By default it pulls the latest stable version for your OS/arch, drops the code under `$CLASSROOM_CLI_HOME/repo/`, and exposes a `classroom` symlink in `$CLASSROOM_CLI_HOME/bin/`.

macOS / Linux / WSL / Git Bash:

```bash
curl -fsSL https://raw.githubusercontent.com/paoloose/google-classroom-cli/main/scripts/install.sh | bash
```

Windows (PowerShell 7+):

```powershell
iwr -useb https://raw.githubusercontent.com/paoloose/google-classroom-cli/main/scripts/install.ps1 | iex
```

By default the CLI lives under `~/.config/classroom-cli/` (XDG on Unix, `%LOCALAPPDATA%\classroom-cli` on Windows) so credentials and state survive every upgrade. Override with `--install-dir <path>` or `CLASSROOM_CLI_HOME`.

Useful flags (same on both platforms):

| Flag / option                                 | Effect                                                   |
| --------------------------------------------- | -------------------------------------------------------- |
| `--version vX.Y.Z` / `-Version vX.Y.Z`        | Pin to a specific tag instead of "latest"                |
| `--prerelease` / `-Prerelease`                | Include `-beta` / `-rc` releases when resolving "latest" |
| `--channel beta` / `-Channel beta`            | Same as `--prerelease` but friendlier                    |
| `--force` / `-Force`                          | Re-download even if the installed version is the same    |
| `--install-dir <path>` / `-InstallDir <path>` | Override the install root                                |
| `--dry-run` / `-DryRun`                       | Print what would happen, don't touch disk                |

Examples:

```bash
# Pin a specific version
curl -fsSL .../install.sh | bash -s -- --version v0.0.1

# Install a pre-release build
curl -fsSL .../install.sh | bash -s -- --prerelease

# Install into a custom directory
curl -fsSL .../install.sh | bash -s -- --install-dir /opt/classroom-cli
```

### Update an existing install

The installer detects your currently installed version (via `$CLASSROOM_CLI_HOME/repo/.classroom-cli-version`) and only fetches a new tarball when the resolved one is newer. So re-running the same one-liner acts as an update:

```bash
curl -fsSL https://raw.githubusercontent.com/paoloose/google-classroom-cli/main/scripts/install.sh | bash
```

Add `--force` to reinstall the same version, or `--version v0.0.1` to roll back. The `sessions/` directory is preserved across every install, so `classroom auth login` only has to run once.

### From a local clone (development)

If you have the repository cloned, link it globally with bun:

```bash
bun link
```

The link approach runs directly from your working tree: no version pinning, no install dir.

## Agent Skills

The repository ships a `classroom` skill under `skills/classroom/` that any compatible agent can install via the [open agent skills CLI](https://github.com/vercel-labs/skills) (`npx skills`). The skill teaches your agent the full feature surface: every command, every verb, the `--from`/`--last` filtering grammar, the `--full`/`--detailed` verbosity tiers, and the active-course-context resolver.

### Install skills from GitHub (no clone required)

```bash
# Install the latest from the public repo
npx skills add paoloose/google-classroom-cli --skill classroom
```

### Install from a local clone

If you've already cloned the repo:

```bash
# Install into whichever agents are detected
npx skills add ./skills
```

> **Note:** The skill teaches your agent how to drive the CLI, but it doesn't ship the CLI itself. You'll still need the `classroom` binary on your `PATH` for the commands to actually run.

## Setup & Authentication

Because this CLI interacts with Google Classroom, you need to provide your own Google Cloud OAuth credentials. **This is completely free and requires no credit card.**

### How to get your Client ID and Client Secret (Updated 2026)

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

### Can I use an Google API key for authentication?

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
- `classroom course enroll [id] <code> [--code-only]` - Join a course (use `--code-only` if you only have a 7-character code)
- `classroom course unenroll [id]` - Leave a course (defaults to selected course)
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

- `classroom submit [course_id] [work_id] [--file="<path>"] [--link="<url>"]` - Upload to Google Drive and attach files/links (interactive TUI if task omitted, pass `--turn-in` to submit and turn in at once)
- `classroom turn-in [course_id] [work_id]` - Hand in your submission (interactive TUI if task omitted)
- `classroom unsubmit [course_id] [work_id]` - Retract your submission (interactive TUI if task omitted)
- `classroom comment list [course_id] [work_id] [--class]` - List private comments on an assignment (or class comments with `--class`) via Web Engine
- `classroom comment post [course_id] [work_id] --text="<content>" [--class]` - Post a private comment to the teacher (or class comment with `--class`) on an assignment via Web Engine
- `classroom pending` - Global aggregator: get all your missing/active work across all active courses
- `classroom due-soon` - View all assignments due in the next 7 days

This CLI is designed to be easily consumed by AI agents. It detects when it is running in a non-interactive environment (like CI or an agent subprocess) and will automatically emit structured NDJSON instead of human-readable text. You can also force this mode by passing the `--json` flag.

## 🔗 Direct Link & Base64 URL Reference Support

You can pass full Google Classroom URLs or **Base64-encoded IDs** directly to any command instead of looking up numeric IDs. The CLI automatically extracts and base64-decodes both the **Course ID** and the **Resource ID** (assignment, material, announcement, topic):

```bash
# Pass Base64 IDs directly:
classroom course get ODc2NDQxOTM5MDY2
classroom work get ODc2NDQxOTM5MDY2 ODc2NDQwMzA3NTk2

# Get or select a course directly by URL:
classroom course get https://classroom.google.com/c/ODc2NDQxOTM5MDY2
classroom course select https://classroom.google.com/c/ODc2NDQxOTM5MDY2

# List assignments or stream for a course:
classroom work list https://classroom.google.com/c/ODc2NDQxOTM5MDY2

# Get assignment details using its full URL (extracts both courseId and workId):
classroom work get https://classroom.google.com/c/ODc2NDQxOTM5MDY2/a/ODc2NDQwMzA3NTk2/details

# Submit work, turn in, or comment using the assignment URL:
classroom submit https://classroom.google.com/c/ODc2NDQxOTM5MDY2/a/ODc2NDQwMzA3NTk2/details --file="informe.pdf" --turn-in
classroom comment post https://classroom.google.com/c/ODc2NDQxOTM5MDY2/a/ODc2NDQwMzA3NTk2/details --text="Listo profesor"
classroom comment list https://classroom.google.com/c/ODc2NDQxOTM5MDY2/a/ODc2NDQwMzA3NTk2/details
```

## Verbosity Flags

Most commands accept up to three verbosity tiers:

| Tier       | Flag         | Adds                                                                             |
| ---------- | ------------ | -------------------------------------------------------------------------------- |
| Default    | *(none)*     | State, Created, Updated, Link, Description (when present)                        |
| Exhaustive | `--full`     | + Course ID, Topic ID, Creator ID, Scheduled time                                |
| Detailed   | `--detailed` | + per-attachment type tally (files / links / videos / forms) and Share Mode info |
|            |              |                                                                                  |

`--full` and `--detailed` can be combined to get every field at once. Tier differences are most visible in `material list` / `course get`; other commands fall back to a binary default-vs-`--full` model.

## Global Filtering Flags

Every list-style command (`course list`, `work list`, `stream list`, `material list`, `topic list`, `submissions list`, `pending`, `due-soon`, plus the related sub-blocks of `get` commands) accepts two optional flags that filter the returned items by date.

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

| Indicator | Meaning                                              |
| --------- | ---------------------------------------------------- |
| `y`       | years (365d)                                         |
| `w`       | weeks (7d)                                           |
| `m`       | months (30d) — first `m` after a year/week is months |
| `d`       | days                                                 |
| `h`       | hours                                                |
| `m`       | minutes — second `m` after hours is minutes          |
| `s`       | seconds                                              |

- At least **one** indicator is required.
- Each indicator may appear **at most once**.
- Examples: `--last 7d`, `--last 24h`, `--last 1y2m3d`, `--last 30m`, `--last 1w2d`, `--last 1h30m` (invalid — minute indicator repeated).

You may also use the environment variable `CLI_LAST`.

### Combining flags

- `--from` and `--last` are **mutually exclusive** — passing both is an error.
- Without either flag, every list command behaves exactly as before.

### Which date is used per command

| Command                          | Primary date field | Fallback       |
| -------------------------------- | ------------------ | -------------- |
| `course list` / `course get`     | `updateTime`       | `creationTime` |
| `work list` / `work get`         | `dueDate`          | `updateTime`   |
| `material list` / `material get` | `updateTime`       | —              |
| `topic list` / `topic get`       | `updateTime`       | —              |
| `stream list` / `stream get`     | `updateTime`       | —              |
| `submissions list`               | `updateTime`       | `creationTime` |
| `pending`                        | `dueDate`          | —              |
| `due-soon`                       | `dueDate`          | —              |

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

## Web Engine Architecture & `@ProjectPermissionDenied` Bypasses

During the development of this CLI, we uncovered a severe restriction in the Google Classroom API:

**The `@ProjectPermissionDenied` Problem:** Google Classroom enforces a strict, isolated permission model where resources (like coursework and grades) are permanently locked to the specific Developer Console project that created them. If a teacher creates an assignment manually via the Google Classroom Web UI, the API treats the Web UI as the "owning project." Consequently, any third-party API integration (even one authorized by the exact same teacher or student) is strictly forbidden from mutating grades, modifying attachments, or turning in submissions. Attempting to do so results in a fatal `403 PERMISSION_DENIED: @ProjectPermissionDenied` error.

To bypass this limitation seamlessly, the CLI implements a **Smart Routing** layer and a **Web Engine Fallback**.

### Smart Routing

When a user executes a student action (`submit`, `turn-in`, `unsubmit`), the CLI first queries the Classroom API to inspect the assignment.

- If `associatedWithDeveloper` is `true`, the CLI executes the action instantly via the high-speed REST API.
- If `associatedWithDeveloper` is `false`, the CLI intercepts the command, dynamically imports `puppeteer`, and falls back to headless browser automation to simulate a human clicking the Web UI.

### Anti-Bot Bypassing

Google employs aggressive anti-bot detection during authentication. To survive this, the CLI uses several strategic bypasses:

- **Native Chrome Spawning:** Injecting cookies into a fresh Puppeteer session triggers device mismatch blocks. Instead, `auth web-login` uses Node's native `spawn` to launch the host OS's actual Google Chrome pointed at the CLI's local `userDataDir`. The user authenticates naturally, and Google mints highly trusted cookies.
- **Keychain Flag Sabotage:** macOS Chrome encrypts cookies using the OS Keychain. By default, Puppeteer injects `--use-mock-keychain` and `--password-store=basic`, causing it to wipe the trusted session. The CLI strips these default arguments out.
- **The `?hl=en` Hack:** Google Classroom supports dozens of languages, making regex matching of UI buttons brittle. The Web Engine appends `?hl=en` to all Classroom URLs, forcing the UI to render in English regardless of the user's localized account settings, guaranteeing deterministic element selection.

### Hybrid File Uploads (`classroom submit --file`)

Automating the complex, cross-origin Google Drive `<iframe>` File Picker in Puppeteer is highly error-prone. The CLI uses a hybrid approach:

1. It automatically queries the Drive API to find the student's specific `Course Name Section` Classroom folder and silently uploads the local file there via the REST API.
2. It extracts the Drive file's sharing URL.
3. The Web Engine navigates to the assignment, clicks **Add or create**, selects the **Link** option, and simply pastes the Drive URL into the input field. Google Classroom automatically detects it as a Drive file and renders the native attachment card!

### Private Comments Automation (`classroom comment`)

The official Google Classroom REST API does not provide any public endpoint for reading or posting private comments between students and teachers on assignments. The CLI's Web Engine automates opening the assignment view, expanding the private comments drawer, typing the message with native event bindings, and posting the comment seamlessly.

## 🚧 Roadmap & Work in Progress

While the student workflow is 100% complete and fully resilient against the `@ProjectPermissionDenied` sandbox via the Web Engine, there are a few teacher-oriented features still under development:

1. **Web Engine: `submissions grade`**
   - Teachers suffer from the exact same API sandbox restrictions as students when trying to assign grades to assignments they created in the Web UI.
   - *Status:* WIP. Implementing this fallback requires capturing a DOM snapshot of the specialized React "Grading Tool" iframe to construct reliable Puppeteer selectors.
2. **Web Engine: `submissions return`**
   - Similarly, returning an assignment created in the Web UI via the API fails.
   - *Status:* WIP. Blocked by the same "Grading Tool" iframe UI complexity as grading.

## ⚠️ Known API Limitations & Quirks

1. **Google Drive API Requirement:**
   While the Classroom API handles metadata, all physical file attachments live in Google Drive. To use `--file` uploads in materials/submissions or the `classroom drive download` command, you **must** manually enable the "Google Drive API" in your Google Cloud Console project.
2. **Course Creation States (`@CourseStateDenied`):**
   Depending on your Google Workspace domain policy (or if you are a standard `@gmail.com` user), creating a new course via the CLI may force the course into a `PROVISIONED` state. The API will reject attempts to transition a `PROVISIONED` course directly to `ARCHIVED`. You must accept/activate the course in the Classroom Web UI first.
3. **Course Enrollment Requires Course ID (`enroll [id] <code>`):**
   In the Google Classroom Web UI, students can join a class simply by entering a 7-character class code because Google runs an internal global lookup service across all active courses. However, the public Google Classroom REST API (`courses.students.create`) does not offer a global code search endpoint for privacy and security reasons.

   Instead, the API endpoint is strictly course-scoped (`POST /v1/courses/{courseId}/students`) and requires **both** the numeric `courseId` (to route to the course) and the `enrollmentCode` (as authorization).

   To simplify this in the CLI:
   - **Full Invite Link (Recommended):** If you pass the full invite link (e.g. `classroom enroll "https://classroom.google.com/c/ODc2NDQxOTM5MDY2?cjc=abc123x"`), the CLI automatically parses and base64-decodes both the Course ID and the join code.
   - **Active Context:** If you already selected a course (`classroom course select <id>`), you only need to provide the code: `classroom enroll <code>`.
   - **Raw Code Only:** If you only have the 7-character code and do not know the numeric Course ID, you should join the class once via the [Classroom Web UI](https://classroom.google.com).
