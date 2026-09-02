import { AppError } from '../../cli/foundation/error-map.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { getClient } from '../client.js';
import pc from 'picocolors';

import { printBlock, BlockItem } from '../ui.js';

function getCourseBlock(c: any, full: boolean = false): BlockItem {
  const details: [string, string][] = [];
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

  return { title: c.name, id: c.id, details };
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
        printBlock(data.courses.map((c: any) => getCourseBlock(c, !!argv.full)));
      });
    } catch (error: any) {
      throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to list courses' }, error);
    }
  } else if (verb === 'get') {
    const id = argv._[2];
    if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required', hint: 'classroom course get <id>' });
    
    note(argv.related ? `Fetching course ${id} and its related data...` : `Fetching course ${id}...`, globals);
    try {
      const [courseRes, teachersRes, topicsRes] = await Promise.all([
        classroom.courses.get({ id }),
        argv.related ? classroom.courses.teachers.list({ courseId: id }).catch(() => ({ data: { teachers: [] } })) : Promise.resolve({ data: { teachers: [] } }),
        argv.related ? classroom.courses.topics.list({ courseId: id }).catch(() => ({ data: { topic: [] } })) : Promise.resolve({ data: { topic: [] } })
      ]);
      
      const course = courseRes.data;
      const teachers = teachersRes.data.teachers || [];
      const topics = topicsRes.data.topic || [];
      
      emit({ course, teachers, topics }, globals, (data) => {
        if (argv.related) console.log(pc.green(`\n✔ Course Details:`));
        const courseBlock = getCourseBlock(data.course, !!argv.full);
        
        if (argv.related && data.teachers.length > 0) {
          courseBlock.details!.push(['Teachers', data.teachers.map((t: any) => t.profile?.name?.fullName || t.userId).join(', ')]);
        }
        if (argv.related && data.topics.length > 0) {
          courseBlock.details!.push(['Topics', String(data.topics.length)]);
        }
        
        printBlock([courseBlock]);
        
        if (argv.related && data.topics.length > 0) {
          console.log(pc.green(`✔ Topics:`));
          printBlock(data.topics.map((t: any) => ({
            title: t.name,
            id: t.topicId,
            details: [['Updated', t.updateTime]]
          })));
        }
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
        printBlock([getCourseBlock(data.course, !!argv.full)]);
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
