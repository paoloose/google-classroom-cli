#!/usr/bin/env bun
import { parseArgv } from '../cli/foundation/argv.js';
import { parseGlobalFlags } from '../cli/foundation/global-flags.js';
import { AppError } from '../cli/foundation/error-map.js';
import { showBanner } from '../cli/foundation/banner.js';
import { emit, reportError } from '../cli/agent/json-mode.js';
import { handleAuth, handleCourseList, handleCourseGet, handleCourseStream, handleCourseWork, handleTasksPending, handleTasksDueSoon } from './commands.js';
import { printBanner } from '../cli/foundation/banner.js';

async function main() {
  const argv = parseArgv(process.argv.slice(2));
  const globals = parseGlobalFlags(argv);
  
  if (argv.help || argv.h) {
    if (!globals.json) printBanner({ name: 'Classroom', tagline: 'Classroom CLI' });
    console.error('Usage: classroom <noun> <verb> [options]');
    console.error('Commands:');
    console.error('  auth login          Authenticate with Google (requires --client-id and --client-secret)');
    console.error('  auth logout         Clear credentials');
    console.error('  course list         List Google Classroom courses');
    console.error('  course get <id>     Get a course by ID');
    console.error('  course stream <id>  Get announcements for a course');
    console.error('  course work <id>    Get coursework for a course');
    console.error('  tasks pending       List pending assignments across all courses');
    console.error('  tasks due-soon      List assignments due in the next 7 days');
    console.error('  schema              Show output JSON schema');
    process.exit(0);
  }

  const noun = argv._[0];
  const verb = argv._[1];

  try {
    if (noun === 'schema') {
       emit({ version: "1.0", entities: ["Course", "CourseWork"] }, globals, (d) => console.log(JSON.stringify(d, null, 2)));
       return;
    }

    if (noun === 'auth') {
      await handleAuth(verb, globals, argv);
      return;
    }

    if (noun === 'course') {
      if (verb === 'list') {
        await handleCourseList(globals, argv);
      } else if (verb === 'get') {
        await handleCourseGet(globals, argv);
      } else if (verb === 'stream') {
        await handleCourseStream(globals, argv);
      } else if (verb === 'work') {
        await handleCourseWork(globals, argv);
      } else {
        throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
      }
      return;
    }
    
    if (noun === 'tasks') {
      if (verb === 'pending') {
        await handleTasksPending(globals, argv);
      } else if (verb === 'due-soon') {
        await handleTasksDueSoon(globals, argv);
      } else {
        throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
      }
      return;
    }

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
