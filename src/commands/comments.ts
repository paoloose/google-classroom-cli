import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { parseDueDate, formatTimeLeft } from '../date-utils.js';
import { getActiveCourse, resolveCourseId } from '../context.js';
import { parseClassroomUrl, decodeClassroomIdentifier } from '../url-utils.js';

export async function handleComments(verb: string | undefined, globals: GlobalFlags, argv: any) {
  if (verb === 'list') {
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
          const classroom = await getClient();
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

    const classroom = await getClient();

    if (!courseWorkId) {
      if (globals.json) {
        throw new AppError('MISSING_ARG', {
          name: 'MissingArg',
          human: 'CourseWork ID is required in JSON mode',
          hint: 'classroom comment list <course_id> <work_id>'
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
        const { select, isCancel, cancel } = await import('@clack/prompts');
        const courseOptions = courses.map((c: any) => ({
          value: c.id!,
          label: `${c.name}${c.section ? ` · ${c.section}` : ''}`,
          hint: `ID: ${c.id}`
        }));
        const chosenCourseId = await select({
          message: 'Select a course:',
          options: courseOptions
        });
        if (isCancel(chosenCourseId)) {
          cancel('Action cancelled.');
          return;
        }
        courseId = chosenCourseId as string;
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

      const { select, isCancel, cancel } = await import('@clack/prompts');
      const taskOptions = works.map((w: any) => {
        let hint = `ID: ${w.id}`;
        if (w.dueDate) {
          const tDate = parseDueDate(w);
          const timeLeft = formatTimeLeft(tDate, new Date());
          hint += ` · Due: ${timeLeft}`;
        }
        return {
          value: w.id!,
          label: w.title || 'Untitled Assignment',
          hint
        };
      });

      const chosenTaskId = await select({
        message: 'Select an assignment to view private comments:',
        options: taskOptions
      });

      if (isCancel(chosenTaskId)) {
        cancel('Action cancelled.');
        return;
      }
      courseWorkId = chosenTaskId as string;
    }

    if (!courseId) {
      throw new AppError('MISSING_ARG', { name: 'MissingCourseId', human: 'Course ID is required.' });
    }

    const { ProfileManager } = await import('../../cli/foundation/profile.js');
    const profileManager = new ProfileManager('classroom-cli');
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) {
      throw new AppError('NO_ACTIVE_PROFILE', {
        name: 'NoActiveProfile',
        human: 'No active profile found for web automation.',
        hint: 'Run `classroom auth login` first.'
      });
    }

    const { executeWebListPrivateComments } = await import('../web-engine.js');
    await executeWebListPrivateComments(activeProfile, courseId, courseWorkId, globals);
  } else if (verb === 'post' || verb === 'add' || verb === 'create') {
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
          const classroom = await getClient();
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

    const classroom = await getClient();

    if (!courseWorkId) {
      if (globals.json) {
        throw new AppError('MISSING_ARG', {
          name: 'MissingArg',
          human: 'CourseWork ID is required in JSON mode',
          hint: 'classroom comment post <course_id> <work_id> --text="<content>"'
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
        const { select, isCancel, cancel } = await import('@clack/prompts');
        const courseOptions = courses.map((c: any) => ({
          value: c.id!,
          label: `${c.name}${c.section ? ` · ${c.section}` : ''}`,
          hint: `ID: ${c.id}`
        }));
        const chosenCourseId = await select({
          message: 'Select a course for private comment:',
          options: courseOptions
        });
        if (isCancel(chosenCourseId)) {
          cancel('Action cancelled.');
          return;
        }
        courseId = chosenCourseId as string;
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

      const { select, isCancel, cancel } = await import('@clack/prompts');
      const taskOptions = works.map((w: any) => {
        let hint = `ID: ${w.id}`;
        if (w.dueDate) {
          const tDate = parseDueDate(w);
          const timeLeft = formatTimeLeft(tDate, new Date());
          hint += ` · Due: ${timeLeft}`;
        }
        return {
          value: w.id!,
          label: w.title || 'Untitled Assignment',
          hint
        };
      });

      const chosenTaskId = await select({
        message: 'Select an assignment to post private comment:',
        options: taskOptions
      });

      if (isCancel(chosenTaskId)) {
        cancel('Action cancelled.');
        return;
      }
      courseWorkId = chosenTaskId as string;
    }

    if (!courseId) {
      throw new AppError('MISSING_ARG', { name: 'MissingCourseId', human: 'Course ID is required.' });
    }

    let commentText = argv['text'] || argv['t'] || argv['message'] || argv['m'] || argv['content'];
    if (!commentText) {
      if (globals.json) {
        throw new AppError('MISSING_ARG', {
          name: 'MissingArg',
          human: 'Comment text is required',
          hint: 'classroom comment post <course_id> <work_id> --text="<your message>"'
        });
      }

      const { text: textPrompt, isCancel, cancel } = await import('@clack/prompts');
      const entered = await textPrompt({
        message: 'Enter your private comment:',
        placeholder: 'Type your message to the teacher...',
        validate(val) {
          if (!val || !val.trim()) return 'Comment cannot be empty';
        }
      });

      if (isCancel(entered)) {
        cancel('Action cancelled.');
        return;
      }
      commentText = entered as string;
    }

    const { ProfileManager } = await import('../../cli/foundation/profile.js');
    const profileManager = new ProfileManager('classroom-cli');
    const activeProfile = profileManager.getActiveProfile();
    if (!activeProfile) {
      throw new AppError('NO_ACTIVE_PROFILE', {
        name: 'NoActiveProfile',
        human: 'No active profile found for web automation.',
        hint: 'Run `classroom auth login` first.'
      });
    }

    const { executeWebPostPrivateComment } = await import('../web-engine.js');
    await executeWebPostPrivateComment(activeProfile, courseId, courseWorkId, commentText, globals);
  } else {
    throw new AppError('UNKNOWN_COMMAND', {
      name: 'UnknownCommand',
      human: `Unknown verb '${verb}' for comment command.`,
      hint: 'Available: classroom comment list [course_id] [work_id], classroom comment post [course_id] [work_id] --text="<content>"'
    });
  }
}
