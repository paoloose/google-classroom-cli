import { AppError } from '../../cli/foundation/error-map.js';
import { emit, note } from '../../cli/agent/json-mode.js';
import type { GlobalFlags } from '../../cli/foundation/global-flags.js';
import { resolveDateRange, applyDateFilter } from '../../cli/foundation/date-filter.js';
import { getClient } from '../client.js';
import pc from 'picocolors';
import { printBlock, type BlockItem } from '../ui.js';
import { extractDriveFileIds, fetchDriveFileSizes, formatAttachments, extractAttachedFiles } from '../attachments.js';
import { parseDueDate, formatTimeLeft } from '../date-utils.js';
import { resolveCourseId, getActiveCourse } from '../context.js';
import { parseClassroomUrl, decodeClassroomIdentifier, resolveCommandTarget } from '../url-utils.js';
import { formatTaskBlock, formatCourseWorkBlock, formatTopicBlock, formatMaterialBlock, formatSubmissionBlock } from '../formatters.js';
import { promptForCourse, promptForCourseWork } from '../prompts.js';
export async function handleMaterial(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();

  if (verb === 'list') {
    const courseId = resolveCourseId(argv._[2]);
    const res = await classroom.courses.courseWorkMaterials.list({ courseId });
    const raw = res.data.courseWorkMaterial || [];
    const range = resolveDateRange(globals.from, globals.last);
    const materials = applyDateFilter(raw, range, (m: any) => m.updateTime);
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;

    const fileIds = extractDriveFileIds(materials);
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    const enrichedMaterials = materials.map((m: any) => ({
      ...m,
      files: extractAttachedFiles(m.materials, sizeMap)
    }));

    emit({ materials: enrichedMaterials }, globals, (data) => {
      if (data.materials.length === 0) {
        console.log(pc.yellow('No materials found.'));
        return;
      }
      printBlock(data.materials.map((m: any) => {
        const stateColor = m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN');
        const item: BlockItem = {
          title: m.title,
          id: m.id,
          details: [['State', stateColor]]
        };

        // Default tier - relevant fields visible without opt-ins.
        if (m.creationTime) item.details!.push(['Created', m.creationTime]);
        if (m.updateTime) item.details!.push(['Updated', m.updateTime]);
        if (m.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
        if (m.description) item.details!.push(['Description', m.description.split('\n')[0] + (m.description.includes('\n') ? '...' : '')]);

        // --full - exhaustive API metadata.
        if (isFull) {
          if (m.courseId) item.details!.push(['Course ID', m.courseId]);
          if (m.topicId) item.details!.push(['Topic ID', m.topicId]);
          if (m.creatorUserId) item.details!.push(['Creator ID', m.creatorUserId]);
          if (m.scheduledTime) item.details!.push(['Scheduled', m.scheduledTime]);
        }

        // --full also includes per-attachment breakdown beyond the standard
        // attachment summary (counts + per-type tallies).
        if (isFull && Array.isArray(m.materials) && m.materials.length > 0) {
          const files = Array.isArray(m.files) ? m.files : [];
          const driveCount = files.filter((f: any) => f.type === 'driveFile').length;
          const linkCount = files.filter((f: any) => f.type === 'link').length;
          const youtubeCount = files.filter((f: any) => f.type === 'youtube').length;
          const formCount = files.filter((f: any) => f.type === 'form').length;
          const otherCount = files.length - driveCount - linkCount - youtubeCount - formCount;
          const tally: string[] = [];
          if (driveCount) tally.push(`${driveCount} file${driveCount === 1 ? '' : 's'}`);
          if (linkCount) tally.push(`${linkCount} link${linkCount === 1 ? '' : 's'}`);
          if (youtubeCount) tally.push(`${youtubeCount} video${youtubeCount === 1 ? '' : 's'}`);
          if (formCount) tally.push(`${formCount} form${formCount === 1 ? '' : 's'}`);
          if (otherCount > 0) tally.push(`${otherCount} other`);
          if (tally.length > 0) item.details!.push(['Attachments', tally.join(', ')]);

          if (m.materials.some((att: any) => att.shareMode)) {
            const shareModes = Array.from(new Set(m.materials.map((att: any) => att.shareMode).filter(Boolean)));
            if (shareModes.length > 0) item.details!.push(['Share Mode', shareModes.join(', ')]);
          }
        }

        const atts = formatAttachments(m.materials, sizeMap);
        if (atts) item.attachments = atts;
        return item;
      }));
    });
  } else if (verb === 'get') {
    const target = resolveCommandTarget(argv._[2], argv._[3], 'material');
    const courseId = target.courseId || resolveCourseId(undefined);
    const materialId = target.resourceId;
    if (!materialId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Material ID is required', hint: 'classroom material get <material_id>' });
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(`Fetching material ${materialId}...`, globals);
    const res = await classroom.courses.courseWorkMaterials.get({ courseId, id: materialId });
    const m = res.data;
    const fileIds = extractDriveFileIds([m]);
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    const enrichedMat = {
      ...m,
      files: extractAttachedFiles(m.materials || [], sizeMap)
    };
    
    emit({ material: enrichedMat }, globals, (data) => {
      console.log(pc.green(`\n✔ Material Details:`));
      const mat = data.material;
      const stateColor = mat.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(mat.state || 'UNKNOWN');
      const item: BlockItem = {
        title: mat.title || 'Untitled Material',
        id: mat.id || undefined,
        details: [
          ['State', stateColor],
          ...(mat.creationTime ? [['Created', mat.creationTime] as [string, string]] : []),
          ...(mat.updateTime ? [['Updated', mat.updateTime] as [string, string]] : []),
          ...(mat.alternateLink ? [['Link', pc.blue(pc.underline(mat.alternateLink))] as [string, string]] : []),
          ...(mat.description ? [['Description', mat.description] as [string, string]] : [])
        ]
      };
      if (isFull) {
        if (mat.courseId) item.details!.push(['Course ID', mat.courseId]);
        if (mat.topicId) item.details!.push(['Topic ID', mat.topicId]);
        if (mat.creatorUserId) item.details!.push(['Creator ID', mat.creatorUserId]);
        if (mat.scheduledTime) item.details!.push(['Scheduled', mat.scheduledTime]);
      }
      
      const atts = formatAttachments(mat.materials || [], sizeMap);
      if (atts) item.attachments = atts;
      printBlock([item]);
    });
  } else if (verb === 'create') {
    const courseId = resolveCourseId(argv._[2]);
    const title = argv['title'];
    const topicId = argv['topic'];
    const links = Array.isArray(argv['link']) ? argv['link'] : (argv['link'] ? [argv['link']] : []);
    const files = Array.isArray(argv['file']) ? argv['file'] : (argv['file'] ? [argv['file']] : []);
    
    if (!title) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--title is required' });
    
    const requestBody: any = { title, state: 'PUBLISHED' };
    if (topicId) requestBody.topicId = topicId;
    
    const materialsArr: any[] = [];
    
    for (const link of links) {
      materialsArr.push({ link: { url: link } });
    }
    
    if (files.length > 0) {
      // Need to dynamically import to avoid circular dep if any, or just import at top.
      const { uploadToDrive } = await import('./drive.js');
      for (const file of files) {
        note(`Uploading ${file} to Google Drive...`, globals);
        const fileId = await uploadToDrive(file, globals);
        materialsArr.push({ driveFile: { driveFile: { id: fileId }, shareMode: 'VIEW' } });
      }
    }
    
    if (materialsArr.length > 0) {
      requestBody.materials = materialsArr;
    }

    const res = await classroom.courses.courseWorkMaterials.create({ courseId, requestBody });
    emit({ material: res.data }, globals, (data) => console.log(`Created material: ${data.material.title}`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
  }
}

