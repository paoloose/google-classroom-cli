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
export async function handleStudentAction(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();
  let courseId: string | undefined;
  let courseWorkId: string | undefined;

  if (argv._[3]) {
    courseId = resolveCourseId(argv._[2]);
    courseWorkId = decodeClassroomIdentifier(argv._[3]) || argv._[3];
  } else if (argv._[2]) {
    const parsed = parseClassroomUrl(argv._[2]);
    if (parsed.courseId && (parsed.courseWorkId || parsed.resourceId)) {
      courseId = parsed.courseId;
      courseWorkId = parsed.courseWorkId || parsed.resourceId;
    } else if (parsed.courseId && !parsed.courseWorkId && !parsed.resourceId) {
      courseId = parsed.courseId;
      courseWorkId = undefined;
    } else {
      const active = getActiveCourse();
      if (active?.id) {
        courseId = active.id;
        courseWorkId = parsed.courseWorkId || decodeClassroomIdentifier(argv._[2]);
      } else {
        const decoded = decodeClassroomIdentifier(argv._[2]) || argv._[2];
        try {
          await classroom.courses.get({ id: decoded });
          courseId = decoded;
          courseWorkId = undefined;
        } catch {
          courseWorkId = decoded;
        }
      }
    }
  } else {
    const active = getActiveCourse();
    if (active?.id) {
      courseId = active.id;
    }
  }

  if (!courseWorkId) {
    if (globals.json) {
      throw new AppError('MISSING_ARG', {
        name: 'MissingArg',
        human: 'CourseWork ID is required in JSON mode',
        hint: `classroom ${verb || 'submit'} <course_id> <work_id> or select an active course and run classroom ${verb || 'submit'} <work_id>`
      });
    }

    if (!courseId) {
      note('Fetching active courses...', globals);
      const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'] });
      const courses = coursesRes.data.courses || [];
      if (courses.length === 0) {
        console.log(pc.yellow('No active courses found to select.'));
        return;
      }
      const chosenCourseId = await promptForCourse(courses, 'Select a course for submission:');
    if (!chosenCourseId) return;
    courseId = chosenCourseId;
    }

    note(`Fetching assignments for course ${courseId}...`, globals);
    const cwListRes = await classroom.courses.courseWork.list({
      courseId,
      courseWorkStates: ['PUBLISHED']
    });
    const works = cwListRes.data.courseWork || [];
    if (works.length === 0) {
      console.log(pc.yellow('No published assignments found in this course.'));
      return;
    }

    const chosenTaskId = await promptForCourseWork(works, `Select an assignment to ${verb || 'submit'}:`);
    if (!chosenTaskId) return;
    courseWorkId = chosenTaskId;
  }

  if (verb === 'submit' && argv['turn-in'] === undefined && argv['turnIn'] === undefined && !globals.json) {
    const { confirm, isCancel, cancel } = await import('@clack/prompts');
    const shouldTurnIn = await confirm({
      message: 'Do you want to turn in the assignment now?',
      initialValue: true
    });
    if (isCancel(shouldTurnIn)) {
      cancel('Action cancelled.');
      return;
    }
    argv['turn-in'] = shouldTurnIn;
  }

  if (!courseId) {
    throw new AppError('MISSING_ARG', { name: 'MissingCourseId', human: 'Course ID is required.' });
  }

  // Smart Routing Engine check
  const cwRes = await classroom.courses.courseWork.get({ courseId, id: courseWorkId });
  const cw = cwRes.data;
  
  if (!cw.associatedWithDeveloper) {
    const { ProfileManager } = await import('../../cli/foundation/profile.js');
    const profileManager = new ProfileManager('classroom-cli');
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) {
      throw new AppError('NO_ACTIVE_PROFILE', {
        name: 'NoActiveProfile',
        human: 'No active profile found for web automation fallback.',
        hint: 'Run `classroom auth login` first.'
      });
    }
    if (verb === 'turn-in') {
      const { executeWebTurnIn } = await import('../web-engine.js');
      await executeWebTurnIn(activeProfile, courseId, courseWorkId, globals);
      return;
    } else if (verb === 'submit') {
      const rawLinks = Array.isArray(argv['link']) ? argv['link'] : (argv['link'] ? [argv['link']] : []);
      const links = rawLinks.flatMap((l: string) => l.split(',')).map((l: string) => l.trim()).filter(Boolean);
      
      const rawFiles = Array.isArray(argv['file']) ? argv['file'] : (argv['file'] ? [argv['file']] : []);
      const files = rawFiles.flatMap((f: string) => f.split(',')).map((f: string) => f.trim()).filter(Boolean);
      
      const { executeWebSubmit, executeWebTurnIn } = await import('../web-engine.js');
      await executeWebSubmit(activeProfile, courseId, courseWorkId, links, files, globals);
      
      if (argv['turn-in'] || argv['turnIn']) {
        await executeWebTurnIn(activeProfile, courseId, courseWorkId, globals);
      } else {
        console.log(pc.cyan(`\n💡 Hint: Attachments were added but not turned in.`));
        console.log(pc.cyan(`   Next time, pass the --turn-in flag to do it all at once.`));
        console.log(pc.cyan(`   To turn this assignment in now, run: `) + pc.bold(`classroom turn-in ${courseId} ${courseWorkId}`));
      }
      return;
    } else if (verb === 'unsubmit') {
      const { executeWebUnsubmit } = await import('../web-engine.js');
      await executeWebUnsubmit(activeProfile, courseId, courseWorkId, globals);
      return;
    } else {
       throw new AppError('WEB_ENGINE_NOT_IMPLEMENTED', {
         name: 'WebEngineNotImplemented',
         human: `Web automation fallback is only implemented for turn-in, unsubmit, and submit currently.`
       });
    }
  }

  // Find the student's submission id
  const subRes = await classroom.courses.courseWork.studentSubmissions.list({ courseId, courseWorkId, userId: 'me' });
  const submission = subRes.data.studentSubmissions?.[0];
  if (!submission) throw new AppError('NOT_FOUND', { name: 'NotFound', human: 'Submission not found for you' });

  try {
    if (verb === 'submit') {
      const rawLinks = Array.isArray(argv['link']) ? argv['link'] : (argv['link'] ? [argv['link']] : []);
      const links = rawLinks.flatMap((l: string) => l.split(',')).map((l: string) => l.trim()).filter(Boolean);
      
      const rawFiles = Array.isArray(argv['file']) ? argv['file'] : (argv['file'] ? [argv['file']] : []);
      const files = rawFiles.flatMap((f: string) => f.split(',')).map((f: string) => f.trim()).filter(Boolean);
      
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
          const fileId = await uploadToDrive(file, globals, courseId);
          addAttachments.push({ driveFile: { id: fileId } });
        }
      }

      await classroom.courses.courseWork.studentSubmissions.modifyAttachments({
        courseId, courseWorkId, id: submission.id!,
        requestBody: { addAttachments }
      });
      
      if (argv['turn-in'] || argv['turnIn']) {
        await classroom.courses.courseWork.studentSubmissions.turnIn({
          courseId, courseWorkId, id: submission.id!
        });
        emit({ turnedIn: true }, globals, () => console.log(pc.green(`✔ Assignment submitted and turned in successfully.`)));
      } else {
        emit({ submitted: true }, globals, () => {
          console.log(pc.green(`✔ Attachments added successfully.`));
          console.log(pc.cyan(`\n💡 Hint: Attachments were added but not turned in.`));
          console.log(pc.cyan(`   Next time, pass the --turn-in flag to do it all at once.`));
          console.log(pc.cyan(`   To turn this assignment in now, run: `) + pc.bold(`classroom turn-in ${courseId} ${courseWorkId}`));
        });
      }
      return;
    } else if (verb === 'turn-in') {
      await classroom.courses.courseWork.studentSubmissions.turnIn({ courseId, courseWorkId, id: submission.id! });
      emit({ success: true }, globals, () => console.log(`Turned in assignment.`));
    } else if (verb === 'unsubmit') {
      await classroom.courses.courseWork.studentSubmissions.reclaim({ courseId, courseWorkId, id: submission.id! });
      emit({ success: true }, globals, () => console.log(`Unsubmitted assignment.`));
    } else {
      throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
    }
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    if (error.message?.includes('@ProjectPermissionDenied') || error.message?.includes('Developer Console project is not permitted')) {
      throw new AppError('PROJECT_PERMISSION_DENIED', {
        name: 'ProjectPermissionDenied',
        human: 'Google Classroom API restriction: Submissions can only be modified by the Google Cloud project that created the assignment.',
        hint: 'Assignments created manually by teachers in the Classroom web UI have associatedWithDeveloper: false, which prevents third-party API clients from modifying or turning in submissions.'
      }, error);
    }
    throw new AppError('API_ERROR', { name: 'ApiError', human: error.message }, error);
  }
}
