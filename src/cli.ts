#!/usr/bin/env bun
import { parseArgv } from '../cli/foundation/argv.js';
import { parseGlobalFlags } from '../cli/foundation/global-flags.js';
import { AppError } from '../cli/foundation/error-map.js';
import { printBanner } from '../cli/foundation/banner.js';
import { emit, reportError } from '../cli/agent/json-mode.js';

import { handleAuth } from './commands/auth.js';
import { handleCourse } from './commands/courses.js';
import { handleRoster } from './commands/rosters.js';
import { handleCourseWork, handleTopic, handleMaterial, handleSubmissions, handleStudentAction, handleTasksPending, handleTasksDueSoon } from './commands/coursework.js';
import { handleStream } from './commands/stream.js';
import { handleGuardians } from './commands/guardians.js';

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
    if (!globals.json) printBanner({ name: 'Classroom', tagline: 'Classroom CLI' });
    console.error('Usage: classroom <noun> <verb> [options]');
    console.error('Core:');
    console.error('  auth login            Authenticate');
    console.error('  auth logout           Clear credentials');
    console.error('Courses & Rosters:');
    console.error('  course list           List active courses');
    console.error('  course get <id>       Get details of a course');
    console.error('  course create         Create a course (requires --name)');
    console.error('  course update <id>    Update a course status (requires --status)');
    console.error('  roster list <id>      List students (or use --role=teacher)');
    console.error('  roster add <id>       Add a user (requires --email, optional --role=teacher)');
    console.error('  roster remove <id>    Remove a user (requires --email)');
    console.error('Coursework & Content:');
    console.error('  stream list <id>      List announcements');
    console.error('  stream get <course_id> <announcement_id>  View announcement details');
    console.error('  stream post <id>      Post announcement (requires --text)');
    console.error('  work list <id>        List coursework');
    console.error('  work get <course_id> <work_id>     View assignment details and your submission');
    console.error('  work create <id>      Create an assignment (requires --title)');
    console.error('  topic list <course_id>             List topics in a course');
    console.error('  topic get <course_id> <topic_id>   View topic details, including its materials and assignments');
    console.error('  topic create <course_id> --name=... Create a new topic');
    console.error('  material list <id>    List classwork materials');
    console.error('  material get <course_id> <material_id>  View material details');
    console.error('  material create <id>  Create material (requires --title, supports --file/--link)');
    console.error('  drive download <id>   Download a Drive file (optional --dest)');
    console.error('Grading & Submissions (Teachers):');
    console.error('  submissions list <course_id> <work_id>');
    console.error('  submissions grade <course_id> <work_id> <student_id> (requires --score)');
    console.error('  submissions return <course_id> <work_id> <student_id>');
    console.error('Student Actions:');
    console.error('  submit <course_id> <work_id>       Attach a link (requires --link)');
    console.error('  turn-in <course_id> <work_id>      Turn in assignment');
    console.error('  unsubmit <course_id> <work_id>     Unsubmit assignment');
    console.error('  tasks pending                      Global list of pending tasks');
    console.error('  tasks due-soon                     Global list of tasks due in 7 days');
    console.error('Parents/Guardians:');
    console.error('  guardian list <student_id>         List guardians');
    console.error('  guardian invite <student_id>       Invite a guardian (requires --email)');
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
