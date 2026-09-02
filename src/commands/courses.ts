import { AppError } from '../../cli/foundation/error-map.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { getClient } from '../client.js';
import pc from 'picocolors';

function printCourseModern(c: any, full: boolean = false) {
  console.log(`${pc.cyan('●')} ${pc.bold(c.name)}`);
  
  const details: [string, string][] = [];
  details.push(['ID', c.id]);
  if (c.courseState || full) details.push(['Status', c.courseState === 'ACTIVE' ? pc.green('ACTIVE') : pc.yellow(c.courseState || 'N/A')]);
  if (c.section || full) details.push(['Section', c.section || 'N/A']);
  if (c.subject || full) details.push(['Subject', c.subject || 'N/A']);
  if (c.room || full) details.push(['Room', c.room || 'N/A']);
  if (c.descriptionHeading || full) details.push(['Description', c.descriptionHeading || 'N/A']);
  if (c.alternateLink) details.push(['Link', pc.blue(pc.underline(c.alternateLink))]);

  if (full) {
    if (c.ownerId) details.push(['Owner ID', c.ownerId]);
    if (c.creationTime) details.push(['Created', c.creationTime]);
    if (c.updateTime) details.push(['Updated', c.updateTime]);
    if (c.teacherGroupEmail) details.push(['Teacher Email', c.teacherGroupEmail]);
    if (c.courseGroupEmail) details.push(['Course Email', c.courseGroupEmail]);
    if (c.guardiansEnabled !== undefined) details.push(['Guardians', c.guardiansEnabled ? 'Yes' : 'No']);
    if (c.calendarId) details.push(['Calendar ID', c.calendarId]);
  }

  const maxLen = Math.max(...details.map(d => d[0].length));
  for (const [k, v] of details) {
    console.log(`  ${pc.dim((k + ':').padEnd(maxLen + 1))} ${v}`);
  }
  console.log('');
}

export async function handleCourse(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();

  if (verb === 'list') {
    try {
      const res = await classroom.courses.list({
        courseStates: ['ACTIVE'],
      });
      const activeCourses = res.data.courses || [];
      
      emit({ courses: activeCourses }, globals, (data) => {
        if (data.courses.length === 0) {
          console.log(pc.yellow('No active courses found.'));
          return;
        }
        console.log(''); // Leading newline
        for (const c of data.courses) {
          printCourseModern(c, !!argv.full);
        }
      });
    } catch (error: any) {
      throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to list courses' }, error);
    }
  } else if (verb === 'get') {
    const id = argv._[2];
    if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom course get <id>' });
    
    note(`Fetching course ${id}...`, globals);
    try {
      const res = await classroom.courses.get({ id });
      const course = res.data;
      
      emit({ course }, globals, (data) => {
        console.log('');
        printCourseModern(data.course, !!argv.full);
      });
    } catch (error: any) {
      throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to get course' }, error);
    }
  } else if (verb === 'create') {
    const name = argv['name'];
    const section = argv['section'];
    if (!name) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--name is required' });
    
    note(`Creating course ${name}...`, globals);
    try {
      const res = await classroom.courses.create({
        requestBody: {
          name,
          section,
          ownerId: 'me'
        }
      });
      const course = res.data;
      
      emit({ course }, globals, (data) => {
        console.log(pc.green(`\n✔ Successfully created course:`));
        printCourseModern(data.course, !!argv.full);
      });
    } catch (error: any) {
      throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to create course' }, error);
    }
  } else if (verb === 'update') {
    const id = argv._[2];
    if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom course update <id>' });

    const status = argv['status'];
    if (!status) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--status is required (e.g. ACTIVE, ARCHIVED, DECLINED)' });

    note(`Updating course ${id}...`, globals);
    
    try {
      const res = await classroom.courses.patch({
        id,
        updateMask: 'courseState',
        requestBody: {
          courseState: status
        }
      });
      const course = res.data;
      
      emit({ course }, globals, (data) => {
        console.log(pc.green(`Successfully updated course status to ${data.course.courseState}`));
      });
    } catch (error: any) {
      throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to update course' }, error);
    }
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown course verb: ${verb}` });
  }
}
