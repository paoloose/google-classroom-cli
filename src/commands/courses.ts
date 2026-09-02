import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';
import prettyjson from 'prettyjson';
import pc from 'picocolors';

function printYaml(obj: any) {
  console.log(prettyjson.render(obj, {
    keysColor: 'cyan',
    dashColor: 'magenta',
    stringColor: 'red',
    numberColor: 'green'
  }));
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
        
        const summary = data.courses.map(c => {
          const res: any = { Name: c.name, ID: c.id };
          if (c.section) res.Section = c.section;
          if (c.subject) res.Subject = c.subject;
          if (c.room) res.Room = c.room;
          if (c.alternateLink) res.Link = c.alternateLink;
          return res;
        });
        printYaml(summary);
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
        const c = data.course;
        const res: any = { Name: c.name, ID: c.id, Status: c.courseState };
        if (c.section) res.Section = c.section;
        if (c.subject) res.Subject = c.subject;
        if (c.room) res.Room = c.room;
        if (c.descriptionHeading) res.Description = c.descriptionHeading;
        if (c.alternateLink) res.Link = c.alternateLink;
        printYaml({ Course: res });
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
        console.log(pc.green(`\nSuccessfully created course: ${data.course.name}`));
        printYaml({ ID: data.course.id, State: data.course.courseState, Link: data.course.alternateLink });
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
