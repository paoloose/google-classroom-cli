import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, BlockItem } from '../ui.js';

export async function handleStream(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
  const classroom = await getClient();

  if (verb === 'list') {
    const res = await classroom.courses.announcements.list({ courseId });
    const announcements = res.data.announcements || [];
    emit({ announcements }, globals, (data) => {
      if (data.announcements.length === 0) { 
        console.log(pc.yellow('No announcements found.')); 
        return; 
      }
      
      printBlock(data.announcements.map((a: any) => {
        const item: BlockItem = {
          title: a.text,
          id: a.id,
          details: [['Posted', a.updateTime]]
        };
        if (a.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(a.alternateLink))]);
        return item;
      }));
    });
  } else if (verb === 'get') {
    const id = argv._[3];
    if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Announcement ID is required', hint: 'classroom stream get <course_id> <announcement_id>' });
    
    note(`Fetching announcement ${id}...`, globals);
    const res = await classroom.courses.announcements.get({ courseId, id });
    const a = res.data;
    
    emit({ announcement: a }, globals, (data) => {
      console.log(pc.green(`\n✔ Announcement Details:`));
      const item: BlockItem = {
        title: a.text,
        id: a.id,
        details: [
          ['State', a.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(a.state || 'UNKNOWN')],
          ['Posted', a.updateTime]
        ]
      };
      if (a.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(a.alternateLink))]);
      
      if (a.materials && a.materials.length > 0) {
        item.attachments = a.materials.map((att: any) => {
          if (att.driveFile?.driveFile) return `📄 ${att.driveFile.driveFile.title} ${pc.dim(`(ID: ${att.driveFile.driveFile.id})`)}`;
          if (att.link) return `🔗 ${pc.blue(pc.underline(att.link.url))}`;
          if (att.youtubeVideo) return `▶️ ${att.youtubeVideo.title} ${pc.dim(`(${att.youtubeVideo.alternateLink})`)}`;
          return 'Unknown Attachment';
        });
      }
      
      printBlock([item]);
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
