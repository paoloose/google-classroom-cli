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
   Run the login command and paste the Client ID and Secret when prompted:
   ```bash
   classroom auth login
   ```
   *(Note: You can also pass these via `--client-id` and `--client-secret` flags, or set the `CLASSROOM_CLIENT_ID` and `CLASSROOM_CLIENT_SECRET` environment variables).*

### Can I use an API key for authentication?

**No.** Although you might see the Google Classroom API listed in the API Key restrictions menu in Google Cloud, API Keys are only designed for accessing public, anonymous data (like embedding a Google Map). 

Because Google Classroom deals with highly sensitive, private user data, the API requires credentials that "assert a principal" (i.e., it needs to know *who* the human user is). If you attempt to use an API Key, Google will reject the request with the following error:

> `API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal.`

You must use an **OAuth 2.0 Client ID and Secret** so that Google can ask the user to explicitly consent to sharing their Classroom data.

## Commands

- `classroom auth login` - Authenticate with Google
- `classroom auth logout` - Clear credentials
- `classroom course list` - List Google Classroom courses
- `classroom course get <id>` - Get detailed information for a specific course by ID
- `classroom schema` - Show output JSON schema for agent tooling

## Agent-First Design

This CLI is designed to be easily consumed by AI agents. It detects when it is running in a non-interactive environment (like CI or an agent subprocess) and will automatically emit structured NDJSON instead of human-readable text. You can also force this mode by passing the `--json` flag.
