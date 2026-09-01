import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';

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
      if (data.pendingTasks.length === 0) { console.log('No pending tasks!'); return; }
      console.log('Pending Tasks:');
      for (const t of data.pendingTasks) {
        console.log(`- [${t.course}] ${t.courseWork.title} (Link: ${t.courseWork.alternateLink})`);
      }
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
      if (data.dueSoonTasks.length === 0) { console.log('No tasks due in the next 7 days!'); return; }
      console.log('Tasks Due Soon:');
      for (const t of data.dueSoonTasks) {
        const tDate = parseDueDate(t.courseWork);
        const timeLeft = formatTimeLeft(tDate, now);
        const pad = (n: number) => n.toString().padStart(2, '0');
        const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
        console.log(`- [${t.course}] ${t.courseWork.title} (Due: ${localDateStr} | Time left: ${timeLeft})`);
      }
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
        if (data.coursework.length === 0) { console.log('No coursework found.'); return; }
        for (const cw of data.coursework) {
          let dueStr = 'No due date';
          if (cw.dueDate) {
            const tDate = parseDueDate(cw);
            const pad = (n: number) => n.toString().padStart(2, '0');
            const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
            dueStr = `Due: ${localDateStr} | Time left: ${formatTimeLeft(tDate, now)}`;
          }
          console.log(`- [${cw.state}] ${cw.title} (${dueStr})`);
          if (cw.materials) {
            for (const att of cw.materials) {
              if (att.driveFile?.driveFile) {
                console.log(`    📄 File: ${att.driveFile.driveFile.title} (ID: ${att.driveFile.driveFile.id})`);
              } else if (att.link) {
                console.log(`    🔗 Link: ${att.link.title || att.link.url}`);
              } else if (att.youtubeVideo) {
                console.log(`    ▶️ YouTube: ${att.youtubeVideo.title} (${att.youtubeVideo.alternateLink})`);
              }
            }
          }
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
      if (data.topics.length === 0) { console.log('No topics found.'); return; }
      for (const t of data.topics) console.log(`- ${t.name} (${t.topicId})`);
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
      if (data.materials.length === 0) { console.log('No materials found.'); return; }
      for (const m of data.materials) {
        console.log(`- [${m.state}] ${m.title} (${m.id})`);
        if (m.materials) {
          for (const att of m.materials) {
            if (att.driveFile?.driveFile) {
              console.log(`    📄 File: ${att.driveFile.driveFile.title} (ID: ${att.driveFile.driveFile.id})`);
            } else if (att.link) {
              console.log(`    🔗 Link: ${att.link.title || att.link.url}`);
            } else if (att.youtubeVideo) {
              console.log(`    ▶️ YouTube: ${att.youtubeVideo.title} (${att.youtubeVideo.alternateLink})`);
            }
          }
        }
      }
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
      if (data.submissions.length === 0) { console.log('No submissions found.'); return; }
      for (const s of data.submissions) console.log(`- Student ${s.userId} | State: ${s.state} | Grade: ${s.draftGrade || s.assignedGrade || 'None'}`);
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
