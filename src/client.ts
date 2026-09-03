import { google } from 'googleapis';
import { AppError } from '../cli/foundation/error-map.js';
import { loadSession, saveSession } from '../cli/foundation/session.js';
import { getAppPaths, ensureHome } from '../cli/foundation/xdg-paths.js';
import { ProfileManager } from '../cli/foundation/profile.js';

const paths = getAppPaths('classroom-cli');

export type SessionData = {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  createdAt: string;
};

async function getOAuthClient() {
  ensureHome(paths);
  
  const profileManager = new ProfileManager('classroom-cli');
  const activeProfile = profileManager.getActiveProfile();
  
  if (!activeProfile) {
    throw new AppError('NO_ACTIVE_PROFILE', {
      name: 'NoActiveProfile',
      human: 'No active profile found.',
      hint: 'Run `classroom auth login` or `classroom profile add <name>` first.'
    });
  }

  const session = await loadSession<SessionData>(activeProfile.paths.session);
  if (!session?.access_token) {
    throw new AppError('UNAUTHENTICATED', {
      name: 'Unauthenticated',
      human: `Not logged in on profile '${activeProfile.name}'.`,
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
      saveSession(activeProfile.paths.session, {
        ...session,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || session.refresh_token,
        createdAt: new Date().toISOString()
      });
    }
  });

  return oauth2Client;
}

export async function getClient() {
  const auth = await getOAuthClient();
  return google.classroom({ version: 'v1', auth });
}

export async function getDriveClient() {
  const auth = await getOAuthClient();
  return google.drive({ version: 'v3', auth });
}
