import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { resolveDateRange, applyDateFilter } from '../../cli/foundation/date-filter.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, BlockItem } from '../ui.js';
import { extractDriveFileIds, fetchDriveFileSizes, formatAttachments, extractAttachedFiles } from '../attachments.js';
import { parseDueDate, formatTimeLeft } from '../date-utils.js';
import { resolveCourseId } from '../context.js';

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

function formatTaskBlock(t: any, now: Date, shouldFetchRelated: boolean, isFull: boolean, sizeMap: Map<string, string>): BlockItem {
  const item: BlockItem = {
    title: t.courseWork.title,
    id: t.courseWork.id,
    details: [
      ['Course', t.course]
    ]
  };

  if (t.courseWork.dueDate) {
    const tDate = parseDueDate(t.courseWork);
    const timeLeft = formatTimeLeft(tDate, now);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
    item.details!.push(['Due', pc.yellow(`${localDateStr} (${timeLeft})`)]);
  }

  if (isFull) {
    item.details!.push(['Course ID', t.courseId]);
    if (t.courseWork.workType) item.details!.push(['Type', t.courseWork.workType]);
    if (t.courseWork.topicId) item.details!.push(['Topic ID', t.courseWork.topicId]);
    if (t.courseWork.creatorUserId) item.details!.push(['Creator ID', t.courseWork.creatorUserId]);
    if (t.courseWork.state) item.details!.push(['State', t.courseWork.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(t.courseWork.state)]);
    if (t.courseWork.maxPoints !== undefined) item.details!.push(['Max Points', String(t.courseWork.maxPoints)]);
    if (t.courseWork.creationTime) item.details!.push(['Created', t.courseWork.creationTime]);
    if (t.courseWork.updateTime) item.details!.push(['Updated', t.courseWork.updateTime]);
    if (t.courseWork.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(t.courseWork.alternateLink))]);
    if (t.courseWork.description) item.details!.push(['Description', t.courseWork.description]);
  }

  if (shouldFetchRelated) {
    const subStateColor = t.submission.state === 'TURNED_IN' ? pc.green('TURNED IN') : 
                          t.submission.state === 'RETURNED' ? pc.blue('RETURNED') : 
                          pc.yellow(t.submission.state || 'UNKNOWN');
    const subStr = isFull && t.submission.id ? `${subStateColor} ${pc.dim(`(ID: ${t.submission.id})`)}` : subStateColor;
    item.details!.push(['Submission', subStr]);
    
    if (t.submission.assignedGrade !== undefined || t.submission.draftGrade !== undefined) {
      const grade = t.submission.assignedGrade !== undefined ? t.submission.assignedGrade : t.submission.draftGrade;
      item.details!.push(['Grade', String(grade)]);
    }

    const taskAtts = formatAttachments(t.courseWork.materials, sizeMap) || [];
    const subAtts = formatAttachments(t.submission.assignmentSubmission?.attachments, sizeMap) || [];
    const allAtts = [
      ...taskAtts,
      ...subAtts.map(a => `${a} ${pc.dim('(Submitted)')}`)
    ];
    if (allAtts.length > 0) {
      item.attachments = allAtts;
    }
  }

  return item;
}

