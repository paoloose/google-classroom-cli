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
