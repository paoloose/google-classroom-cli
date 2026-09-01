import { google } from 'googleapis';
import { AppError } from '../cli/foundation/error-map.js';
import { emit, note } from '../cli/agent/json-mode.js';
import { GlobalFlags } from '../cli/foundation/global-flags.js';
import { loadSession, saveSession, clearSession } from '../cli/foundation/session.js';
import { promptSecret } from '../cli/agent/prompt-secret.js';
import { detectMode } from '../cli/platform/detect.js';
import { getAppPaths, ensureHome } from '../cli/foundation/xdg-paths.js';

const SCOPES = ['https://www.googleapis.com/auth/classroom.courses.readonly'];

const paths = getAppPaths('classroom');

async function getClient() {
  ensureHome(paths);
  const session = await loadSession<{ access_token: string }>(paths.sessions);
  if (!session?.access_token) {
    throw new AppError('UNAUTHENTICATED', {
      name: 'Unauthenticated',
      human: 'Not logged in.',
      hint: 'Run `classroom auth login` first.'
    });
  }

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: session.access_token });
  return google.classroom({ version: 'v1', auth: oauth2Client });
}

export async function handleAuth(verb: string | undefined, globals: GlobalFlags, argv: any) {
  ensureHome(paths);
  if (verb === 'login') {
    let token = argv.token as string;
    
    if (!token) {
      if (!detectMode().isInteractive) {
        throw new AppError('MISSING_TOKEN', {
          name: 'MissingToken',
          human: 'No token provided and non-interactive mode.',
          hint: 'Pass --token=<token>'
        });
      }
      process.stderr.write('Enter Google access token: ');
      const secret = await promptSecret();
      if (!secret) throw new AppError('NO_INPUT', {
        name: 'NoInput',
        human: 'No token provided.'
      });
      token = secret;
    }

    await saveSession(paths.sessions, { access_token: token, createdAt: new Date().toISOString() });
    emit({ loggedIn: true }, globals, () => console.log('Successfully logged in.'));
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
