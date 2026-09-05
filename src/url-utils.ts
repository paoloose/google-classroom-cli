export interface ParsedClassroomReference {
  courseId?: string | undefined;
  courseWorkId?: string | undefined;
  materialId?: string | undefined;
  announcementId?: string | undefined;
  topicId?: string | undefined;
  resourceId?: string | undefined;
  resourceType?: 'course' | 'work' | 'material' | 'announcement' | 'topic' | undefined;
  code?: string | undefined;
}

export function decodeClassroomIdentifier(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    if (/^\d+$/.test(decoded)) {
      return decoded;
    }
  } catch {}
  return trimmed;
}

export function parseClassroomUrl(input?: string): ParsedClassroomReference {
  if (!input || typeof input !== 'string') return {};
  const str = input.trim();

  if (str.includes('classroom.google.com') || str.startsWith('http://') || str.startsWith('https://')) {
    try {
      const url = new URL(str.startsWith('http') ? str : `https://${str}`);
      const cjc = url.searchParams.get('cjc') || undefined;
      const pathname = url.pathname;

      let courseId: string | undefined;
      let courseWorkId: string | undefined;
      let materialId: string | undefined;
      let announcementId: string | undefined;
      let topicId: string | undefined;
      let resourceType: 'course' | 'work' | 'material' | 'announcement' | 'topic' | undefined;

      // Extract course id from /c/{courseId}
      const courseMatch = pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
      if (courseMatch) {
        courseId = decodeClassroomIdentifier(courseMatch[1]);
        resourceType = 'course';
      }

      // Extract assignment from /a/{workId}
      const workMatch = pathname.match(/\/a\/([a-zA-Z0-9_-]+)/);
      if (workMatch) {
        courseWorkId = decodeClassroomIdentifier(workMatch[1]);
        resourceType = 'work';
      }

      // Extract material from /m/{materialId}
      const materialMatch = pathname.match(/\/m\/([a-zA-Z0-9_-]+)/);
      if (materialMatch) {
        materialId = decodeClassroomIdentifier(materialMatch[1]);
        resourceType = 'material';
      }

      // Extract announcement/post from /p/{announcementId} or /sa/{announcementId}
      const postMatch = pathname.match(/\/(?:p|sa)\/([a-zA-Z0-9_-]+)/);
      if (postMatch) {
        announcementId = decodeClassroomIdentifier(postMatch[1]);
        resourceType = 'announcement';
      }

      // Extract topic from /tc/{topicId} or /t/{topicId}
      const topicMatch = pathname.match(/\/(?:tc|t)\/([a-zA-Z0-9_-]+)/);
      if (topicMatch) {
        topicId = decodeClassroomIdentifier(topicMatch[1]);
        resourceType = 'topic';
      }

      const resourceId = courseWorkId || materialId || announcementId || topicId;

      return {
        courseId,
        courseWorkId,
        materialId,
        announcementId,
        topicId,
        resourceId,
        resourceType,
        code: cjc
      };
    } catch {}
  }

  const decoded = decodeClassroomIdentifier(str);
  return {
    courseId: decoded,
    resourceId: decoded
  };
}

export function resolveResourceIds(
  arg1?: string,
  arg2?: string,
  preferredType?: 'work' | 'material' | 'announcement' | 'topic'
): { courseId?: string | undefined; resourceId?: string | undefined; code?: string | undefined } {
  if (arg1 && arg2) {
    const p1 = parseClassroomUrl(arg1);
    const p2 = parseClassroomUrl(arg2);
    const courseId = p1.courseId || decodeClassroomIdentifier(arg1);
    const resourceId = (
      preferredType === 'work' ? p2.courseWorkId :
      preferredType === 'material' ? p2.materialId :
      preferredType === 'announcement' ? p2.announcementId :
      preferredType === 'topic' ? p2.topicId : undefined
    ) || p2.resourceId || decodeClassroomIdentifier(arg2);
    return { courseId, resourceId, code: p1.code || p2.code };
  }

  if (arg1 && !arg2) {
    const p = parseClassroomUrl(arg1);
    if (p.courseId && p.resourceId) {
      return { courseId: p.courseId, resourceId: p.resourceId, code: p.code };
    }
    if (p.courseId && !p.resourceId && !p.courseWorkId && !p.materialId && !p.announcementId && !p.topicId) {
      return { courseId: p.courseId, code: p.code };
    }
    const decoded = decodeClassroomIdentifier(arg1);
    return {
      resourceId: p.resourceId || decoded,
      code: p.code
    };
  }

  return {};
}
