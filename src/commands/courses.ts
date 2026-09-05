import { AppError } from '../../cli/foundation/error-map.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { resolveDateRange, applyDateFilter } from '../../cli/foundation/date-filter.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { getClient } from '../client.js';
import pc from 'picocolors';

import { printBlock, BlockItem } from '../ui.js';
import { extractDriveFileIds, fetchDriveFileSizes, formatAttachments } from '../attachments.js';
import { parseDueDate } from '../date-utils.js';
import { getActiveCourse, setActiveCourse, clearActiveCourse, resolveCourseId } from '../context.js';
import { parseClassroomUrl, decodeClassroomIdentifier } from '../url-utils.js';

function getCourseBlock(c: any, full: boolean = false, isSelected: boolean = false): BlockItem {
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

  const title = isSelected ? `${c.name} ${pc.green('(Selected)')}` : c.name;
  return { title, id: c.id, details };
}

export async function handleCourse(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();

  if (verb === 'list') {
    try {
      const res = await classroom.courses.list({
        courseStates: ['ACTIVE'],
      });
      const activeCourses = res.data.courses || [];
      const range = resolveDateRange(globals.from, globals.last);
      const courses = applyDateFilter(activeCourses, range, (c: any) => c.updateTime || c.creationTime);
      const active = getActiveCourse();
      
      emit({ courses }, globals, (data) => {
        if (data.courses.length === 0) {
          console.log(pc.yellow('No active courses found.'));
          return;
        }
        printBlock(data.courses.map((c: any) => getCourseBlock(c, !!argv.full, active?.id === c.id)));
      });
    } catch (error: any) {
      throw new AppError('API_ERROR', { name: 'ApiError', human: error.message || 'Failed to list courses' }, error);
    }
  } else if (verb === 'get') {
    const id = resolveCourseId(argv._[2]);
    
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
      
      const range = resolveDateRange(globals.from, globals.last);
      const filteredTopics = applyDateFilter(topics, range, (t: any) => t.updateTime);
      const filteredCoursework = applyDateFilter(coursework, range, (cw: any) => cw.dueDate ? parseDueDate(cw) : cw.updateTime);
      const filteredMaterials = applyDateFilter(materials, range, (m: any) => m.updateTime);
      const filteredStream = applyDateFilter(stream, range, (a: any) => a.updateTime);
      
      const fileIds = shouldFetchRelated ? extractDriveFileIds([filteredCoursework, filteredMaterials, filteredStream]) : [];
      const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
      
      emit({ course, teachers, topics: filteredTopics, coursework: filteredCoursework, materials: filteredMaterials, stream: filteredStream }, globals, (data) => {
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
              
              const topicAtts: string[] = [];
              data.coursework.filter((cw: any) => cw.topicId === t.topicId).forEach((cw: any) => {
                const atts = formatAttachments(cw.materials, sizeMap);
                if (atts) topicAtts.push(...atts);
              });
              data.materials.filter((m: any) => m.topicId === t.topicId).forEach((m: any) => {
                const atts = formatAttachments(m.materials, sizeMap);
                if (atts) topicAtts.push(...atts);
              });
              if (topicAtts.length > 0) item.attachments = topicAtts;
              
              return item;
            }));
          }
          
          if (data.coursework.length > 0) {
            console.log(pc.green(`✔ Assignments:`));
            printBlock(data.coursework.map((cw: any) => {
              const item: BlockItem = { title: cw.title, id: cw.id };
              const atts = formatAttachments(cw.materials, sizeMap);
              if (atts) item.attachments = atts;
              
              if (isFull) {
                item.details = [
                  ['State', cw.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(cw.state || 'UNKNOWN')],
                  ['Due', cw.dueDate ? `${cw.dueDate.year}-${cw.dueDate.month}-${cw.dueDate.day}` : 'None']
                ];
                if (cw.alternateLink) item.details.push(['Link', pc.blue(pc.underline(cw.alternateLink))]);
              }
              return item;
            }));
          }
          
          if (data.materials.length > 0) {
            console.log(pc.green(`✔ Materials:`));
            printBlock(data.materials.map((m: any) => {
              const item: BlockItem = { title: m.title, id: m.id };
              const atts = formatAttachments(m.materials, sizeMap);
              if (atts) item.attachments = atts;
              
              if (isFull) {
                item.details = [['State', m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN')]];
                if (m.alternateLink) item.details.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
              }
              return item;
            }));
          }
          
          if (data.stream.length > 0) {
            console.log(pc.green(`✔ Stream Announcements:`));
            printBlock(data.stream.map((a: any) => {
              const item: BlockItem = { title: a.text.split('\n')[0].substring(0, 50) + (a.text.length > 50 ? '...' : ''), id: a.id };
              const atts = formatAttachments(a.materials, sizeMap);
              if (atts) item.attachments = atts;
              
              if (isFull) {
                item.details = [['Posted', a.updateTime]];
                if (a.alternateLink) item.details.push(['Link', pc.blue(pc.underline(a.alternateLink))]);
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
  } else if (verb === 'select') {
    const explicitArg = argv._[2];
    if (explicitArg) {
      const explicitId = resolveCourseId(explicitArg);
      note(`Verifying course ${explicitId}...`, globals);
      const res = await classroom.courses.get({ id: explicitId });
      const c = res.data;
      const active = setActiveCourse({ id: c.id!, name: c.name!, section: c.section || undefined });
      emit({ selected: active }, globals, () => {
        console.log(pc.green(`✔ Selected course: ${active.name} (ID: ${active.id})`));
      });
      return;
    }

    if (globals.json) {
      throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required in JSON mode', hint: 'classroom course select <id>' });
    }

    note('Fetching active courses...', globals);
    const res = await classroom.courses.list({ courseStates: ['ACTIVE'] });
    const courses = res.data.courses || [];
    if (courses.length === 0) {
      console.log(pc.yellow('No active courses found to select.'));
      return;
    }

    const { select, isCancel, cancel } = await import('@clack/prompts');
    const options = courses.map((c: any) => ({
      value: c.id!,
      label: `${c.name}${c.section ? ` · ${c.section}` : ''}`,
      hint: `ID: ${c.id}`
    }));

    const selectedId = await select({
      message: 'Select a course to set as active context:',
      options
    });

    if (isCancel(selectedId)) {
      cancel('Selection cancelled.');
      return;
    }

    const chosen = courses.find((c: any) => c.id === selectedId);
    if (!chosen) return;
    const active = setActiveCourse({ id: chosen.id!, name: chosen.name!, section: chosen.section || undefined });
    emit({ selected: active }, globals, () => {
      console.log(pc.green(`✔ Selected course: ${active.name} (ID: ${active.id})`));
    });
  } else if (verb === 'deselect') {
    const hadSelection = clearActiveCourse();
    emit({ success: true, cleared: hadSelection }, globals, () => {
      if (hadSelection) {
        console.log(pc.green('✔ Cleared course selection.'));
      } else {
        console.log(pc.yellow('No course was currently selected.'));
      }
    });
  } else if (verb === 'current') {
    const active = getActiveCourse();
    emit({ activeCourse: active }, globals, (data) => {
      if (!data.activeCourse) {
        console.log(pc.yellow('No course currently selected. Run `classroom course select` to select one.'));
        return;
      }
      console.log(pc.green(`✔ Current Selected Course:`));
      printBlock([{
        title: data.activeCourse.name,
        id: data.activeCourse.id,
        details: [
          ...(data.activeCourse.section ? [['Section', data.activeCourse.section] as [string, string]] : []),
          ['Selected At', data.activeCourse.selectedAt]
        ]
      }]);
    });
  } else if (verb === 'enroll' || verb === 'join') {
    let courseId: string | undefined;
    let code: string | undefined;

    const arg1 = argv._[2];
    const arg2 = argv._[3];

    const parsed = parseClassroomUrl(arg1);
    if (parsed.courseId && (parsed.code || arg2)) {
      courseId = parsed.courseId;
      code = arg2 || parsed.code;
    } else if (arg1 && arg2) {
      const p1 = parseClassroomUrl(arg1);
      const p2 = parseClassroomUrl(arg2);
      courseId = p1.courseId || decodeClassroomIdentifier(arg1);
      code = p2.code || arg2;
    } else if (arg1 && !arg2) {
      if (parsed.courseId && parsed.code) {
        courseId = parsed.courseId;
        code = parsed.code;
      } else if (parsed.courseId && !parsed.code) {
        courseId = parsed.courseId;
      } else {
        code = arg1;
        courseId = argv['course'] || argv['courseId'] || getActiveCourse()?.id;
      }
    }

    if (!code) {
      code = argv['code'] || argv['cjc'];
    }
    if (!courseId) {
      courseId = argv['course'] || argv['courseId'];
    }

    if (!courseId || !code) {
      throw new AppError('MISSING_ARG', {
        name: 'MissingArg',
        human: 'Both Course ID and enrollment code are required',
        hint: 'classroom course enroll <course_id> <code> or classroom course enroll <invite_link>'
      });
    }

    note(`Enrolling into course ${courseId} with code ${code}...`, globals);
    try {
      const res = await classroom.courses.students.create({
        courseId,
        enrollmentCode: code,
        requestBody: { userId: 'me' }
      });
      const student = res.data;
      emit({ success: true, courseId, student }, globals, () => {
        console.log(pc.green(`✔ Successfully enrolled into course ${courseId}!`));
      });
    } catch (error: any) {
      if (error.code === 409 || error.status === 409 || error.message?.includes('already exists')) {
        emit({ success: true, alreadyEnrolled: true, courseId }, globals, () => {
          console.log(pc.yellow(`You are already enrolled in course ${courseId}.`));
        });
        return;
      }
      throw new AppError('ENROLLMENT_FAILED', { name: 'EnrollmentFailed', human: error.message || 'Failed to enroll in course' }, error);
    }
  } else if (verb === 'unenroll' || verb === 'leave') {
    let courseId: string;
    try {
      courseId = resolveCourseId(argv._[2]);
    } catch {
      throw new AppError('MISSING_ARG', {
        name: 'MissingArg',
        human: 'Course ID is required to unenroll',
        hint: 'classroom course unenroll <course_id> or select a course first'
      });
    }

    note(`Unenrolling from course ${courseId}...`, globals);
    try {
      await classroom.courses.students.delete({
        courseId,
        userId: 'me'
      });
      const active = getActiveCourse();
      if (active?.id === courseId) {
        clearActiveCourse();
      }
      emit({ success: true, courseId }, globals, () => {
        console.log(pc.green(`✔ Successfully unenrolled from course ${courseId}.`));
      });
    } catch (error: any) {
      throw new AppError('UNENROLL_FAILED', { name: 'UnenrollFailed', human: error.message || 'Failed to unenroll from course' }, error);
    }
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown course verb: ${verb}` });
  }
}
