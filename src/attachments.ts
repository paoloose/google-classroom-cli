import pc from 'picocolors';
import { getDriveClient } from './client.js';

export function formatBytes(bytesStr?: string | number | null): string | null {
  if (!bytesStr) return null;
  const bytes = typeof bytesStr === 'string' ? parseInt(bytesStr, 10) : bytesStr;
  if (isNaN(bytes) || bytes <= 0) return null;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const rawVal = bytes / Math.pow(k, i);
  const decimals = (rawVal < 10 && i > 0) ? 2 : 1;
  const val = parseFloat(rawVal.toFixed(decimals));
  return `${val} ${sizes[i]}`;
}

export function extractDriveFileIds(items: any[]): string[] {
  const ids: string[] = [];

  function scan(obj: any) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const el of obj) scan(el);
      return;
    }
    if (obj.driveFile) {
      const file = obj.driveFile.driveFile || obj.driveFile;
      if (file && typeof file === 'object' && file.id) {
        ids.push(file.id);
      }
    }
    if (Array.isArray(obj.materials)) scan(obj.materials);
    if (Array.isArray(obj.attachments)) scan(obj.attachments);
    if (obj.assignmentSubmission && Array.isArray(obj.assignmentSubmission.attachments)) {
      scan(obj.assignmentSubmission.attachments);
    }
  }

  for (const item of items) {
    scan(item);
  }

  return Array.from(new Set(ids.filter(Boolean)));
}

export async function fetchDriveFileSizes(fileIds: string[]): Promise<Map<string, string>> {
  const sizeMap = new Map<string, string>();
  const uniqueIds = Array.from(new Set(fileIds.filter(Boolean)));
  if (uniqueIds.length === 0) return sizeMap;

  try {
    const drive = await getDriveClient();
    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          const res = await drive.files.get({ fileId: id, fields: 'id, size' });
          if (res.data.size) {
            sizeMap.set(id, res.data.size);
          }
        } catch {
          // Ignore individual drive error (e.g. 404 or permissions)
        }
      })
    );
  } catch {
    // Ignore drive client error
  }
  return sizeMap;
}

export function formatAttachmentItem(att: any, sizeMap?: Map<string, string>): string {
  const file = att.driveFile?.driveFile || att.driveFile;
  if (file) {
    const fileId = file.id;
    const title = file.title || 'Untitled File';
    const size = fileId && sizeMap ? formatBytes(sizeMap.get(fileId)) : null;
    const metaParts: string[] = [];
    if (fileId) metaParts.push(`ID: ${fileId}`);
    if (size) metaParts.push(size);
    const metaStr = metaParts.length > 0 ? ` ${pc.dim(`(${metaParts.join(' · ')})`)}` : '';
    return `📄 ${title}${metaStr}`;
  }
  if (att.link) {
    const linkTitle = att.link.title ? `${att.link.title} ` : '';
    return `🔗 ${linkTitle}${pc.blue(pc.underline(att.link.url))}`;
  }
  if (att.youtubeVideo) {
    const link = att.youtubeVideo.alternateLink ? ` ${pc.dim(`(${att.youtubeVideo.alternateLink})`)}` : '';
    return `▶️ ${att.youtubeVideo.title || 'YouTube Video'}${link}`;
  }
  if (att.form) {
    return `📝 ${att.form.title || 'Google Form'} ${pc.blue(pc.underline(att.form.formUrl))}`;
  }
  return 'Unknown Attachment';
}

export function formatAttachments(materials: any[], sizeMap?: Map<string, string>): string[] | undefined {
  if (!materials || materials.length === 0) return undefined;
  return materials.map(att => formatAttachmentItem(att, sizeMap));
}

export interface AttachedFile {
  type: 'driveFile' | 'link' | 'youtube' | 'form' | 'unknown';
  id?: string;
  title?: string;
  size?: string | null;
  url?: string;
  alternateLink?: string;
}

export function extractAttachedFiles(materials: any[], sizeMap?: Map<string, string>): AttachedFile[] {
  if (!materials || !Array.isArray(materials)) return [];
  return materials.map(att => {
    const file = att.driveFile?.driveFile || att.driveFile;
    if (file) {
      const size = file.id && sizeMap ? formatBytes(sizeMap.get(file.id)) : null;
      return {
        type: 'driveFile' as const,
        id: file.id,
        title: file.title,
        alternateLink: file.alternateLink,
        size
      };
    }
    if (att.link) {
      return {
        type: 'link' as const,
        title: att.link.title,
        url: att.link.url
      };
    }
    if (att.youtubeVideo) {
      return {
        type: 'youtube' as const,
        id: att.youtubeVideo.id,
        title: att.youtubeVideo.title,
        url: att.youtubeVideo.alternateLink
      };
    }
    if (att.form) {
      return {
        type: 'form' as const,
        title: att.form.title,
        url: att.form.formUrl
      };
    }
    return { type: 'unknown' as const };
  });
}
