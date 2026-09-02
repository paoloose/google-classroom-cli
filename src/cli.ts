#!/usr/bin/env bun
import { parseArgv } from '../cli/foundation/argv.js';
import { parseGlobalFlags } from '../cli/foundation/global-flags.js';
import { AppError } from '../cli/foundation/error-map.js';
import { emit, reportError } from '../cli/agent/json-mode.js';

import { handleAuth } from './commands/auth.js';
import { handleCourse } from './commands/courses.js';
import { handleRoster } from './commands/rosters.js';
import { handleCourseWork, handleTopic, handleMaterial, handleSubmissions, handleStudentAction, handleTasksPending, handleTasksDueSoon } from './commands/coursework.js';
import { handleStream } from './commands/stream.js';
import { handleGuardians } from './commands/guardians.js';
import pc from 'picocolors';

async function main() {
  const argv = parseArgv(process.argv.slice(2));
  const globals = parseGlobalFlags(argv);
  
  // Strict flag validation
  const allowedFlags = new Set([
    'json', 'help', 'h', 'full',
    'name', 'section', 'status', 'email', 'role',
    'text', 'title', 'link', 'file', 'dest', 'score', 'topic'
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
          console.error(`  ${pc.cyan(cmd.padEnd(maxLen + 2))} ${pc.dim(desc)}`);
        }
        console.error('');
      };
      
      printCategory('Core', [
        ['auth login', 'Authenticate'],
        ['auth logout', 'Clear credentials']
      ]);
      
      printCategory('Courses & Rosters', [
        ['course list', 'List active courses'],
        ['course get <id>', 'Get details of a course and its topics'],
        ['course create', 'Create a course (requires --name)'],
        ['course update <id>', 'Update a course status (requires --status)'],
        ['roster list <id>', 'List students (or use --role=teacher)'],
        ['roster add <id>', 'Add a user (requires --email, optional --role=teacher)'],
        ['roster remove <id>', 'Remove a user (requires --email)']
      ]);
      
      printCategory('Coursework & Content', [
        ['stream list <id>', 'List announcements'],
        ['stream get <course_id> <id>', 'View announcement details'],
        ['stream post <id>', 'Post announcement (requires --text)'],
        ['work list <id>', 'List coursework'],
        ['work get <course_id> <id>', 'View assignment details and your submission'],
        ['work create <id>', 'Create an assignment (requires --title)'],
        ['topic list <course_id>', 'List topics in a course'],
        ['topic get <course_id> <id>', 'View topic details, materials, and assignments'],
        ['topic create <course_id>', 'Create a new topic (requires --name)'],
        ['material list <id>', 'List classwork materials'],
        ['material get <course_id> <id>', 'View material details'],
        ['material create <id>', 'Create material (requires --title, supports --file/--link)'],
        ['drive download <id>', 'Download a Drive file (optional --dest)']
      ]);
      
      printCategory('Grading & Submissions (Teachers)', [
        ['submissions list <c_id> <w_id>', 'List all submissions for an assignment'],
        ['submissions grade <c_id> <w_id> <s_id>', 'Grade a submission (requires --score)'],
        ['submissions return <c_id> <w_id> <s_id>', 'Return a graded submission to the student']
      ]);
      
      printCategory('Student Actions', [
        ['submit <c_id> <w_id>', 'Attach a link/file (requires --link/--file)'],
        ['turn-in <c_id> <w_id>', 'Turn in assignment'],
        ['unsubmit <c_id> <w_id>', 'Unsubmit assignment'],
        ['tasks pending', 'Global list of pending tasks across all courses'],
        ['tasks due-soon', 'Global list of tasks due in the next 7 days']
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
    if (noun === 'auth') return await handleAuth(verb, globals, argv);
    if (noun === 'course') return await handleCourse(verb, globals, argv);
    if (noun === 'roster') return await handleRoster(verb, globals, argv);
    if (noun === 'stream') return await handleStream(verb, globals, argv);
    if (noun === 'topic') return await handleTopic(verb, globals, argv);
    if (noun === 'material') return await handleMaterial(verb, globals, argv);
    if (noun === 'submissions') return await handleSubmissions(verb, globals, argv);
    if (noun === 'guardian') return await handleGuardians(verb, globals, argv);
    
    // Some are slightly renamed/grouped for CLI UX
    if (noun === 'work') return await handleCourseWork(globals, { ...argv, _: ['work', argv._[1], argv._[2], argv._[3]] });
    if (noun === 'submit') return await handleStudentAction('submit', globals, { ...argv, _: ['student', 'submit', argv._[1], argv._[2]]});
    if (noun === 'turn-in') return await handleStudentAction('turn-in', globals, { ...argv, _: ['student', 'turn-in', argv._[1], argv._[2]]});
    if (noun === 'unsubmit') return await handleStudentAction('unsubmit', globals, { ...argv, _: ['student', 'unsubmit', argv._[1], argv._[2]]});
    
    if (noun === 'drive' && verb === 'download') {
      const fileId = argv._[2];
      const dest = argv['dest'] || 'downloaded_file';
      if (!fileId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'File ID is required' });
      const { downloadFromDrive } = await import('./commands/drive.js');
      await downloadFromDrive(fileId, dest, globals);
      emit({ success: true, fileId, dest }, globals, () => console.log(`Downloaded ${fileId} to ${dest}`));
      return;
    }

    if (noun === 'tasks') {
      if (verb === 'pending') return await handleTasksPending(globals, argv);
      if (verb === 'due-soon') return await handleTasksDueSoon(globals, argv);
    }
    
    // Backwards compatibility
    if (noun === 'course' && verb === 'stream') return await handleStream('list', globals, { ...argv, _: ['stream', 'list', argv._[2]]});
    if (noun === 'course' && verb === 'work') return await handleCourseWork(globals, { ...argv, _: ['course', 'work', argv._[2]] });

    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown command: ${noun || ''} ${verb || ''}`.trim() });
  } catch (error) {
    reportError(error, globals);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
