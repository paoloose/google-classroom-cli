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
      
      // Google Classroom names the Drive folder after the course name and section
      const folderName = course.section ? `${course.name} ${course.section}` : course.name;
      
      const search = await drive.files.list({
        q: `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)'
      });
      
      if (search.data.files && search.data.files.length > 0) {
        requestBody.parents = [search.data.files[0].id];
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

  if (!targetDest) {
    try {
      const meta = await drive.files.get({ fileId, fields: 'name' });
      if (meta.data.name) {
        targetDest = meta.data.name;
      }
    } catch {
      // Fallback
    }
  } else if (targetDest.endsWith('/') || (existsSync(targetDest) && statSync(targetDest).isDirectory())) {
    try {
      const meta = await drive.files.get({ fileId, fields: 'name' });
      const originalName = meta.data.name || 'downloaded_file';
      targetDest = join(targetDest, originalName);
    } catch {
      targetDest = join(targetDest, 'downloaded_file');
    }
  }

  if (!targetDest) {
    targetDest = 'downloaded_file';
  }

  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await pipeline(res.data, createWriteStream(targetDest));
  return targetDest;
}
