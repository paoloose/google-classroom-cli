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

export async function uploadToDrive(filePath: string, globals: any): Promise<string> {
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

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType
    },
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
