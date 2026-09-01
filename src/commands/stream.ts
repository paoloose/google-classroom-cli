import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';

export async function handleStream(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
  const classroom = await getClient();

  if (verb === 'list') {
    const res = await classroom.courses.announcements.list({ courseId });
    const announcements = res.data.announcements || [];
    emit({ announcements }, globals, (data) => {
      if (data.announcements.length === 0) { console.log('No announcements found.'); return; }
      for (const a of data.announcements) console.log(`- ${a.text} (Updated: ${a.updateTime})`);
    });
  } else if (verb === 'post') {
    const text = argv['text'];
    const scheduled = argv['scheduled'];
    if (!text) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--text is required' });
    
    const requestBody: any = { text, state: scheduled ? 'DRAFT' : 'PUBLISHED' };
    if (scheduled) requestBody.scheduledTime = scheduled; // Needs appropriate date format

    const res = await classroom.courses.announcements.create({ courseId, requestBody });
    emit({ announcement: res.data }, globals, () => console.log('Announcement posted successfully.'));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown stream verb: ${verb}` });
  }
}
