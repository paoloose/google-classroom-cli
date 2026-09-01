import { google } from 'googleapis';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { saveSession, clearSession } from '../../cli/foundation/session.js';
import { promptSecret } from '../../cli/agent/prompt-secret.js';
import { detectMode } from '../../cli/platform/detect.js';
import { getAppPaths, ensureHome } from '../../cli/foundation/xdg-paths.js';

const paths = getAppPaths('classroom-cli');

const ALL_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
  'https://www.googleapis.com/auth/classroom.guardianlinks.me.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.profile.photos',
  'https://www.googleapis.com/auth/classroom.courses',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials',
  'https://www.googleapis.com/auth/classroom.announcements',
  'https://www.googleapis.com/auth/classroom.rosters',
  'https://www.googleapis.com/auth/classroom.topics',
  'https://www.googleapis.com/auth/classroom.guardianlinks.students',
  'https://www.googleapis.com/auth/classroom.push-notifications',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly'
];

function openUrl(url: string) {
  const platform = process.platform;
  if (platform === 'darwin') exec(`open "${url}"`);
  else if (platform === 'win32') exec(`start "" "${url}"`);
  else exec(`xdg-open "${url}"`);
}

async function runLocalOAuthFlow(clientId: string, clientSecret: string, globals: GlobalFlags): Promise<{ access_token: string, refresh_token?: string }> {
  return new Promise((resolve, reject) => {
    const port = 3000;
    const redirectUri = `http://localhost:${port}/oauth2callback`;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: Array.from(new Set(ALL_SCOPES)),
      prompt: 'consent'
    });

    const server = createServer(async (req, res) => {
      try {
        if (!req.url) return;
        const url = new URL(req.url, `http://localhost:${port}`);
        if (url.pathname === '/oauth2callback') {
          const code = url.searchParams.get('code');
          if (code) {
            res.end('Authentication successful! You can close this tab.');
            server.close();
            
            note('Exchanging authorization code for tokens...', globals);
            const { tokens } = await oauth2Client.getToken(code);
            
            if (tokens.access_token) {
              const resObj: { access_token: string, refresh_token?: string } = {
                access_token: tokens.access_token
              };
              if (tokens.refresh_token) resObj.refresh_token = tokens.refresh_token;
              resolve(resObj);
            } else {
              reject(new Error('No access token received.'));
            }
          } else {
            res.end('Authentication failed! No code provided.');
            server.close();
            reject(new Error('No authorization code provided in callback.'));
          }
        }
      } catch (err) {
        server.close();
        reject(err);
      }
    });

    server.listen(port, () => {
      note(`Listening on http://localhost:${port} for Google Auth callback.`, globals);
      if (detectMode(globals) === 'human' && !globals.noInput) {
        note(`Opening browser to: ${authUrl}`, globals);
        openUrl(authUrl);
      } else {
        note(`Please open this URL in your browser: ${authUrl}`, globals);
      }
    });
    
    server.on('error', (err) => {
      reject(err);
    });
  });
}

export async function handleAuth(verb: string | undefined, globals: GlobalFlags, argv: any) {
  ensureHome(paths);
  if (verb === 'login') {
    let clientId = argv['client-id'] || process.env.CLASSROOM_CLIENT_ID;
    let clientSecret = argv['client-secret'] || process.env.CLASSROOM_CLIENT_SECRET;
    
    const credsPath = join(paths.config, 'credentials.json');
    if (!clientId || !clientSecret) {
      if (existsSync(credsPath)) {
        try {
          const credsFile = JSON.parse(readFileSync(credsPath, 'utf8'));
          const installed = credsFile.installed || credsFile.web;
          if (installed && installed.client_id && installed.client_secret) {
            clientId = installed.client_id;
            clientSecret = installed.client_secret;
            note(`Loaded OAuth credentials from ${credsPath}`, globals);
          }
        } catch (e) {
          note(`Failed to parse ${credsPath}, falling back to prompt...`, globals);
        }
      }
    }
    
    if (!clientId || !clientSecret) {
      if (globals.noInput || detectMode(globals) === 'json') {
        throw new AppError('MISSING_OAUTH_CREDS', {
          name: 'MissingOAuthCreds',
          human: 'Missing Client ID or Secret and in non-interactive mode.',
          hint: 'Pass --client-id and --client-secret or set CLASSROOM_CLIENT_ID and CLASSROOM_CLIENT_SECRET'
        });
      }
      
      console.log('Google Classroom OAuth 2.0 Setup');
      console.log('You need a Desktop OAuth Client ID from Google Cloud Console.');
      
      const inputId = await promptSecret('Client ID: ');
      if (!inputId) throw new AppError('NO_INPUT', { name: 'NoInput', human: 'Client ID required.' });
      clientId = inputId;
      
      const inputSecret = await promptSecret('Client Secret: ');
      if (!inputSecret) throw new AppError('NO_INPUT', { name: 'NoInput', human: 'Client Secret required.' });
      clientSecret = inputSecret;
    }

    try {
      const tokens = await runLocalOAuthFlow(clientId, clientSecret, globals);
      await saveSession(paths.sessions, { 
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        createdAt: new Date().toISOString() 
      });
      emit({ loggedIn: true }, globals, () => console.log(`\nSuccessfully logged in to Google Classroom with all scopes.`));
    } catch (e: any) {
      throw new AppError('OAUTH_FAILED', {
        name: 'OAuthFailed',
        human: 'Failed to authenticate via OAuth: ' + e.message
      }, e);
    }
  } else if (verb === 'logout') {
    await clearSession(paths.sessions);
    emit({ loggedOut: true }, globals, () => console.log('Logged out.'));
  } else {
    throw new AppError('UNKNOWN_COMMAND', {
      name: 'UnknownCommand',
      human: `Unknown auth verb: ${verb}`
    });
  }
}
