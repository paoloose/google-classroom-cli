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
  
  if (argv.help || argv.h) {
    if (!globals.json) printBanner({ name: 'Classroom', tagline: 'Classroom CLI' });
    console.error('Usage: classroom <noun> <verb> [options]');
    console.error('Core:');
    console.error('  auth login            Authenticate (use --teacher for full scopes)');
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
    console.error('  stream post <id>      Post announcement (requires --text)');
    console.error('  work list <id>        List coursework');
    console.error('  topic list <id>       List topics');
    console.error('  topic create <id>     Create a topic (requires --name)');
    console.error('  material list <id>    List classwork materials');
    console.error('  material create <id>  Create material (requires --title, optional --link, --topic)');
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
    if (noun === 'work' && verb === 'list') return await handleCourseWork(globals, { ...argv, _: ['course', 'work', argv._[2]] });
    if (noun === 'submit') return await handleStudentAction('submit', globals, { ...argv, _: ['student', 'submit', argv._[1], argv._[2]]});
    if (noun === 'turn-in') return await handleStudentAction('turn-in', globals, { ...argv, _: ['student', 'turn-in', argv._[1], argv._[2]]});
    if (noun === 'unsubmit') return await handleStudentAction('unsubmit', globals, { ...argv, _: ['student', 'unsubmit', argv._[1], argv._[2]]});
    
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
