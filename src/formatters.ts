import pc from 'picocolors';
import { type BlockItem } from './ui.js';
import { formatAttachments } from './attachments.js';
import { parseDueDate, formatTimeLeft } from './date-utils.js';

export function formatTaskBlock(t: any, now: Date, shouldFetchRelated: boolean, isFull: boolean, sizeMap: Map<string, string>): BlockItem {
  const item: BlockItem = {
    title: t.courseWork.title,
    id: t.courseWork.id,
    details: [
      ['Course', t.course]
    ]
  };

  if (t.courseWork.dueDate) {
    const tDate = parseDueDate(t.courseWork);
    const timeLeft = formatTimeLeft(tDate, now);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
    item.details!.push(['Due', pc.yellow(`${localDateStr} (${timeLeft})`)]);
  }

  if (isFull) {
    item.details!.push(['Course ID', t.courseId]);
    if (t.courseWork.workType) item.details!.push(['Type', t.courseWork.workType]);
    if (t.courseWork.topicId) item.details!.push(['Topic ID', t.courseWork.topicId]);
    if (t.courseWork.creatorUserId) item.details!.push(['Creator ID', t.courseWork.creatorUserId]);
    if (t.courseWork.state) item.details!.push(['State', t.courseWork.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(t.courseWork.state)]);
    if (t.courseWork.maxPoints !== undefined) item.details!.push(['Max Points', String(t.courseWork.maxPoints)]);
    if (t.courseWork.creationTime) item.details!.push(['Created', t.courseWork.creationTime]);
    if (t.courseWork.updateTime) item.details!.push(['Updated', t.courseWork.updateTime]);
    if (t.courseWork.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(t.courseWork.alternateLink))]);
    if (t.courseWork.description) item.details!.push(['Description', t.courseWork.description]);
  }

  const taskAtts = formatAttachments(t.courseWork.materials, sizeMap) || [];
  const subAtts = shouldFetchRelated ? (formatAttachments(t.submission.assignmentSubmission?.attachments, sizeMap) || []) : [];
  const allAtts = [
    ...taskAtts,
    ...subAtts.map((a: string) => `${a} ${pc.dim('(Submitted)')}`)
  ];
  if (allAtts.length > 0) {
    item.attachments = allAtts;
  }

  if (shouldFetchRelated) {
    const subStateColor = t.submission.state === 'TURNED_IN' ? pc.green('TURNED IN') : 
                          t.submission.state === 'RETURNED' ? pc.blue('RETURNED') : 
                          pc.yellow(t.submission.state || 'UNKNOWN');
    const subStr = isFull && t.submission.id ? `${subStateColor} ${pc.dim(`(ID: ${t.submission.id})`)}` : subStateColor;
    item.details!.push(['Submission', subStr]);
    
    if (t.submission.assignedGrade !== undefined || t.submission.draftGrade !== undefined) {
      const grade = t.submission.assignedGrade !== undefined ? t.submission.assignedGrade : t.submission.draftGrade;
      item.details!.push(['Grade', String(grade)]);
    }
  }

  return item;
}

export function formatCourseWorkBlock(cw: any, now: Date, isFull: boolean, sizeMap: Map<string, string>): BlockItem {
  let dueStr = 'No due date';
  if (cw.dueDate) {
    const tDate = parseDueDate(cw);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const localDateStr = `${tDate.getFullYear()}-${pad(tDate.getMonth() + 1)}-${pad(tDate.getDate())} ${pad(tDate.getHours())}:${pad(tDate.getMinutes())}`;
    dueStr = `${localDateStr} (${formatTimeLeft(tDate, now)})`;
  }
  
  const stateColor = cw.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(cw.state || 'UNKNOWN');
  
  const item: BlockItem = {
    title: cw.title || 'Untitled Assignment',
    id: cw.id || undefined,
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

  const atts = formatAttachments(cw.materials || [], sizeMap);
  if (atts) item.attachments = atts;
  
  return item;
}

export function formatTopicBlock(t: any, shouldFetchRelated: boolean, isFull: boolean, sizeMap: Map<string, string>): BlockItem {
  const item: BlockItem = {
    title: t.name || 'Untitled Topic',
    id: t.topicId || undefined,
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
}

export function formatMaterialBlock(m: any, isFull: boolean, isDetailed: boolean, sizeMap: Map<string, string>): BlockItem {
  const stateColor = m.state === 'PUBLISHED' ? pc.green('PUBLISHED') : pc.yellow(m.state || 'UNKNOWN');
  const item: BlockItem = {
    title: m.title || 'Untitled Material',
    id: m.id || undefined,
    details: [['State', stateColor]]
  };

  if (m.creationTime) item.details!.push(['Created', m.creationTime]);
  if (m.updateTime) item.details!.push(['Updated', m.updateTime]);
  if (m.alternateLink) item.details!.push(['Link', pc.blue(pc.underline(m.alternateLink))]);
  if (m.description) item.details!.push(['Description', m.description.split('\n')[0] + (m.description.includes('\n') ? '...' : '')]);

  if (isFull) {
    if (m.courseId) item.details!.push(['Course ID', m.courseId]);
    if (m.topicId) item.details!.push(['Topic ID', m.topicId]);
    if (m.creatorUserId) item.details!.push(['Creator ID', m.creatorUserId]);
    if (m.scheduledTime) item.details!.push(['Scheduled', m.scheduledTime]);
  }

  if (isDetailed && Array.isArray(m.materials) && m.materials.length > 0) {
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

  const atts = formatAttachments(m.materials || [], sizeMap);
  if (atts) item.attachments = atts;
  
  return item;
}

export function formatSubmissionBlock(sub: any, isFull: boolean, sizeMap: Map<string, string>): BlockItem {
  const subStateColor = sub.state === 'TURNED_IN' ? pc.green('TURNED IN') : 
                        sub.state === 'RETURNED' ? pc.blue('RETURNED') : 
                        pc.yellow(sub.state || 'UNKNOWN');
  const subItem: BlockItem = {
    title: `Student ${sub.userId || 'Me'}`,
    id: sub.id || undefined,
    details: [
      ['State', subStateColor]
    ]
  };

  const grade = sub.draftGrade !== undefined ? sub.draftGrade : (sub.assignedGrade !== undefined ? sub.assignedGrade : undefined);
  if (grade !== undefined) {
    subItem.details!.push(['Grade', String(grade)]);
  }

  if (isFull) {
    if (sub.courseId) subItem.details!.push(['Course ID', sub.courseId]);
    if (sub.courseWorkType) subItem.details!.push(['Work Type', sub.courseWorkType]);
    if (sub.creationTime) subItem.details!.push(['Created', sub.creationTime]);
    if (sub.updateTime) subItem.details!.push(['Updated', sub.updateTime]);
    if (sub.late !== undefined) subItem.details!.push(['Late', sub.late ? pc.red('Yes') : pc.green('No')]);
    if (sub.alternateLink) subItem.details!.push(['Link', pc.blue(pc.underline(sub.alternateLink))]);
  }
  
  const subAtts = formatAttachments(sub.assignmentSubmission?.attachments || [], sizeMap);
  if (subAtts && subAtts.length > 0) {
    subItem.attachments = subAtts;
  } else {
    subItem.attachments = [pc.dim('No files attached.')];
  }
  
  return subItem;
}
