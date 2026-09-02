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
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(shouldFetchRelated ? `Fetching course ${id} and its related data...` : `Fetching course ${id}...`, globals);
    try {
      const [courseRes, teachersRes, topicsRes, workRes, matRes, streamRes] = await Promise.all([
        classroom.courses.get({ id }),
        shouldFetchRelated ? classroom.courses.teachers.list({ courseId: id }).catch(() => ({ data: { teachers: [] } })) : Promise.resolve({ data: { teachers: [] } }),
        shouldFetchRelated ? classroom.courses.topics.list({ courseId: id }).catch(() => ({ data: { topic: [] } })) : Promise.resolve({ data: { topic: [] } }),
        shouldFetchRelated ? classroom.courses.courseWork.list({ courseId: id }).catch(() => ({ data: { courseWork: [] } })) : Promise.resolve({ data: { courseWork: [] } }),
        shouldFetchRelated ? classroom.courses.courseWorkMaterials.list({ courseId: id }).catch(() => ({ data: { courseWorkMaterial: [] } })) : Promise.resolve({ data: { courseWorkMaterial: [] } }),
        shouldFetchRelated ? classroom.courses.announcements.list({ courseId: id }).catch(() => ({ data: { announcements: [] } })) : Promise.resolve({ data: { announcements: [] } })
      ]);
      
      const course = courseRes.data;
      const teachers = teachersRes.data.teachers || [];
      const topics = topicsRes.data.topic || [];
      const coursework = workRes.data.courseWork || [];
      const materials = matRes.data.courseWorkMaterial || [];
      const stream = streamRes.data.announcements || [];
      
      emit({ course, teachers, topics, coursework, materials, stream }, globals, (data) => {
        if (shouldFetchRelated) console.log(pc.green(`\n✔ Course Details:`));
        const courseBlock = getCourseBlock(data.course, isFull);
        
        if (shouldFetchRelated && data.teachers.length > 0) {
          courseBlock.details!.push(['Teachers', data.teachers.map((t: any) => t.profile?.name?.fullName || t.userId).join(', ')]);
        }
        if (shouldFetchRelated) {
          if (data.topics.length > 0) courseBlock.details!.push(['Topics', String(data.topics.length)]);
          if (data.coursework.length > 0) courseBlock.details!.push(['Assignments', String(data.coursework.length)]);
          if (data.materials.length > 0) courseBlock.details!.push(['Materials', String(data.materials.length)]);
          if (data.stream.length > 0) courseBlock.details!.push(['Announcements', String(data.stream.length)]);
        }
        
        printBlock([courseBlock]);
        
        if (shouldFetchRelated) {
          if (data.topics.length > 0) {
            console.log(pc.green(`✔ Topics:`));
            printBlock(data.topics.map((t: any) => {
              const item: BlockItem = { title: t.name, id: t.topicId };
              if (isFull) item.details = [['Updated', t.updateTime]];
              return item;
            }));
          }
          
          if (data.coursework.length > 0) {
            console.log(pc.green(`✔ Assignments:`));
            printBlock(data.coursework.map((cw: any) => {
              const item: BlockItem = { title: cw.title, id: cw.id };
              if (isFull) {
                item.details = [
                  ['State', cw.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(cw.state || 'UNKNOWN')],
                  ['Due', cw.dueDate ? `${cw.dueDate.year}-${cw.dueDate.month}-${cw.dueDate.day}` : 'None']
                ];
                if (cw.alternateLink) item.details.push(['Link', pc.blue(pc.underline(cw.alternateLink))]);
                if (cw.materials && cw.materials.length > 0) {
                  item.attachments = cw.materials.map((att: any) => {
                    if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title}`;
                    if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
                    if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title}`;
                    return 'Unknown Attachment';
                  });
                }
              }
              return item;
            }));
          }
          
          if (data.materials.length > 0) {
            console.log(pc.green(`✔ Materials:`));
            printBlock(data.materials.map((m: any) => {
              const item: BlockItem = { title: m.title, id: m.id };
              if (isFull) {
                item.details = [['State', m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN')]];
                if (m.alternateLink) item.details.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
                if (m.materials && m.materials.length > 0) {
                  item.attachments = m.materials.map((att: any) => {
                    if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title}`;
                    if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
                    if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title}`;
                    return 'Unknown Attachment';
                  });
                }
              }
              return item;
            }));
          }
          
          if (data.stream.length > 0) {
            console.log(pc.green(`✔ Stream Announcements:`));
            printBlock(data.stream.map((a: any) => {
              const item: BlockItem = { title: a.text.split('\n')[0].substring(0, 50) + (a.text.length > 50 ? '...' : ''), id: a.id };
              if (isFull) {
                item.details = [['Posted', a.updateTime]];
                if (a.alternateLink) item.details.push(['Link', pc.blue(pc.underline(a.alternateLink))]);
                if (a.materials && a.materials.length > 0) {
                  item.attachments = a.materials.map((att: any) => {
                    if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title}`;
                    if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
                    if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title}`;
                    return 'Unknown Attachment';
                  });
                }
              }
              return item;
            }));
          }
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
