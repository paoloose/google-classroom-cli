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
export async function handleSubmissions(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();

  if (verb === 'list') {
    const target = resolveCommandTarget(argv._[2], argv._[3], 'work');
    const courseId = target.courseId || resolveCourseId(undefined);
    const courseWorkId = target.resourceId;
    if (!courseWorkId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'CourseWork ID is required', hint: 'classroom submissions list <work_id>' });
    
    const res = await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId });
    const raw = res.data.studentSubmissions || [];
    const range = resolveDateRange(globals.from, globals.last);
    const submissions = applyDateFilter(raw, range, (s: any) => s.updateTime || s.creationTime);
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    const fileIds = extractDriveFileIds(submissions);
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
    const enrichedSubmissions = submissions.map((s: any) => ({
      ...s,
      files: extractAttachedFiles(s.assignmentSubmission?.attachments, sizeMap)
    }));

    emit({ submissions: enrichedSubmissions }, globals, (data) => {
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
        const atts = formatAttachments(s.assignmentSubmission?.attachments, sizeMap);
        if (atts && atts.length > 0) item.attachments = atts;
        return item;
      }));
    });
  } else if (verb === 'grade') {
    const target = resolveCommandTarget(argv._[2], argv._[4] ? argv._[3] : undefined, 'work');
    const courseId = target.courseId || resolveCourseId(undefined);
    const courseWorkId = target.resourceId;
    const studentId = argv._[4] || argv._[3];
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
    const target = resolveCommandTarget(argv._[2], argv._[4] ? argv._[3] : undefined, 'work');
    const courseId = target.courseId || resolveCourseId(undefined);
    const courseWorkId = target.resourceId;
    const studentId = argv._[4] || argv._[3];
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

