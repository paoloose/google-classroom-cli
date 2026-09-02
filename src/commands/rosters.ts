import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';
import pc from 'picocolors';

import { printBlock } from '../ui.js';
import { resolveCourseId } from '../context.js';

export async function handleRoster(verb: string | undefined, globals: GlobalFlags, argv: any) {
  if (verb === 'list') {
    await handleRosterList(globals, argv);
  } else if (verb === 'add') {
    await handleRosterAdd(globals, argv);
  } else if (verb === 'remove') {
    await handleRosterRemove(globals, argv);
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown roster verb: ${verb}` });
  }
}

async function handleRosterList(globals: GlobalFlags, argv: any) {
  const courseId = resolveCourseId(argv._[2]);
  
  const role = argv['role'] === 'teacher' ? 'teacher' : 'student';

  note(`Fetching ${role}s for course ${courseId}...`, globals);
  const classroom = await getClient();
  
  try {
    const users: any[] = [];
    if (role === 'teacher') {
      const res = await classroom.courses.teachers.list({ courseId });
      if (res.data.teachers) users.push(...res.data.teachers);
    } else {
      const res = await classroom.courses.students.list({ courseId });
      if (res.data.students) users.push(...res.data.students);
    }
    
    emit({ users }, globals, (data) => {
      if (data.users.length === 0) {
        console.log(pc.yellow(`No ${role}s found.`));
        return;
      }
      printBlock(data.users.map((user: any) => ({
        title: user.profile?.name?.fullName || 'Unknown',
        id: user.userId,
        details: [
          ['Email', user.profile?.emailAddress || 'Unknown']
        ]
      })));
    });
  } catch (error: any) {
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error);
  }
}

async function handleRosterAdd(globals: GlobalFlags, argv: any) {
  const courseId = resolveCourseId(argv._[2]);
  const email = argv['email'];
  const role = argv['role'] || 'student';
  if (!email) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--email is required' });

  note(`Adding ${email} to course ${courseId}...`, globals);
  const classroom = await getClient();
  
  try {
    if (role === 'teacher') {
      await classroom.courses.teachers.create({ courseId, requestBody: { userId: email } });
    } else {
      await classroom.courses.students.create({ courseId, requestBody: { userId: email } });
    }
    emit({ success: true }, globals, () => {
      console.log(`Successfully added ${email} as a ${role}.`);
    });
  } catch (error: any) {
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error);
  }
}

async function handleRosterRemove(globals: GlobalFlags, argv: any) {
  const courseId = resolveCourseId(argv._[2]);
  const email = argv['email'];
  const role = argv['role'] || 'student';
  if (!email) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--email is required' });

  note(`Removing ${email} from course ${courseId}...`, globals);
  const classroom = await getClient();
  
  try {
    if (role === 'teacher') {
      await classroom.courses.teachers.delete({ courseId, userId: email });
    } else {
      await classroom.courses.students.delete({ courseId, userId: email });
    }
    emit({ success: true }, globals, () => {
      console.log(`Successfully removed ${email} as a ${role}.`);
    });
  } catch (error: any) {
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error);
  }
}
