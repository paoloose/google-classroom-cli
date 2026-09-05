import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { resolveDateRange, applyDateFilter } from '../../cli/foundation/date-filter.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, BlockItem } from '../ui.js';
import { extractDriveFileIds, fetchDriveFileSizes, formatAttachments, extractAttachedFiles } from '../attachments.js';
import { resolveCourseId } from '../context.js';
import { parseClassroomUrl, decodeClassroomIdentifier } from '../url-utils.js';

export async function handleStream(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();

  if (verb === 'list') {
    const courseId = resolveCourseId(argv._[2]);
    const res = await classroom.courses.announcements.list({ courseId });
    const raw = res.data.announcements || [];
    const range = resolveDateRange(globals.from, globals.last);
    const announcements = applyDateFilter(raw, range, (a: any) => a.updateTime);
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    const fileIds = extractDriveFileIds(announcements);
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
    const enrichedAnnouncements = announcements.map((a: any) => ({
      ...a,
      files: extractAttachedFiles(a.materials, sizeMap)
    }));

    emit({ announcements: enrichedAnnouncements }, globals, (data) => {
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
        
        const atts = formatAttachments(a.materials, sizeMap);
        if (atts && atts.length > 0) item.attachments = atts;
        return item;
      }));
    });
  } else if (verb === 'get') {
    let courseId: string;
    let id: string;
    if (argv._[3]) {
      courseId = resolveCourseId(argv._[2]);
      id = decodeClassroomIdentifier(argv._[3]) || argv._[3];
    } else {
      const parsed = parseClassroomUrl(argv._[2]);
      if (parsed.courseId && (parsed.announcementId || parsed.resourceId)) {
        courseId = parsed.courseId;
        id = parsed.announcementId || parsed.resourceId!;
      } else {
        courseId = resolveCourseId(undefined);
        id = decodeClassroomIdentifier(argv._[2]) || argv._[2];
      }
    }
    if (!id) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Announcement ID is required', hint: 'classroom stream get <announcement_id>' });
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(`Fetching announcement ${id}...`, globals);
    const res = await classroom.courses.announcements.get({ courseId, id });
    const a = res.data;
    const fileIds = extractDriveFileIds([a]);
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    const enrichedAnnouncement = {
      ...a,
      files: extractAttachedFiles(a.materials, sizeMap)
    };
    
    emit({ announcement: enrichedAnnouncement }, globals, (data) => {
      console.log(pc.green(`\n✔ Announcement Details:`));
      const item: BlockItem = {
        title: a.text,
        id: a.id,
        details: [
          ['State', a.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(a.state || 'UNKNOWN')],
          ['Posted', a.updateTime || a.creationTime],
          ...(a.creationTime && a.updateTime && a.creationTime !== a.updateTime ? [['Created', a.creationTime] as [string, string]] : []),
          ...(a.alternateLink ? [['Link', pc.blue(pc.underline(a.alternateLink))] as [string, string]] : [])
        ]
      };
      if (isFull) {
        if (a.courseId) item.details!.push(['Course ID', a.courseId]);
        if (a.creatorUserId) item.details!.push(['Creator ID', a.creatorUserId]);
        if (a.scheduledTime) item.details!.push(['Scheduled', a.scheduledTime]);
        if (a.assigneeMode) item.details!.push(['Assignee Mode', a.assigneeMode]);
      }
      
      const atts = formatAttachments(a.materials, sizeMap);
      if (atts && atts.length > 0) item.attachments = atts;
      
      printBlock([item]);
    });
  } else if (verb === 'post') {
    const courseId = resolveCourseId(argv._[2]);
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
