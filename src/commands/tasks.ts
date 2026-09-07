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
async function getPendingTasks(classroom: any, globals: any) {
  const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'] });
  const courses = coursesRes.data.courses || [];
  const pendingTasks: { course: string; courseId: string; submission: any; courseWork: any }[] = [];
  
  await Promise.all(
    courses.map(async (course: any) => {
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
    })
  );
  return pendingTasks;
}

export async function handleTasksPending(globals: GlobalFlags, argv: any) {
  const classroom = await getClient();
  const shouldFetchRelated = argv.related || globals.json;
  const isFull = !!argv.full;
  
  try {
    const pendingTasks = await getPendingTasks(classroom, globals);
    const now = new Date();
    
    const allMaterials = pendingTasks.flatMap(t => [
      ...(t.courseWork.materials || []),
      ...(shouldFetchRelated ? (t.submission.assignmentSubmission?.attachments || []) : [])
    ]);
    const fileIds = extractDriveFileIds(allMaterials);
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();

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

    const allMaterials = dueSoonTasks.flatMap(t => [
      ...(t.courseWork.materials || []),
      ...(shouldFetchRelated ? (t.submission.assignmentSubmission?.attachments || []) : [])
    ]);
    const fileIds = extractDriveFileIds(allMaterials);
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();

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

