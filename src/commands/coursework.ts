import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, BlockItem } from '../ui.js';

function parseDueDate(cw: any) {
  const d = cw.dueDate;
  const t = cw.dueTime || { hours: 23, minutes: 59, seconds: 59 };
  return new Date(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1, t.hours || 0, t.minutes || 0, t.seconds || 0));
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

async function getPendingTasks(classroom: any, globals: any) {
  const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'] });
  const courses = coursesRes.data.courses || [];
  const pendingTasks: {course: string, courseId: string, submission: any, courseWork: any}[] = [];
  
  for (const course of courses) {
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
    }
  }
  return pendingTasks;
}

export async function handleTasksPending(globals: GlobalFlags, argv: any) {
  const classroom = await getClient();
  try {
    const pendingTasks = await getPendingTasks(classroom, globals);
    emit({ pendingTasks }, globals, (data) => {
      if (data.pendingTasks.length === 0) { 
        console.log(pc.green('✔ No pending tasks!')); 
        return; 
      }
      printBlock(data.pendingTasks.map((t: any) => {
        const item: BlockItem = {
          title: t.courseWork.title,
          id: t.courseWork.id,
          details: [['Course', t.course]]
        };
        if (t.courseWork.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(t.courseWork.alternateLink))]);
        return item;
      }));
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
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
      if (data.dueSoonTasks.length === 0) { 
        console.log(pc.green('✔ No tasks due in the next 7 days!')); 
        return; 
      }
      
      printBlock(data.dueSoonTasks.map((t: any) => {
        const tDate = parseDueDate(t.courseWork);
        const timeLeft = formatTimeLeft(tDate, now);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
        
        const item: BlockItem = {
          title: t.courseWork.title,
          id: t.courseWork.id,
          details: [
            ['Course', t.course],
            ['Due', pc.yellow(`${localDateStr} (${timeLeft})`)]
          ]
        };
        if (t.courseWork.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(t.courseWork.alternateLink))]);
        return item;
      }));
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
}

