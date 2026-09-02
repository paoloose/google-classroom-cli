import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { resolveDateRange, applyDateFilter } from '../../cli/foundation/date-filter.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, BlockItem } from '../ui.js';
import { extractDriveFileIds, fetchDriveFileSizes, formatAttachments } from '../attachments.js';

export async function handleStream(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const courseId = argv._[2];
  if (!courseId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Course ID is required' });
  const classroom = await getClient();

  if (verb === 'list') {
    const res = await classroom.courses.announcements.list({ courseId });
    const raw = res.data.announcements || [];
    const range = resolveDateRange(globals.from, globals.last);
    const announcements = applyDateFilter(raw, range, (a: any) => a.updateTime);
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    const fileIds = shouldFetchRelated ? extractDriveFileIds(announcements) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
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
        if (isFull && a.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(a.alternateLink))]);
        
        if (shouldFetchRelated) {
          const atts = formatAttachments(a.materials, sizeMap);
          if (atts && atts.length > 0) item.attachments = atts;
        }
        return item;
      }));
    });
  } else if (verb === 'get') {
    const id = argv._[3];
    if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Announcement ID is required', hint: 'classroom stream get <course_id> <announcement_id>' });
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(`Fetching announcement ${id}...`, globals);
    const res = await classroom.courses.announcements.get({ courseId, id });
    const a = res.data;
    const fileIds = shouldFetchRelated ? extractDriveFileIds([a]) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
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
      if (isFull && a.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(a.alternateLink))]);
      
      if (shouldFetchRelated) {
        const atts = formatAttachments(a.materials, sizeMap);
        if (atts && atts.length > 0) item.attachments = atts;
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
