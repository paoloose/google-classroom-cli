import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';

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
  const courseId = argv._[2];
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom roster list <course_id>' });
  
  const role = argv['role'] || 'student'; // 'student' or 'teacher'

  note(`Fetching roster for course ${courseId}...`, globals);
  const classroom = await getClient();
  
  try {
    if (role === 'teacher') {
      const res = await classroom.courses.teachers.list({ courseId });
      const teachers = res.data.teachers || [];
      emit({ teachers }, globals, (data) => {
        if (data.teachers.length === 0) { console.log('No teachers found.'); return; }
        for (const t of data.teachers) { console.log(`- ${t.profile?.name?.fullName} (${t.profile?.emailAddress})`); }
      });
    } else {
      const res = await classroom.courses.students.list({ courseId });
      const students = res.data.students || [];
      emit({ students }, globals, (data) => {
        if (data.students.length === 0) { console.log('No students found.'); return; }
        for (const s of data.students) { console.log(`- ${s.profile?.name?.fullName} (${s.profile?.emailAddress})`); }
      });
    }
  } catch (error: any) {
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error);
  }
}

async function handleRosterAdd(globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  const email = argv['email'];
  const role = argv['role'] || 'student';
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
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
  const courseId = argv._[2];
  const email = argv['email'];
  const role = argv['role'] || 'student';
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
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