export async function handleCourseWork(globals: GlobalFlags, argv: any) {
  const verb = argv._[1];
  const id = argv._[2];
  if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
  const classroom = await getClient();
  
  if (verb === 'list') {
    note(`Fetching coursework for course ${id}...`, globals);
    try {
      const res = await classroom.courses.courseWork.list({ courseId: id });
      const coursework = res.data.courseWork || [];
      const now = new Date();
      emit({ coursework }, globals, (data) => {
        if (data.coursework.length === 0) { 
          console.log(pc.yellow('No coursework found.')); 
          return; 
        }
        
        printBlock(data.coursework.map((cw: any) => {
          let dueStr = 'No due date';
          if (cw.dueDate) {
            const tDate = parseDueDate(cw);
            const pad = (n: number) => n.toString().padStart(2, '0');
            const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
            dueStr = `${localDateStr} (${formatTimeLeft(tDate, now)})`;
          }
          
          const stateColor = cw.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(cw.state || 'UNKNOWN');
          
          const item: BlockItem = {
            title: cw.title,
            id: cw.id,
            details: [
              ['State', stateColor],
              ['Due', cw.dueDate ? pc.yellow(dueStr) : dueStr]
            ]
          };
          if (cw.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(cw.alternateLink))]);

          if (cw.materials && cw.materials.length > 0) {
            item.attachments = cw.materials.map((att: any) => {
              if (att.driveFile?.driveFile) {
                return `📄 ${att.driveFile.driveFile.title} ${pc.dim(`(ID: ${att.driveFile.driveFile.id})`)}`;
              } else if (att.link) {
                return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
              } else if (att.youtubeVideo) {
                return `▶️ ${att.youtubeVideo.title} ${pc.dim(`(${att.youtubeVideo.alternateLink})`)}`;
              }
              return 'Unknown Attachment';
            });
          }
          return item;
        }));
      });
    } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
  } else if (verb === 'get') {
    const workId = argv._[3];
    if (!workId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Work ID is required', hint: 'classroom work get <course_id> <work_id>' });
    
    note(`Fetching coursework ${workId}...`, globals);
    try {
      const [cwRes, subRes] = await Promise.all([
        classroom.courses.courseWork.get({ courseId: id, id: workId }),
        classroom.courses.courseWork.studentSubmissions.list({ courseId: id, courseWorkId: workId, userId: 'me' }).catch(() => ({ data: { studentSubmissions: [] } }))
      ]);
      
      const cw = cwRes.data;
      const submission = subRes.data.studentSubmissions?.[0];
      const now = new Date();
      
      emit({ coursework: cw, submission }, globals, (data) => {
        console.log(pc.green(`\n✔ Assignment Details:`));
        
        let dueStr = 'No due date';
        if (data.coursework.dueDate) {
          const tDate = parseDueDate(data.coursework);
          const pad = (n: number) => n.toString().padStart(2, '0');
          const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
          dueStr = `${localDateStr} (${formatTimeLeft(tDate, now)})`;
        }
        
        const stateColor = data.coursework.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(data.coursework.state || 'UNKNOWN');
        
        const item: BlockItem = {
          title: data.coursework.title,
          id: data.coursework.id,
          details: [
            ['State', stateColor],
            ['Due', data.coursework.dueDate ? pc.yellow(dueStr) : dueStr]
          ]
        };
        
        if (data.coursework.description) item.details!.push(['Description', data.coursework.description.split('\n')[0] + (data.coursework.description.includes('\n') ? '...' : '')]);
        if (data.coursework.maxPoints) item.details!.push(['Max Points', String(data.coursework.maxPoints)]);
        if (data.coursework.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(data.coursework.alternateLink))]);
        
        if (data.coursework.materials && data.coursework.materials.length > 0) {
          item.attachments = data.coursework.materials.map((att: any) => {
            if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title} ${pc.dim(`(ID: ${att.driveFile.driveFile.id})`)}`;
            if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
            if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title} ${pc.dim(`(${att.youtubeVideo.alternateLink})`)}`;
            return 'Unknown Attachment';
          });
        }
        printBlock([item]);
        
        if (data.submission) {
          console.log(pc.green(`✔ Your Submission:`));
          const subStateColor = data.submission.state === 'TURNED_IN' ? pc.green('TURNED IN') : 
                                data.submission.state === 'RETURNED' ? pc.blue('RETURNED') : 
                                pc.yellow(data.submission.state || 'UNKNOWN');
          const grade = data.submission.draftGrade !== undefined ? data.submission.draftGrade : (data.submission.assignedGrade !== undefined ? data.submission.assignedGrade : 'None');
          
          const subItem: BlockItem = {
            title: `Student ${data.submission.userId}`,
            id: data.submission.id,
            details: [
              ['State', subStateColor],
              ['Grade', String(grade)]
            ]
          };
          
          if (data.submission.assignmentSubmission?.attachments) {
            subItem.attachments = data.submission.assignmentSubmission.attachments.map((att: any) => {
              if (att.driveFile) return `📄 ${att.driveFile.title} ${pc.dim(`(ID: ${att.driveFile.id})`)}`;
              if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
              if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title}`;
              return 'Unknown Attachment';
            });
          } else {
            subItem.attachments = [pc.dim('No files attached.')];
          }
          
          printBlock([subItem]);
        }
      });
    } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
  } else if (verb === 'create') {
    const title = argv['title'];
    if (!title) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--title is required' });
    
    const requestBody: any = { title, state: 'PUBLISHED', workType: 'ASSIGNMENT' };
    
    // Default to 100 points
    requestBody.maxPoints = 100;

    const res = await classroom.courses.courseWork.create({ courseId: id, requestBody });
    emit({ coursework: res.data }, globals, (data) => console.log(`Created assignment: ${data.coursework.title} (ID: ${data.coursework.id})`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown coursework verb: ${verb}` });
  }
}

export async function handleTopic(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
  const classroom = await getClient();

  if (verb === 'list') {
    const res = await classroom.courses.topics.list({ courseId });
    const topics = res.data.topic || [];
      emit({ topics }, globals, (data) => {
        if (data.topics.length === 0) {
          console.log(pc.yellow('No topics found.'));
          return;
        }
        printBlock(data.topics.map((t: any) => ({
          title: t.name,
          id: t.topicId,
          details: [['Updated', t.updateTime]]
        })));
      });
  } else if (verb === 'get') {
    const topicId = argv._[3];
    if (!topicId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Topic ID is required', hint: 'classroom topic get <course_id> <topic_id>' });
    
    note(`Fetching topic ${topicId}...`, globals);
    const [topicRes, cwRes, matRes] = await Promise.all([
      classroom.courses.topics.get({ courseId, id: topicId }),
      classroom.courses.courseWork.list({ courseId }),
      classroom.courses.courseWorkMaterials.list({ courseId })
    ]);
    
    const topic = topicRes.data;
    const coursework = (cwRes.data.courseWork || []).filter(cw => cw.topicId === topicId);
    const materials = (matRes.data.courseWorkMaterial || []).filter(m => m.topicId === topicId);
    
    emit({ topic, coursework, materials }, globals, (data) => {
      console.log(pc.green(`\n✔ Topic:`));
      printBlock([{
        title: data.topic.name,
        id: data.topic.topicId,
        details: [['Updated', data.topic.updateTime]]
      }]);
      
      if (data.materials.length > 0) {
        console.log(pc.green(`\n✔ Materials under this topic:`));
        printBlock(data.materials.map((m: any) => {
          const item: BlockItem = {
            title: m.title,
            id: m.id,
            details: [['State', m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN')]]
          };
          if (m.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
          
          if (m.materials && m.materials.length > 0) {
            item.attachments = m.materials.map((att: any) => {
              if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title}`;
              if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
              if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title}`;
              return 'Unknown Attachment';
            });
          }
          return item;
        }));
      } else {
        console.log(pc.dim('\nNo materials under this topic.'));
      }
      
      if (data.coursework.length > 0) {
        console.log(pc.green(`\n✔ Assignments under this topic:`));
        printBlock(data.coursework.map((cw: any) => {
          const item: BlockItem = {
            title: cw.title,
            id: cw.id,
            details: [['State', cw.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(cw.state || 'UNKNOWN')]]
          };
          if (cw.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(cw.alternateLink))]);
          
          if (cw.materials && cw.materials.length > 0) {
            item.attachments = cw.materials.map((att: any) => {
              if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title}`;
              if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
              if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title}`;
              return 'Unknown Attachment';
            });
          }
          return item;
        }));
      } else {
        console.log(pc.dim('\nNo assignments under this topic.'));
      }
    });
  } else if (verb === 'create') {
    const name = argv['name'];
    if (!name) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--name is required' });
    const res = await classroom.courses.topics.create({ courseId, requestBody: { name } });
    emit({ topic: res.data }, globals, (data) => console.log(`Created topic: ${data.topic.name}`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
  }
}

export async function handleMaterial(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
  const classroom = await getClient();

  if (verb === 'list') {
    const res = await classroom.courses.courseWorkMaterials.list({ courseId });
    const materials = res.data.courseWorkMaterial || [];
      emit({ materials }, globals, (data) => {
        if (data.materials.length === 0) { 
          console.log(pc.yellow('No materials found.')); 
          return; 
        }
        printBlock(data.materials.map((m: any) => {
          const stateColor = m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN');
          const item: BlockItem = {
            title: m.title,
            id: m.id,
            details: [['State', stateColor]]
          };
          if (m.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
          
          if (m.materials && m.materials.length > 0) {
            item.attachments = m.materials.map((att: any) => {
              if (att.driveFile?.driveFile) {
                return `📄 ${att.driveFile.driveFile.title} ${pc.dim(`(ID: ${att.driveFile.driveFile.id})`)}`;
              } else if (att.link) {
                return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
              } else if (att.youtubeVideo) {
                return `▶️ ${att.youtubeVideo.title} ${pc.dim(`(${att.youtubeVideo.alternateLink})`)}`;
              }
              return 'Unknown Attachment';
            });
          }
          return item;
        }));
      });
  } else if (verb === 'get') {
    const materialId = argv._[3];
    if (!materialId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Material ID is required', hint: 'classroom material get <course_id> <material_id>' });
    
    note(`Fetching material ${materialId}...`, globals);
    const res = await classroom.courses.courseWorkMaterials.get({ courseId, id: materialId });
    emit({ material: res.data }, globals, (data) => {
      console.log(pc.green(`\n✔ Material Details:`));
      const m = data.material;
      const stateColor = m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN');
      const item: BlockItem = {
        title: m.title,
        id: m.id,
        details: [['State', stateColor]]
      };
      if (m.description) item.details!.push(['Description', m.description.split('\n')[0] + (m.description.includes('\n') ? '...' : '')]);
      if (m.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
      
      if (m.materials && m.materials.length > 0) {
        item.attachments = m.materials.map((att: any) => {
          if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title} ${pc.dim(`(ID: ${att.driveFile.driveFile.id})`)}`;
          if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
          if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title} ${pc.dim(`(${att.youtubeVideo.alternateLink})`)}`;
          return 'Unknown Attachment';
        });
      }
      printBlock([item]);
    });
  } else if (verb === 'create') {
    const title = argv['title'];
    const topicId = argv['topic'];
    const links = Array.isArray(argv['link']) ? argv['link'] : (argv['link'] ? [argv['link']] : []);
    const files = Array.isArray(argv['file']) ? argv['file'] : (argv['file'] ? [argv['file']] : []);
    
    if (!title) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--title is required' });
    
    const requestBody: any = { title, state: 'PUBLISHED' };
    if (topicId) requestBody.topicId = topicId;
    
    const materialsArr: any[] = [];
    
    for (const link of links) {
      materialsArr.push({ link: { url: link } });
    }
    
    if (files.length > 0) {
      // Need to dynamically import to avoid circular dep if any, or just import at top.
      const { uploadToDrive } = await import('./drive.js');
      for (const file of files) {
        note(`Uploading ${file} to Google Drive...`, globals);
        const fileId = await uploadToDrive(file, globals);
        materialsArr.push({ driveFile: { driveFile: { id: fileId }, shareMode: 'VIEW' } });
      }
    }
    
    if (materialsArr.length > 0) {
      requestBody.materials = materialsArr;
    }

    const res = await classroom.courses.courseWorkMaterials.create({ courseId, requestBody });
    emit({ material: res.data }, globals, (data) => console.log(`Created material: ${data.material.title}`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
  }
}

export async function handleSubmissions(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  const courseWorkId = argv._[3];
  if (!courseId || !courseWorkId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID and CourseWork ID are required' });
  const classroom = await getClient();

  if (verb === 'list') {
    const res = await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId });
    const submissions = res.data.studentSubmissions || [];
    emit({ submissions }, globals, (data) => {
      if (data.submissions.length === 0) { 
        console.log(pc.yellow('No submissions found.')); 
        return; 
      }
      printBlock(data.submissions.map((s: any) => {
        const stateColor = s.state === 'TURNED_IN' ? pc.green('TURNED IN') : 
                           s.state === 'RETURNED' ? pc.blue('RETURNED') : 
                           pc.yellow(s.state || 'UNKNOWN');
        const grade = s.draftGrade !== undefined ? s.draftGrade : (s.assignedGrade !== undefined ? s.assignedGrade : 'None');
        
        const item: BlockItem = {
          title: `Student ${s.userId}`,
          id: s.id,
          details: [
            ['State', stateColor],
            ['Grade', String(grade)]
          ]
        };
        if (s.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(s.alternateLink))]);
        return item;
      }));
    });
  } else if (verb === 'grade') {
    const studentId = argv._[4];
    const score = argv['score'];
    if (!studentId || score === undefined) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Student ID and --score are required' });
    
    // Need submission ID for patching grade
    const subRes = await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId, userId: studentId });
    const submission = subRes.data.studentSubmissions?.[0];
    if (!submission) throw new AppError('NOT_FOUND', { name: 'NotFound', human: 'Submission not found for student' });

    const res = await classroom.courses.courseWork.studentSubmissions.patch({
      courseId, courseWorkId, id: submission.id!, updateMask: 'draftGrade,assignedGrade',
      requestBody: { draftGrade: Number(score), assignedGrade: Number(score) }
    });
    emit({ submission: res.data }, globals, () => console.log(`Graded student ${studentId} with score ${score}`));
  } else if (verb === 'return') {
    const studentId = argv._[4];
    if (!studentId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Student ID is required' });
    const subRes = await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId, userId: studentId });
    const submission = subRes.data.studentSubmissions?.[0];
    if (!submission) throw new AppError('NOT_FOUND', { name: 'NotFound', human: 'Submission not found' });

    await classroom.courses.courseWork.studentSubmissions.return({ courseId, courseWorkId, id: submission.id! });
    emit({ success: true }, globals, () => console.log(`Returned submission to student ${studentId}`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
  }
}

export async function handleStudentAction(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  const courseWorkId = argv._[3];
  if (!courseId || !courseWorkId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID and CourseWork ID are required' });
  const classroom = await getClient();

  // Find the student's submission id
  const subRes = await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId, userId: 'me' });
  const submission = subRes.data.studentSubmissions?.[0];
  if (!submission) throw new AppError('NOT_FOUND', { name: 'NotFound', human: 'Submission not found for you' });

  if (verb === 'submit') {
    const links = Array.isArray(argv['link']) ? argv['link'] : (argv['link'] ? [argv['link']] : []);
    const files = Array.isArray(argv['file']) ? argv['file'] : (argv['file'] ? [argv['file']] : []);
    
    if (links.length === 0 && files.length === 0) {
      throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'At least one --link or --file is required' });
    }

    const addAttachments: any[] = [];
    
    for (const link of links) {
      addAttachments.push({ link: { url: link } });
    }
    
    if (files.length > 0) {
      const { uploadToDrive } = await import('./drive.js');
      for (const file of files) {
        note(`Uploading ${file} to Google Drive...`, globals);
        const fileId = await uploadToDrive(file, globals);
        addAttachments.push({ driveFile: { id: fileId } });
      }
    }

    await classroom.courses.courseWork.studentSubmissions.modifyAttachments({
      courseId, courseWorkId, id: submission.id!,
      requestBody: { addAttachments }
    });
    
    emit({ success: true }, globals, () => console.log(`Successfully attached ${addAttachments.length} items to submission.`));
  } else if (verb === 'turn-in') {
    await classroom.courses.courseWork.studentSubmissions.turnIn({ courseId, courseWorkId, id: submission.id! });
    emit({ success: true }, globals, () => console.log(`Turned in assignment.`));
  } else if (verb === 'unsubmit') {
    await classroom.courses.courseWork.studentSubmissions.reclaim({ courseId, courseWorkId, id: submission.id! });
    emit({ success: true }, globals, () => console.log(`Unsubmitted assignment.`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
  }
}
