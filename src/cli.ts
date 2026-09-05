#!/usr/bin/env bun
import { parseArgv } from '../cli/foundation/argv.js';
import { parseGlobalFlags } from '../cli/foundation/global-flags.js';
import { AppError } from '../cli/foundation/error-map.js';
import { emit, reportError, note } from '../cli/agent/json-mode.js';

import { handleAuth } from './commands/auth.js';
import { handleCourse } from './commands/courses.js';
import { handleRoster } from './commands/rosters.js';
import { handleCourseWork, handleTopic, handleMaterial, handleSubmissions, handleStudentAction, handleTasksPending, handleTasksDueSoon } from './commands/coursework.js';
import { handleStream } from './commands/stream.js';
import { handleGuardians } from './commands/guardians.js';
import { handleProfile } from './commands/profiles.js';
import { handleComments } from './commands/comments.js';
import pc from 'picocolors';

async function main() {
  const argv = parseArgv(process.argv.slice(2));
  const globals = parseGlobalFlags(argv);
  
  // Strict flag validation
  const allowedFlags = new Set([
    'json', 'help', 'h', 'full', 'detailed', 'related', 'from', 'last',
    'name', 'section', 'status', 'email', 'role',
    'text', 't', 'message', 'm', 'content', 'title', 'link', 'file', 'dest', 'score', 'topic',
    'code', 'cjc', 'course', 'courseId', 'turn-in', 'turnIn', 'code-only', 'codeOnly', 'class'
  ]);
  for (const key of Object.keys(argv)) {
    if (key !== '_' && !allowedFlags.has(key)) {
      const err = new AppError('UNKNOWN_FLAG', { name: 'UnknownFlag', human: `Unrecognized flag: --${key}` });
      reportError(err, globals);
      process.exit(1);
    }
  }

  if (argv.help || argv.h || argv._.length === 0) {
    if (!globals.json) {
      const g = pc.blue('G') + pc.red('o') + pc.yellow('o') + pc.blue('g') + pc.green('l') + pc.red('e');
      console.error(`\n  📝 ${pc.bold(`${g} Classroom CLI`)}\n`);
      console.error(`  ${pc.dim('Usage:')} ${pc.cyan('classroom')} ${pc.green('<noun>')} ${pc.magenta('<verb>')} ${pc.yellow('[options]')}\n`);
      
      const printCategory = (title: string, cmds: [string, string][]) => {
        console.error(pc.bold(pc.white(title)));
        const maxLen = Math.max(...cmds.map(c => c[0].length));
        for (const [cmd, desc] of cmds) {
          const parts = cmd.split(' ');
          let coloredCmd = '';
          let wordIdx = 0;
          
          for (const p of parts) {
            if (p.startsWith('<') || p.startsWith('[') || p.startsWith('-')) {
              coloredCmd += pc.yellow(p) + ' ';
            } else {
              if (wordIdx === 0) coloredCmd += pc.green(p) + ' ';
              else if (wordIdx === 1) coloredCmd += pc.magenta(p) + ' ';
              else coloredCmd += pc.yellow(p) + ' ';
              wordIdx++;
            }
          }
          
          const padding = ' '.repeat(Math.max(0, maxLen - cmd.length + 2));
          console.error(`  ${coloredCmd.trimEnd()}${padding} ${pc.dim(desc)}`);
        }
        console.error('');
      };
      
      printCategory('Core', [
        ['profile list', 'List all user profiles'],
        ['profile use <name>', 'Switch active profile'],
        ['profile add <name>', 'Create a new profile'],
        ['profile remove <name>', 'Delete a profile'],
        ['auth login', 'Authenticate active profile'],
        ['auth web-login', 'Perform web handshake for active profile'],
        ['auth logout', 'Clear credentials for active profile']
      ]);
      
      printCategory('Courses & Rosters', [
        ['course list', 'List active courses'],
        ['course select [id]', 'Select active course context (interactive TUI if no id)'],
        ['course deselect', 'Clear active course context'],
        ['course current', 'Show currently selected course'],
        ['course get [id]', 'Get details of a course (defaults to selected course)'],
        ['course enroll [id] <code>', 'Join a course with enrollment code or invite link (use --code-only with 7-char code)'],
        ['course unenroll [id]', 'Leave a course (defaults to selected course)'],
        ['course create', 'Create a course (requires --name)'],
        ['course update [id]', 'Update a course status (requires --status)'],
        ['roster list [id]', 'List students (or use --role=teacher)'],
        ['roster add [id]', 'Add a user (requires --email, optional --role=teacher)'],
        ['roster remove [id]', 'Remove a user (requires --email)']
      ]);
      
      printCategory('Coursework & Content', [
        ['stream list <id>', 'List announcements'],
        ['stream get <course_id> <id>', 'View announcement details'],
        ['stream post <id>', 'Post announcement (requires --text)'],
        ['work list <id>', 'List coursework'],
        ['work get <course_id> <id>', 'View assignment details (use --related to see your submission)'],
        ['work create <id>', 'Create an assignment (requires --title)'],
        ['topic list <course_id>', 'List topics in a course'],
        ['topic get <course_id> <id>', 'View topic details (use --related to see materials/assignments)'],
        ['topic create <course_id>', 'Create a new topic (requires --name)'],
        ['material list <id>', 'List classwork materials'],
        ['material get <course_id> <id>', 'View material details'],
        ['material create <id>', 'Create material (requires --title, supports --file/--link)'],
        ['drive download <id> [dest]', 'Download a Drive file (defaults to original filename)']
      ]);
      
      printCategory('Grading & Submissions (Teachers)', [
        ['submissions list <c_id> <w_id>', 'List all submissions for an assignment'],
        ['submissions grade <c_id> <w_id> <s_id>', 'Grade a submission (requires --score)'],
        ['submissions return <c_id> <w_id> <s_id>', 'Return a graded submission to the student']
      ]);
      
      printCategory('Student Actions', [
        ['enroll [id] <code>', 'Join a course (use --code-only if you only have a 7-character code)'],
        ['unenroll [id]', 'Leave a course (defaults to selected course)'],
        ['submit [c_id] [w_id]', 'Attach a link/file (interactive TUI if no task, --turn-in for full submission)'],
        ['turn-in [c_id] [w_id]', 'Turn in assignment (interactive TUI if no task)'],
        ['unsubmit [c_id] [w_id]', 'Unsubmit assignment (interactive TUI if no task)'],
        ['comment list [c_id] [w_id]', 'List private/class comments on an assignment (use --class for class comments)'],
        ['comment post [c_id] [w_id]', 'Post a private/class comment (supports --text, --class)'],
        ['pending', 'Global list of pending tasks across all courses'],
        ['due-soon', 'Global list of tasks due in the next 7 days']
      ]);
      
      printCategory('Parents/Guardians', [
        ['guardian list <s_id>', 'List guardians for a student'],
        ['guardian invite <s_id>', 'Invite a guardian (requires --email)']
      ]);
    }
    process.exit(0);
  }

  const noun = argv._[0];
  const verb = argv._[1];

  try {
    if (noun === 'schema') {
       emit({ version: "1.0" }, globals, (d) => console.log(JSON.stringify(d, null, 2)));
       return;
    }
    if (noun === 'profile') return await handleProfile(verb, globals, argv);
    if (noun === 'auth') return await handleAuth(verb, globals, argv);
    if (noun === 'course') return await handleCourse(verb, globals, argv);
    if (noun === 'roster') return await handleRoster(verb, globals, argv);
    if (noun === 'stream') return await handleStream(verb, globals, argv);
    if (noun === 'topic') return await handleTopic(verb, globals, argv);
    if (noun === 'material') return await handleMaterial(verb, globals, argv);
    if (noun === 'submissions') return await handleSubmissions(verb, globals, argv);
    if (noun === 'guardian') return await handleGuardians(verb, globals, argv);
    if (noun === 'comment' || noun === 'comments') return await handleComments(verb, globals, argv);
    
    // Some are slightly renamed/grouped for CLI UX
    if (noun === 'work') return await handleCourseWork(globals, { ...argv, _: ['work', argv._[1], argv._[2], argv._[3]] });
    if (noun === 'enroll' || noun === 'join') return await handleCourse('enroll', globals, { ...argv, _: ['course', 'enroll', argv._[1], argv._[2]] });
    if (noun === 'unenroll' || noun === 'leave') return await handleCourse('unenroll', globals, { ...argv, _: ['course', 'unenroll', argv._[1]] });
    if (noun === 'submit') return await handleStudentAction('submit', globals, { ...argv, _: ['student', 'submit', argv._[1], argv._[2]]});
    if (noun === 'turn-in') return await handleStudentAction('turn-in', globals, { ...argv, _: ['student', 'turn-in', argv._[1], argv._[2]]});
    if (noun === 'unsubmit') return await handleStudentAction('unsubmit', globals, { ...argv, _: ['student', 'unsubmit', argv._[1], argv._[2]]});
    
    if (noun === 'drive' && verb === 'download') {
      const fileId = argv._[2];
      const destArg = (argv._[3] || argv['dest']) as string | undefined;
      if (!fileId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'File ID is required', hint: 'classroom drive download <id> [dest]' });
      const { downloadFromDrive } = await import('./commands/drive.js');
      note(`Downloading file ${fileId}...`, globals);
      const finalDest = await downloadFromDrive(fileId, destArg, globals);
      emit({ success: true, fileId, dest: finalDest }, globals, () => console.log(`Downloaded ${fileId} to ${finalDest}`));
      return;
    }

    if (noun === 'pending') return await handleTasksPending(globals, { ...argv, _: ['pending']});
    if (noun === 'due-soon') return await handleTasksDueSoon(globals, { ...argv, _: ['due-soon']});
    
    // Backwards compatibility
    if (noun === 'course' && verb === 'stream') return await handleStream('list', globals, { ...argv, _: ['stream', 'list', argv._[2]]});
    if (noun === 'course' && verb === 'work') return await handleCourseWork(globals, { ...argv, _: ['course', 'work', argv._[2]] });

    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown command: ${noun || ''} ${verb || ''}`.trim() });
  } catch (error: any) {
    reportError(error, globals);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
