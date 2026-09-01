import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';

export async function handleCourse(verb: string | undefined, globals: GlobalFlags, argv: any) {
  if (verb === 'list') {
    await handleCourseList(globals, argv);
  } else if (verb === 'get') {
    await handleCourseGet(globals, argv);
  } else if (verb === 'create') {
    await handleCourseCreate(globals, argv);
  } else if (verb === 'update') {
    await handleCourseUpdate(globals, argv);
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown course verb: ${verb}` });
  }
}

async function handleCourseList(globals: GlobalFlags, argv: any) {
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
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to list courses' }, error);
  }
}

async function handleCourseGet(globals: GlobalFlags, argv: any) {
  const id = argv._[2];
  if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom course get <id>' });

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
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to get course' }, error);
  }
}

async function handleCourseCreate(globals: GlobalFlags, argv: any) {
  const name = argv['name'];
  const section = argv['section'];
  if (!name) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--name is required' });

  note(`Creating course ${name}...`, globals);
  const classroom = await getClient();
  
  try {
    const res = await classroom.courses.create({
      requestBody: {
        name,
        section,
        ownerId: 'me',
        courseState: 'PROVISIONED'
      }
    });
    const course = res.data;
    
    emit({ course }, globals, (data) => {
      console.log(`Successfully created course: ${data.course.name} (ID: ${data.course.id})`);
    });
  } catch (error: any) {
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to create course' }, error);
  }
}

async function handleCourseUpdate(globals: GlobalFlags, argv: any) {
  const id = argv._[2];
  if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom course update <id>' });

  const status = argv['status'];
  if (!status) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--status is required (e.g. ACTIVE, ARCHIVED, DECLINED)' });

  note(`Updating course ${id}...`, globals);
  const classroom = await getClient();
  
  try {
    // get course first to use as base for update, but update uses patch in v1
    const res = await classroom.courses.patch({
      id,
      updateMask: 'courseState',
      requestBody: {
        courseState: status
      }
    });
    const course = res.data;
    
    emit({ course }, globals, (data) => {
      console.log(`Successfully updated course status to ${data.course.courseState}`);
    });
  } catch (error: any) {
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to update course' }, error);
  }
}
