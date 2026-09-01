import { google } from 'googleapis';
import { AppError } from '../cli/foundation/error-map.js';
import { loadSession, saveSession } from '../cli/foundation/session.js';
import { getAppPaths, ensureHome } from '../cli/foundation/xdg-paths.js';

const paths = getAppPaths('classroom-cli');

export type SessionData = {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  createdAt: string;
};

export async function getClient() {
  ensureHome(paths);
  const session = await loadSession<SessionData>(paths.sessions);
  if (!session?.access_token) {
    throw new AppError('UNAUTHENTICATED', {
      name: 'Unauthenticated',
      human: 'Not logged in.',
      hint: 'Run `classroom auth login` first.'
    });
  }

  const oauth2Client = new google.auth.OAuth2(session.client_id, session.client_secret);
  oauth2Client.setCredentials({ 
    access_token: session.access_token,
    refresh_token: session.refresh_token || null 
  });
  
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      saveSession(paths.sessions, {
        ...session,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || session.refresh_token,
        createdAt: new Date().toISOString()
      });
    }
  });

  return google.classroom({ version: 'v1', auth: oauth2Client });
}
