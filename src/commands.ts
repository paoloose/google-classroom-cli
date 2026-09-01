import { google } from 'googleapis';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';
import { AppError } from '../cli/foundation/error-map.js';
import { emit, note } from '../cli/agent/json-mode.js';
import { type GlobalFlags } from '../cli/foundation/global-flags.js';
import { loadSession, saveSession, clearSession } from '../cli/foundation/session.js';
import { promptSecret } from '../cli/agent/prompt-secret.js';
import { detectMode, shouldColor } from '../cli/platform/detect.js';
import { getAppPaths, ensureHome } from '../cli/foundation/xdg-paths.js';

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly'
];

const paths = getAppPaths('classroom-cli');

type SessionData = {
  access_token?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
  createdAt: string;
};

async function getClient() {
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

  // Optional: Listen for tokens event to save new tokens if they refresh
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
      scope: SCOPES,
      prompt: 'consent' // Force to get refresh token
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
      emit({ loggedIn: true }, globals, () => console.log('\nSuccessfully logged in to Google Classroom.'));
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

export async function handleCourseList(globals: GlobalFlags, argv: any) {
  note('Fetching courses...', globals);
  const classroom = await getClient();

  try {
    const res = await classroom.courses.list({
      courseStates: ['ACTIVE'],
    });
    const courses = res.data.courses || [];

    emit({ courses }, globals, (data) => {
      if (data.courses.length === 0) {
        console.log('No courses found.');
        return;
      }
      for (const course of data.courses) {
        console.log(`- ${course.name} (${course.id})`);
      }
    });
  } catch (error: any) {
    throw new AppError('API_ERROR', {
      name: 'ApiError',
      human: error.message || 'Failed to list courses'
    }, error);
  }
}

export async function handleCourseGet(globals: GlobalFlags, argv: any) {
  const id = argv._[2];
  if (!id) throw new AppError('MISSING_ARG', {
    name: 'MissingArg',
    human: 'Course ID is required',
    hint: 'classroom course get <id>'
  });

  note(`Fetching course ${id}...`, globals);
  const classroom = await getClient();

  try {
    const res = await classroom.courses.get({ id });
    const course = res.data;

    emit({ course }, globals, (data) => {
      console.log(`Course: ${data.course.name}`);
      console.log(`ID: ${data.course.id}`);
      console.log(`Status: ${data.course.courseState}`);
      console.log(`Description: ${data.course.descriptionHeading || 'N/A'}`);
    });
  } catch (error: any) {
    throw new AppError('API_ERROR', {
      name: 'ApiError',
      human: error.message || 'Failed to get course'
    }, error);
  }
}

export async function handleCourseStream(globals: GlobalFlags, argv: any) {
  const id = argv._[2];
  if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom course stream <id>' });
  note(`Fetching announcements for course ${id}...`, globals);
  const classroom = await getClient();
  try {
    const res = await classroom.courses.announcements.list({ courseId: id });
    const announcements = res.data.announcements || [];
    emit({ announcements }, globals, (data) => {
      if (data.announcements.length === 0) { console.log('No announcements found.'); return; }
      for (const a of data.announcements) { console.log(`- ${a.text} (Updated: ${a.updateTime})`); }
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
}

export async function handleCourseWork(globals: GlobalFlags, argv: any) {
  const id = argv._[2];
  if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom course work <id>' });
  note(`Fetching coursework for course ${id}...`, globals);
  const classroom = await getClient();
  try {
    const res = await classroom.courses.courseWork.list({ courseId: id });
    const coursework = res.data.courseWork || [];
    const now = new Date();
    emit({ coursework }, globals, (data) => {
      if (data.coursework.length === 0) { console.log('No coursework found.'); return; }
      for (const cw of data.coursework) {
        let dueStr = 'No due date';
        if (cw.dueDate) {
          const tDate = parseDueDate(cw);
          const pad = (n: number) => n.toString().padStart(2, '0');
          const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
          dueStr = `Due: ${localDateStr} | left: ${formatTimeLeft(tDate, now)}`;
        }
        console.log(`- [${cw.state}] ${cw.title} (${dueStr})`);
      }
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
}

async function getPendingTasks(classroom: any, globals: any) {
  note('Fetching active courses...', globals);
  const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'] });
  const courses = coursesRes.data.courses || [];
  const pendingTasks: {course: string, courseId: string, submission: any, courseWork: any}[] = [];

  for (const course of courses) {
    note(`Checking pending tasks for ${course.name}...`, globals);
    try {
      const [submissionsRes, cwRes] = await Promise.all([
        classroom.courses.courseWork.studentSubmissions.list({ courseId: course.id, courseWorkId: '-', userId: 'me' }),
        classroom.courses.courseWork.list({ courseId: course.id })
      ]);
      const submissions = submissionsRes.data.studentSubmissions || [];
      const courseWorkList = cwRes.data.courseWork || [];
      const cwMap = new Map(courseWorkList.map((cw: any) => [cw.id, cw]));

      for (const sub of submissions) {
        if (sub.state === 'NEW' || sub.state === 'CREATED' || sub.state === 'RECLAIMED_BY_STUDENT') {
          const cw = cwMap.get(sub.courseWorkId);
          if (cw) {
            pendingTasks.push({ course: course.name, courseId: course.id, submission: sub, courseWork: cw });
          }
        }
      }
    } catch (e: any) {
      // Ignore if user isn't a student in this course or has no access
    }
  }
  return pendingTasks;
}

export async function handleTasksPending(globals: GlobalFlags, argv: any) {
  const classroom = await getClient();
  try {
    const pendingTasks = await getPendingTasks(classroom, globals);
    emit({ pendingTasks }, globals, (data) => {
      if (data.pendingTasks.length === 0) { console.log('No pending tasks!'); return; }
      console.log('Pending Tasks:');
      for (const t of data.pendingTasks) {
        console.log(`- [${t.course}] ${t.courseWork.title} (Link: ${t.courseWork.alternateLink})`);
      }
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
}

function formatTimeLeft(tDate: Date, now: Date) {
  const diffMs = tDate.getTime() - now.getTime();
  if (diffMs <= 0) return 'Overdue';

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (totalSeconds < 69 * 60) {
    const m = Math.floor(totalSeconds / 60);
    return `${m}m${seconds}s`;
  } else if (totalSeconds >= 24 * 3600) {
    return `${days}d${hours}h`;
  } else {
    return `${hours}h${minutes}m`;
  }
}

function parseDueDate(cw: any) {
  const d = cw.dueDate;
  const t = cw.dueTime || { hours: 23, minutes: 59, seconds: 59 };
  return new Date(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1, t.hours || 0, t.minutes || 0, t.seconds || 0));
}

export async function handleTasksDueSoon(globals: GlobalFlags, argv: any) {
  const classroom = await getClient();
  try {
    const pendingTasks = await getPendingTasks(classroom, globals);
    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const dueSoonTasks = pendingTasks.filter(t => {
      if (!t.courseWork.dueDate) return false;
      const tDate = parseDueDate(t.courseWork);
      return tDate >= now && tDate <= nextWeek;
    });

    dueSoonTasks.sort((a, b) => {
      return parseDueDate(a.courseWork).getTime() - parseDueDate(b.courseWork).getTime();
    });

    emit({ dueSoonTasks }, globals, (data) => {
      if (data.dueSoonTasks.length === 0) { console.log('No tasks due in the next 7 days!'); return; }
      console.log('Tasks Due Soon:');
      for (const t of data.dueSoonTasks) {
        const tDate = parseDueDate(t.courseWork);
        const timeLeft = formatTimeLeft(tDate, now);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
        console.log(`- [${t.course}] ${t.courseWork.title} (Due: ${localDateStr} | left: ${timeLeft})`);
      }
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
}