export async function handleTasksPending(globals: GlobalFlags, argv: any) {
  const classroom = await getClient();
  const shouldFetchRelated = argv.related || globals.json;
  const isFull = !!argv.full;
  
  try {
    const pendingTasks = await getPendingTasks(classroom, globals);
    const now = new Date();
    
    let sizeMap = new Map<string, string>();
    if (shouldFetchRelated) {
      const allMaterials = pendingTasks.flatMap(t => [
        ...(t.courseWork.materials || []),
        ...(t.submission.assignmentSubmission?.attachments || [])
      ]);
      const fileIds = extractDriveFileIds(allMaterials);
      if (fileIds.length > 0) sizeMap = await fetchDriveFileSizes(fileIds);
    }

    emit({ pendingTasks }, globals, (data) => {
      if (data.pendingTasks.length === 0) { 
        console.log(pc.green('✔ No pending tasks!')); 
        return; 
      }
      printBlock(data.pendingTasks.map((t: any) => formatTaskBlock(t, now, shouldFetchRelated, isFull, sizeMap)));
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
}

export async function handleTasksDueSoon(globals: GlobalFlags, argv: any) {
  const classroom = await getClient();
  const shouldFetchRelated = argv.related || globals.json;
  const isFull = !!argv.full;

  try {
    const pendingTasks = await getPendingTasks(classroom, globals);
    const now = new Date();
    const hasRangeFlag = !!globals.from || !!globals.last;
    const range = resolveDateRange(globals.from, globals.last) ?? {
      from: now,
      to: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    };
    
    const dueSoonTasks = pendingTasks.filter(t => {
      if (!t.courseWork.dueDate) return false;
      const tDate = parseDueDate(t.courseWork);
      const fromMs = range.from!.getTime();
      const toMs = range.to ? range.to.getTime() : Infinity;
      return tDate.getTime() >= fromMs && tDate.getTime() <= toMs;
    });
    
    dueSoonTasks.sort((a, b) => {
      return parseDueDate(a.courseWork).getTime() - parseDueDate(b.courseWork).getTime();
    });

    let sizeMap = new Map<string, string>();
    if (shouldFetchRelated) {
      const allMaterials = dueSoonTasks.flatMap(t => [
        ...(t.courseWork.materials || []),
        ...(t.submission.assignmentSubmission?.attachments || [])
      ]);
      const fileIds = extractDriveFileIds(allMaterials);
      if (fileIds.length > 0) sizeMap = await fetchDriveFileSizes(fileIds);
    }

    emit({ dueSoonTasks }, globals, (data) => {
      if (data.dueSoonTasks.length === 0) {
        const msg = hasRangeFlag
          ? '✔ No tasks due in the specified window!'
          : '✔ No tasks due in the next 7 days!';
        console.log(pc.green(msg));
        return;
      }

      printBlock(data.dueSoonTasks.map((t: any) => formatTaskBlock(t, now, shouldFetchRelated, isFull, sizeMap)));
    });
  } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
}

export async function handleCourseWork(globals: GlobalFlags, argv: any) {
  const verb = argv._[1];
  const classroom = await getClient();
  
  if (verb === 'list') {
    const id = resolveCourseId(argv._[2]);
    note(`Fetching coursework for course ${id}...`, globals);
    try {
      const res = await classroom.courses.courseWork.list({ courseId: id });
      const raw = res.data.courseWork || [];
      const range = resolveDateRange(globals.from, globals.last);
      const coursework = applyDateFilter(raw, range, (cw: any) => cw.dueDate ? parseDueDate(cw) : cw.updateTime);
      const now = new Date();
      
      const shouldFetchRelated = argv.related || globals.json;
      const isFull = !!argv.full;
      
      const fileIds = shouldFetchRelated ? extractDriveFileIds(coursework) : [];
      const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
      
      const enrichedCoursework = coursework.map((cw: any) => ({
        ...cw,
        ...(shouldFetchRelated ? { files: extractAttachedFiles(cw.materials, sizeMap) } : {})
      }));

      emit({ coursework: enrichedCoursework }, globals, (data) => {
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
          if (isFull) {
            if (cw.maxPoints !== undefined) item.details!.push(['Max Points', String(cw.maxPoints)]);
            if (cw.description) item.details!.push(['Description', cw.description.split('\n')[0]]);
            if (cw.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(cw.alternateLink))]);
          }

          if (shouldFetchRelated) {
            const atts = formatAttachments(cw.materials, sizeMap);
            if (atts) item.attachments = atts;
          }
          return item;
        }));
      });
    } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
  } else if (verb === 'get') {
    let courseId: string;
    let workId: string;
    if (argv._[3]) {
      courseId = argv._[2];
      workId = argv._[3];
    } else {
      courseId = resolveCourseId(undefined);
      workId = argv._[2];
    }
    if (!workId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Work ID is required', hint: 'classroom work get <work_id>' });
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(shouldFetchRelated ? `Fetching coursework ${workId} and its submissions...` : `Fetching coursework ${workId}...`, globals);
    try {
      const [cwRes, subRes] = await Promise.all([
        classroom.courses.courseWork.get({ courseId, id: workId }),
        shouldFetchRelated ? classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId: workId, userId: 'me' }).catch(() => ({ data: { studentSubmissions: [] } })) : Promise.resolve({ data: { studentSubmissions: [] } })
      ]);
      
      const cw = cwRes.data;
      const submission = subRes.data.studentSubmissions?.[0];
      const now = new Date();
      
      const fileIds = shouldFetchRelated ? extractDriveFileIds([cw, submission]) : [];
      const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
      
      emit({ coursework: cw, submission }, globals, (data) => {
        if (shouldFetchRelated) console.log(pc.green(`\n✔ Assignment Details:`));
        
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
            ['Due', data.coursework.dueDate ? pc.yellow(dueStr) : dueStr],
            ...(data.coursework.maxPoints !== undefined ? [['Max Points', String(data.coursework.maxPoints)] as [string, string]] : []),
            ...(data.coursework.creationTime ? [['Created', data.coursework.creationTime] as [string, string]] : []),
            ...(data.coursework.updateTime ? [['Updated', data.coursework.updateTime] as [string, string]] : []),
            ...(data.coursework.alternateLink ? [['Link', pc.blue(pc.underline(data.coursework.alternateLink))] as [string, string]] : []),
            ...(data.coursework.description ? [['Description', data.coursework.description] as [string, string]] : [])
          ]
        };
        
        if (isFull) {
          if (data.coursework.courseId) item.details!.push(['Course ID', data.coursework.courseId]);
          if (data.coursework.workType) item.details!.push(['Type', data.coursework.workType]);
          if (data.coursework.topicId) item.details!.push(['Topic ID', data.coursework.topicId]);
          if (data.coursework.creatorUserId) item.details!.push(['Creator ID', data.coursework.creatorUserId]);
          if (data.coursework.submissionModificationMode) item.details!.push(['Submission Mode', data.coursework.submissionModificationMode]);
          if (data.coursework.assigneeMode) item.details!.push(['Assignee Mode', data.coursework.assigneeMode]);
          if (data.coursework.scheduledTime) item.details!.push(['Scheduled', data.coursework.scheduledTime]);
        }

        if (shouldFetchRelated) {
          const atts = formatAttachments(data.coursework.materials, sizeMap);
          if (atts) item.attachments = atts;
        }
        
        printBlock([item]);
        
        if (shouldFetchRelated && data.submission) {
          console.log(pc.green(`✔ Your Submission:`));
          const subStateColor = data.submission.state === 'TURNED_IN' ? pc.green('TURNED IN') : 
                                data.submission.state === 'RETURNED' ? pc.blue('RETURNED') : 
                                pc.yellow(data.submission.state || 'UNKNOWN');
          const subItem: BlockItem = {
            title: `Student ${data.submission.userId}`,
            id: data.submission.id,
            details: [
              ['State', subStateColor]
            ]
          };

          const grade = data.submission.draftGrade !== undefined ? data.submission.draftGrade : (data.submission.assignedGrade !== undefined ? data.submission.assignedGrade : undefined);
          if (grade !== undefined) {
            subItem.details!.push(['Grade', String(grade)]);
          }

          if (isFull) {
            if (data.submission.courseId) subItem.details!.push(['Course ID', data.submission.courseId]);
            if (data.submission.courseWorkType) subItem.details!.push(['Work Type', data.submission.courseWorkType]);
            if (data.submission.creationTime) subItem.details!.push(['Created', data.submission.creationTime]);
            if (data.submission.updateTime) subItem.details!.push(['Updated', data.submission.updateTime]);
            if (data.submission.late !== undefined) subItem.details!.push(['Late', data.submission.late ? pc.red('Yes') : pc.green('No')]);
            if (data.submission.alternateLink) subItem.details!.push(['Link', pc.blue(pc.underline(data.submission.alternateLink))]);
          }
          
          const subAtts = formatAttachments(data.submission.assignmentSubmission?.attachments, sizeMap);
          if (subAtts && subAtts.length > 0) {
            subItem.attachments = subAtts;
          } else {
            subItem.attachments = [pc.dim('No files attached.')];
          }
          
          printBlock([subItem]);
        }
      });
    } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
  } else if (verb === 'create') {
    const id = resolveCourseId(argv._[2]);
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
  const classroom = await getClient();

  if (verb === 'list') {
    const courseId = resolveCourseId(argv._[2]);
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;

    note(shouldFetchRelated ? `Fetching topics and related resources for course ${courseId}...` : `Fetching topics for course ${courseId}...`, globals);
    const [res, cwRes, matRes] = await Promise.all([
      classroom.courses.topics.list({ courseId }),
      shouldFetchRelated ? classroom.courses.courseWork.list({ courseId }).catch(() => ({ data: { courseWork: [] } })) : Promise.resolve({ data: { courseWork: [] } }),
      shouldFetchRelated ? classroom.courses.courseWorkMaterials.list({ courseId }).catch(() => ({ data: { courseWorkMaterial: [] } })) : Promise.resolve({ data: { courseWorkMaterial: [] } })
    ]);

    const raw = res.data.topic || [];
    const allCw = cwRes.data.courseWork || [];
    const allMat = matRes.data.courseWorkMaterial || [];

    const range = resolveDateRange(globals.from, globals.last);
    const topics = applyDateFilter(raw, range, (t: any) => t.updateTime);

    const fileIds = shouldFetchRelated ? extractDriveFileIds([...allCw, ...allMat]) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();

    const enrichedTopics = topics.map((t: any) => {
      if (!shouldFetchRelated) return t;
      const topicMat = allMat.filter((m: any) => m.topicId === t.topicId).map((m: any) => ({
        ...m,
        files: extractAttachedFiles(m.materials, sizeMap)
      }));
      const topicCw = allCw.filter((cw: any) => cw.topicId === t.topicId).map((cw: any) => ({
        ...cw,
        files: extractAttachedFiles(cw.materials, sizeMap)
      }));
      return {
        ...t,
        materials: topicMat,
        coursework: topicCw
      };
    });

    emit({ topics: enrichedTopics }, globals, (data) => {
      if (data.topics.length === 0) {
        console.log(pc.yellow('No topics found.'));
        return;
      }
      printBlock(data.topics.map((t: any) => {
        const item: BlockItem = {
          title: t.name,
          id: t.topicId
        };
        if (isFull) {
          item.details = [['Updated', t.updateTime]];
        }
        if (shouldFetchRelated) {
          const relatedLines: string[] = [];
          if (t.materials && t.materials.length > 0) {
            for (const m of t.materials) {
              relatedLines.push(`📁 Material: ${m.title}`);
              const atts = formatAttachments(m.materials, sizeMap);
              if (atts) {
                for (const att of atts) relatedLines.push(`   ${att}`);
              }
            }
          }
          if (t.coursework && t.coursework.length > 0) {
            for (const cw of t.coursework) {
              relatedLines.push(`📝 Assignment: ${cw.title}`);
              const atts = formatAttachments(cw.materials, sizeMap);
              if (atts) {
                for (const att of atts) relatedLines.push(`   ${att}`);
              }
            }
          }
          if (relatedLines.length > 0) {
            item.attachments = relatedLines;
          }
        }
        return item;
      }));
    });
  } else if (verb === 'get') {
    let courseId: string;
    let topicId: string;
    if (argv._[3]) {
      courseId = argv._[2];
      topicId = argv._[3];
    } else {
      courseId = resolveCourseId(undefined);
      topicId = argv._[2];
    }
    if (!topicId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Topic ID is required', hint: 'classroom topic get <topic_id>' });
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(shouldFetchRelated ? `Fetching topic ${topicId} and its materials...` : `Fetching topic ${topicId}...`, globals);
    const [topicRes, cwRes, matRes] = await Promise.all([
      classroom.courses.topics.get({ courseId, id: topicId }),
      shouldFetchRelated ? classroom.courses.courseWork.list({ courseId }).catch(() => ({ data: { courseWork: [] } })) : Promise.resolve({ data: { courseWork: [] } }),
      shouldFetchRelated ? classroom.courses.courseWorkMaterials.list({ courseId }).catch(() => ({ data: { courseWorkMaterial: [] } })) : Promise.resolve({ data: { courseWorkMaterial: [] } })
    ]);
    
    const topic = topicRes.data;
    const rawCw = (cwRes.data.courseWork || []).filter(cw => cw.topicId === topicId);
    const rawMat = (matRes.data.courseWorkMaterial || []).filter(m => m.topicId === topicId);
    const range = resolveDateRange(globals.from, globals.last);
    const coursework = applyDateFilter(rawCw, range, (cw: any) => cw.dueDate ? parseDueDate(cw) : cw.updateTime);
    const materials = applyDateFilter(rawMat, range, (m: any) => m.updateTime);
    
    const fileIds = shouldFetchRelated ? extractDriveFileIds([coursework, materials]) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
    const enrichedCw = coursework.map((cw: any) => ({
      ...cw,
      files: extractAttachedFiles(cw.materials, sizeMap)
    }));
    const enrichedMat = materials.map((m: any) => ({
      ...m,
      files: extractAttachedFiles(m.materials, sizeMap)
    }));

    emit({ topic, coursework: enrichedCw, materials: enrichedMat }, globals, (data) => {
      if (shouldFetchRelated) console.log(pc.green(`\n✔ Topic:`));
      const topicItem: BlockItem = { title: data.topic.name, id: data.topic.topicId };
      if (isFull) topicItem.details = [['Updated', data.topic.updateTime]];
      printBlock([topicItem]);
      
      if (shouldFetchRelated) {
        if (data.materials.length > 0) {
          console.log(pc.green(`\n✔ Materials under this topic:`));
          printBlock(data.materials.map((m: any) => {
            const item: BlockItem = { title: m.title, id: m.id };
            const atts = formatAttachments(m.materials, sizeMap);
            if (atts) item.attachments = atts;
            
            if (isFull) {
              item.details = [['State', m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN')]];
              if (m.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
            }
            return item;
          }));
        } else {
          console.log(pc.dim('\nNo materials under this topic.'));
        }
        
        if (data.coursework.length > 0) {
          console.log(pc.green(`\n✔ Assignments under this topic:`));
          printBlock(data.coursework.map((cw: any) => {
            const item: BlockItem = { title: cw.title, id: cw.id };
            const atts = formatAttachments(cw.materials, sizeMap);
            if (atts) item.attachments = atts;
            
            if (isFull) {
              item.details = [['State', cw.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(cw.state || 'UNKNOWN')]];
              if (cw.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(cw.alternateLink))]);
            }
            return item;
          }));
        } else {
          console.log(pc.dim('\nNo assignments under this topic.'));
        }
      }
    });
  } else if (verb === 'create') {
    const courseId = resolveCourseId(argv._[2]);
    const name = argv['name'];
    if (!name) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--name is required' });
    const res = await classroom.courses.topics.create({ courseId, requestBody: { name } });
    emit({ topic: res.data }, globals, (data) => console.log(`Created topic: ${data.topic.name}`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
  }
}

export async function handleMaterial(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();

  if (verb === 'list') {
    const courseId = resolveCourseId(argv._[2]);
    const res = await classroom.courses.courseWorkMaterials.list({ courseId });
    const raw = res.data.courseWorkMaterial || [];
    const range = resolveDateRange(globals.from, globals.last);
    const materials = applyDateFilter(raw, range, (m: any) => m.updateTime);
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    const fileIds = shouldFetchRelated ? extractDriveFileIds(materials) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    const enrichedMaterials = materials.map((m: any) => ({
      ...m,
      ...(shouldFetchRelated ? { files: extractAttachedFiles(m.materials, sizeMap) } : {})
    }));

    emit({ materials: enrichedMaterials }, globals, (data) => {
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
        if (isFull && m.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
        
        if (shouldFetchRelated) {
          const atts = formatAttachments(m.materials, sizeMap);
          if (atts) item.attachments = atts;
        }
        return item;
      }));
    });
  } else if (verb === 'get') {
    let courseId: string;
    let materialId: string;
    if (argv._[3]) {
      courseId = argv._[2];
      materialId = argv._[3];
    } else {
      courseId = resolveCourseId(undefined);
      materialId = argv._[2];
    }
    if (!materialId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Material ID is required', hint: 'classroom material get <material_id>' });
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(`Fetching material ${materialId}...`, globals);
    const res = await classroom.courses.courseWorkMaterials.get({ courseId, id: materialId });
    const m = res.data;
    const fileIds = shouldFetchRelated ? extractDriveFileIds([m]) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
    emit({ material: m }, globals, (data) => {
      console.log(pc.green(`\n✔ Material Details:`));
      const mat = data.material;
      const stateColor = mat.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(mat.state || 'UNKNOWN');
      const item: BlockItem = {
        title: mat.title,
        id: mat.id,
        details: [
          ['State', stateColor],
          ...(mat.creationTime ? [['Created', mat.creationTime] as [string, string]] : []),
          ...(mat.updateTime ? [['Updated', mat.updateTime] as [string, string]] : []),
          ...(mat.alternateLink ? [['Link', pc.blue(pc.underline(mat.alternateLink))] as [string, string]] : []),
          ...(mat.description ? [['Description', mat.description] as [string, string]] : [])
        ]
      };
      if (isFull) {
        if (mat.courseId) item.details!.push(['Course ID', mat.courseId]);
        if (mat.topicId) item.details!.push(['Topic ID', mat.topicId]);
        if (mat.creatorUserId) item.details!.push(['Creator ID', mat.creatorUserId]);
        if (mat.scheduledTime) item.details!.push(['Scheduled', mat.scheduledTime]);
      }
      
      if (shouldFetchRelated) {
        const atts = formatAttachments(mat.materials, sizeMap);
        if (atts) item.attachments = atts;
      }
      printBlock([item]);
    });
  } else if (verb === 'create') {
    const courseId = resolveCourseId(argv._[2]);
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
  const classroom = await getClient();

  if (verb === 'list') {
    let courseId: string;
    let courseWorkId: string;
    if (argv._[3]) {
      courseId = argv._[2];
      courseWorkId = argv._[3];
    } else {
      courseId = resolveCourseId(undefined);
      courseWorkId = argv._[2];
    }
    if (!courseWorkId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'CourseWork ID is required', hint: 'classroom submissions list <work_id>' });
    
    const res = await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId });
    const raw = res.data.studentSubmissions || [];
    const range = resolveDateRange(globals.from, globals.last);
    const submissions = applyDateFilter(raw, range, (s: any) => s.updateTime || s.creationTime);
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    const fileIds = shouldFetchRelated ? extractDriveFileIds(submissions) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
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
        if (isFull && s.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(s.alternateLink))]);
        if (shouldFetchRelated) {
          const atts = formatAttachments(s.assignmentSubmission?.attachments, sizeMap);
          if (atts && atts.length > 0) item.attachments = atts;
        }
        return item;
      }));
    });
  } else if (verb === 'grade') {
    let courseId: string;
    let courseWorkId: string;
    let studentId: string;
    if (argv._[4]) {
      courseId = argv._[2];
      courseWorkId = argv._[3];
      studentId = argv._[4];
    } else {
      courseId = resolveCourseId(undefined);
      courseWorkId = argv._[2];
      studentId = argv._[3];
    }
    const score = argv['score'];
    if (!courseWorkId || !studentId || score === undefined) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Work ID, Student ID and --score are required' });
    
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
    let courseId: string;
    let courseWorkId: string;
    let studentId: string;
    if (argv._[4]) {
      courseId = argv._[2];
      courseWorkId = argv._[3];
      studentId = argv._[4];
    } else {
      courseId = resolveCourseId(undefined);
      courseWorkId = argv._[2];
      studentId = argv._[3];
    }
    if (!courseWorkId || !studentId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Work ID and Student ID are required' });
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
  let courseId: string;
  let courseWorkId: string;
  if (argv._[3]) {
    courseId = argv._[2];
    courseWorkId = argv._[3];
  } else {
    courseId = resolveCourseId(undefined);
    courseWorkId = argv._[2];
  }
  if (!courseWorkId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'CourseWork ID is required' });
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
