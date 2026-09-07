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
export async function handleTopic(verb: string | undefined, globals: GlobalFlags, argv: any) {
  const classroom = await getClient();

  if (verb === 'list') {
    const courseId = resolveCourseId(argv._[2]);
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;

    note(shouldFetchRelated ? `Fetching topics and related resources for course ${courseId}...` : `Fetching topics for course ${courseId}...`, globals);
    const [res, cwRes, matRes] = await Promise.all([
      classroom.courses.topics.list({ courseId }),
      shouldFetchRelated ? classroom.courses.courseWork.list({ courseId }).catch(() => ({ data: { courseWork: [] } })) : Promise.resolve({ data: { courseWork: [] } }),
      shouldFetchRelated ? classroom.courses.courseWorkMaterials.list({ courseId }).catch(() => ({ data: { courseWorkMaterial: [] } })) : Promise.resolve({ data: { courseWorkMaterial: [] } })
    ]);

    const raw = res.data.topic || [];
    const allCw = cwRes.data.courseWork || [];
    const allMat = matRes.data.courseWorkMaterial || [];

    const range = resolveDateRange(globals.from, globals.last);
    const topics = applyDateFilter(raw, range, (t: any) => t.updateTime);

    const fileIds = shouldFetchRelated ? extractDriveFileIds([...allCw, ...allMat]) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();

    const enrichedTopics = topics.map((t: any) => {
      if (!shouldFetchRelated) return t;
      const topicMat = allMat.filter((m: any) => m.topicId === t.topicId).map((m: any) => ({
        ...m,
        files: extractAttachedFiles(m.materials, sizeMap)
      }));
      const topicCw = allCw.filter((cw: any) => cw.topicId === t.topicId).map((cw: any) => ({
        ...cw,
        files: extractAttachedFiles(cw.materials, sizeMap)
      }));
      return {
        ...t,
        materials: topicMat,
        coursework: topicCw
      };
    });

    emit({ topics: enrichedTopics }, globals, (data) => {
      if (data.topics.length === 0) {
        console.log(pc.yellow('No topics found.'));
        return;
      }
      printBlock(data.topics.map((t: any) => {
        const item: BlockItem = {
          title: t.name,
          id: t.topicId,
          details: [
            ...(t.updateTime ? [['Updated', t.updateTime] as [string, string]] : [])
          ]
        };
        if (isFull) {
          if (t.courseId) item.details!.unshift(['Course ID', t.courseId]);
        }
        if (shouldFetchRelated) {
          const relatedLines: string[] = [];
          if (t.materials && t.materials.length > 0) {
            for (const m of t.materials) {
              relatedLines.push(`📁 Material: ${m.title}`);
              const atts = formatAttachments(m.materials, sizeMap);
              if (atts) {
                for (const att of atts) relatedLines.push(`   ${att}`);
              }
            }
          }
          if (t.coursework && t.coursework.length > 0) {
            for (const cw of t.coursework) {
              relatedLines.push(`📝 Assignment: ${cw.title}`);
              const atts = formatAttachments(cw.materials, sizeMap);
              if (atts) {
                for (const att of atts) relatedLines.push(`   ${att}`);
              }
            }
          }
          if (relatedLines.length > 0) {
            item.attachments = relatedLines;
          }
        }
        return item;
      }));
    });
  } else if (verb === 'get') {
    const target = resolveCommandTarget(argv._[2], argv._[3], 'topic');
    const courseId = target.courseId || resolveCourseId(undefined);
    const topicId = target.resourceId;
    if (!topicId) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: 'Topic ID is required', hint: 'classroom topic get <topic_id>' });
    
    const shouldFetchRelated = argv.related || globals.json;
    const isFull = !!argv.full;
    
    note(shouldFetchRelated ? `Fetching topic ${topicId} and its materials...` : `Fetching topic ${topicId}...`, globals);
    const [topicRes, cwRes, matRes] = await Promise.all([
      classroom.courses.topics.get({ courseId, id: topicId }),
      shouldFetchRelated ? classroom.courses.courseWork.list({ courseId }).catch(() => ({ data: { courseWork: [] } })) : Promise.resolve({ data: { courseWork: [] } }),
      shouldFetchRelated ? classroom.courses.courseWorkMaterials.list({ courseId }).catch(() => ({ data: { courseWorkMaterial: [] } })) : Promise.resolve({ data: { courseWorkMaterial: [] } })
    ]);
    
    const topic = topicRes.data;
    const rawCw = (cwRes.data.courseWork || []).filter(cw => cw.topicId === topicId);
    const rawMat = (matRes.data.courseWorkMaterial || []).filter(m => m.topicId === topicId);
    const range = resolveDateRange(globals.from, globals.last);
    const coursework = applyDateFilter(rawCw, range, (cw: any) => cw.dueDate ? parseDueDate(cw) : cw.updateTime);
    const materials = applyDateFilter(rawMat, range, (m: any) => m.updateTime);
    
    const fileIds = shouldFetchRelated ? extractDriveFileIds([coursework, materials]) : [];
    const sizeMap = fileIds.length > 0 ? await fetchDriveFileSizes(fileIds) : new Map<string, string>();
    
    const enrichedCw = coursework.map((cw: any) => ({
      ...cw,
      files: extractAttachedFiles(cw.materials, sizeMap)
    }));
    const enrichedMat = materials.map((m: any) => ({
      ...m,
      files: extractAttachedFiles(m.materials, sizeMap)
    }));

    const now = new Date();
    emit({ topic, coursework: enrichedCw, materials: enrichedMat }, globals, (data) => {
      if (shouldFetchRelated) console.log(pc.green(`\n✔ Topic:`));
      const topicItem: BlockItem = { 
        title: data.topic.name || 'Untitled Topic', 
        id: data.topic.topicId || undefined,
        details: [
          ...(data.topic.updateTime ? [['Updated', data.topic.updateTime] as [string, string]] : [])
        ]
      };
      if (isFull) {
        if (data.topic.courseId) topicItem.details!.unshift(['Course ID', data.topic.courseId]);
      }
      printBlock([topicItem]);
      
      if (shouldFetchRelated) {
        if (data.materials.length > 0) {
          console.log(pc.green(`\n✔ Materials under this topic:`));
          printBlock(data.materials.map((m: any) => {
            const stateColor = m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN');
            const item: BlockItem = { 
              title: m.title, 
              id: m.id,
              details: [
                ['State', stateColor],
                ...(m.creationTime ? [['Created', m.creationTime] as [string, string]] : []),
                ...(m.updateTime ? [['Updated', m.updateTime] as [string, string]] : []),
                ...(m.alternateLink ? [['Link', pc.blue(pc.underline(m.alternateLink))] as [string, string]] : []),
                ...(m.description ? [['Description', m.description] as [string, string]] : [])
              ]
            };
            if (isFull) {
              if (m.courseId) item.details!.push(['Course ID', m.courseId]);
              if (m.topicId) item.details!.push(['Topic ID', m.topicId]);
              if (m.creatorUserId) item.details!.push(['Creator ID', m.creatorUserId]);
              if (m.scheduledTime) item.details!.push(['Scheduled', m.scheduledTime]);
            }
            const atts = formatAttachments(m.materials, sizeMap);
            if (atts) item.attachments = atts;
            return item;
          }));
        } else {
          console.log(pc.dim('\nNo materials under this topic.'));
        }
        
        if (data.coursework.length > 0) {
          console.log(pc.green(`\n✔ Assignments under this topic:`));
          printBlock(data.coursework.map((cw: any) => {
            let dueStr = 'No due date';
            if (cw.dueDate) {
              const tDate = parseDueDate(cw);
              const pad = (n: number) => n.toString().padStart(2, '0');
              const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
              dueStr = `${localDateStr} (${formatTimeLeft(tDate, now)})`;
            }
            const stateColor = cw.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(cw.state || 'UNKNOWN');
            const item: BlockItem = { 
              title: cw.title, 
              id: cw.id,
              details: [
                ['State', stateColor],
                ['Due', cw.dueDate ? pc.yellow(dueStr) : dueStr],
                ...(cw.maxPoints !== undefined ? [['Max Points', String(cw.maxPoints)] as [string, string]] : []),
                ...(cw.creationTime ? [['Created', cw.creationTime] as [string, string]] : []),
                ...(cw.updateTime ? [['Updated', cw.updateTime] as [string, string]] : []),
                ...(cw.alternateLink ? [['Link', pc.blue(pc.underline(cw.alternateLink))] as [string, string]] : []),
                ...(cw.description ? [['Description', cw.description] as [string, string]] : [])
              ]
            };
            if (isFull) {
              if (cw.courseId) item.details!.push(['Course ID', cw.courseId]);
              if (cw.workType) item.details!.push(['Type', cw.workType]);
              if (cw.topicId) item.details!.push(['Topic ID', cw.topicId]);
              if (cw.creatorUserId) item.details!.push(['Creator ID', cw.creatorUserId]);
              if (cw.submissionModificationMode) item.details!.push(['Submission Mode', cw.submissionModificationMode]);
              if (cw.assigneeMode) item.details!.push(['Assignee Mode', cw.assigneeMode]);
              if (cw.scheduledTime) item.details!.push(['Scheduled', cw.scheduledTime]);
            }
            const atts = formatAttachments(cw.materials, sizeMap);
            if (atts) item.attachments = atts;
            return item;
          }));
        } else {
          console.log(pc.dim('\nNo assignments under this topic.'));
        }
      }
    });
  } else if (verb === 'create') {
    const courseId = resolveCourseId(argv._[2]);
    const name = argv['name'];
    if (!name) throw new AppError('MISSING_ARG', { name: 'MissingArg', human: '--name is required' });
    const res = await classroom.courses.topics.create({ courseId, requestBody: { name } });
    emit({ topic: res.data }, globals, (data) => console.log(`Created topic: ${data.topic.name}`));
  } else {
    throw new AppError('UNKNOWN_COMMAND', { name: 'UnknownCommand', human: `Unknown verb: ${verb}` });
  }
}

