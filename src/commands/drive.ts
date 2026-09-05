import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { AppError } from '../../cli/foundation/error-map.js';
import { getDriveClient } from '../client.js';

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] || 'application/octet-stream';
}

export async function uploadToDrive(filePath: string, globals: any, courseId?: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new AppError('FILE_NOT_FOUND', { name: 'FileNotFound', human: `File not found: ${filePath}` });
  }

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new AppError('NOT_A_FILE', { name: 'NotAFile', human: `Path is not a regular file: ${filePath}` });
  }

  const drive = await getDriveClient();
  const fileName = basename(filePath);
  const mimeType = getMimeType(filePath);

  const requestBody: any = {
    name: fileName,
    mimeType
  };

  if (courseId) {
    try {
      const { getClient } = await import('../client.js');
      const classroom = await getClient();
      const course = (await classroom.courses.get({ id: courseId })).data;
      
      const folderName = (course.section ? `${course.name} ${course.section}` : course.name) || '';
      
      if (folderName) {
        const search = await drive.files.list({
          q: `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id)'
        });
        
        const firstFile = search.data.files?.[0];
        if (firstFile?.id) {
          requestBody.parents = [firstFile.id];
        }
      }
    } catch (error) {
      // Ignore errors and fallback to root "My Drive"
    }
  }

  const res = await drive.files.create({
    requestBody,
    media: {
      mimeType,
      body: createReadStream(filePath)
    },
    fields: 'id'
  });

  if (!res.data.id) {
    throw new AppError('UPLOAD_FAILED', { name: 'UploadFailed', human: 'Failed to upload file to Google Drive (no ID returned)' });
  }

  return res.data.id;
}

import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export async function downloadFromDrive(fileId: string, destPath?: string, globals?: any): Promise<string> {
  const drive = await getDriveClient();

  let targetDest = destPath;
  let mimeType: string | undefined;

  try {
    const meta = await drive.files.get({ fileId, fields: 'name, mimeType' });
    mimeType = meta.data.mimeType || undefined;
    if (!targetDest) {
      if (meta.data.name) targetDest = meta.data.name;
    } else if (targetDest.endsWith('/') || (existsSync(targetDest) && statSync(targetDest).isDirectory())) {
      const originalName = meta.data.name || 'downloaded_file';
      targetDest = join(targetDest, originalName);
    }
  } catch {
    // Fallback
  }

  if (!targetDest) {
    targetDest = 'downloaded_file';
  }

  const googleAppsExportMap: Record<string, { mime: string; ext: string }> = {
    'application/vnd.google-apps.document': { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.spreadsheet': { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: '.pdf' },
    'application/vnd.google-apps.drawing': { mime: 'application/pdf', ext: '.pdf' }
  };

  if (mimeType && googleAppsExportMap[mimeType]) {
    const exportInfo = googleAppsExportMap[mimeType]!;
    if (!targetDest.endsWith(exportInfo.ext)) {
      targetDest += exportInfo.ext;
    }
    const res = await drive.files.export(
      { fileId, mimeType: exportInfo.mime },
      { responseType: 'stream' }
    );
    await pipeline(res.data, createWriteStream(targetDest));
    return targetDest;
  }

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await pipeline(res.data, createWriteStream(targetDest));
  return targetDest;
}
