import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import type { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { resolveDateRange, applyDateFilter } from '../../cli/foundation/date-filter.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, type BlockItem } from '../ui.js';
import { extractDriveFileIds, fetchDriveFileSizes, formatAttachments, extractAttachedFiles } from '../attachments.js';
import { parseDueDate, formatTimeLeft } from '../date-utils.js';
import { resolveCourseId, getActiveCourse } from '../context.js';
import { parseClassroomUrl, decodeClassroomIdentifier, resolveCommandTarget } from '../url-utils.js';
import { formatTaskBlock, formatCourseWorkBlock, formatTopicBlock, formatMaterialBlock, formatSubmissionBlock } from '../formatters.js';
import { promptForCourse, promptForCourseWork } from '../prompts.js';
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
      
      const fileIds = extractDriveFileIds(coursework);
      const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
      
      const enrichedCoursework = coursework.map((cw: any) => ({
        ...cw,
        files: extractAttachedFiles(cw.materials, sizeMap)
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
              ['Due', cw.dueDate ? pc.yellow(dueStr) : dueStr],
              ...(cw.maxPoints !== undefined ? [['Max Points', String(cw.maxPoints)] as [string, string]] : []),
              ...(cw.creationTime ? [['Created', cw.creationTime] as [string, string]] : []),
              ...(cw.updateTime ? [['Updated', cw.updateTime] as [string, string]] : []),
              ...(cw.alternateLink ? [['Link', pc.blue(pc.underline(cw.alternateLink))] as [string, string]] : []),
              ...(cw.description ? [['Description', cw.description] as [string, string]] : [])
            ]
          };
          if (isFull) {
            if (cw.courseId) item.details!.push(['Course ID', cw.courseId]);
            if (cw.workType) item.details!.push(['Type', cw.workType]);
            if (cw.topicId) item.details!.push(['Topic ID', cw.topicId]);
            if (cw.creatorUserId) item.details!.push(['Creator ID', cw.creatorUserId]);
            if (cw.submissionModificationMode) item.details!.push(['Submission Mode', cw.submissionModificationMode]);
            if (cw.assigneeMode) item.details!.push(['Assignee Mode', cw.assigneeMode]);
            if (cw.scheduledTime) item.details!.push(['Scheduled', cw.scheduledTime]);
          }

          const atts = formatAttachments(cw.materials, sizeMap);
          if (atts) item.attachments = atts;
          return item;
        }));
      });
    } catch (error: any) { throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error); }
  } else if (verb === 'get') {
    const target = resolveCommandTarget(argv._[2], argv._[3], 'work');
    const courseId = target.courseId || resolveCourseId(undefined);
    const workId = target.resourceId;
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
      
      const fileIds = extractDriveFileIds(shouldFetchRelated ? [cw, submission] : [cw]);
      const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
      
      const enrichedCw = {
        ...cw,
        files: extractAttachedFiles(cw.materials || [], sizeMap)
      };

      emit({ coursework: enrichedCw, submission }, globals, (data) => {
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
          title: data.coursework.title || 'Untitled Assignment',
          id: data.coursework.id || undefined,
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

        const atts = formatAttachments(data.coursework.materials || [], sizeMap);
        if (atts) item.attachments = atts;
        
        printBlock([item]);
        
        if (shouldFetchRelated && data.submission) {
          console.log(pc.green(`✔ Your Submission:`));
          const subStateColor = data.submission.state === 'TURNED_IN' ? pc.green('TURNED IN') : 
                                data.submission.state === 'RETURNED' ? pc.blue('RETURNED') : 
                                pc.yellow(data.submission.state || 'UNKNOWN');
          const subItem: BlockItem = {
            title: `Student ${data.submission.userId || 'Me'}`,
            id: data.submission.id || undefined,
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
          
          const subAtts = formatAttachments(data.submission.assignmentSubmission?.attachments || [], sizeMap);
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

