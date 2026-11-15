import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { STORAGE_DIR, ensureDataDirectories } from '../config.ts';

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._\- ]/g, '_').trim();
  return base || 'untitled_file';
}

export function saveFileToStorage(buffer: Buffer, originalName: string): {
  storageName: string;
  safeOriginalName: string;
  sizeBytes: number;
  sha256: string;
} {
  ensureDataDirectories();
  const safeOriginalName = sanitizeFilename(originalName);
  const storageName = `${crypto.randomUUID()}_${safeOriginalName}`;
  const fullPath = path.resolve(STORAGE_DIR, storageName);

  // Strict path traversal guard
  if (!fullPath.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error('Invalid storage path.');
  }

  fs.writeFileSync(fullPath, buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    storageName,
    safeOriginalName,
    sizeBytes: buffer.length,
    sha256,
  };
}

export function resolveStoredFilePath(storageName: string): string {
  const safeBase = path.basename(storageName);
  const fullPath = path.resolve(STORAGE_DIR, safeBase);
  if (!fullPath.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error('Invalid file path requested.');
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error('Stored file payload is missing on disk.');
  }
  return fullPath;
}

export function deleteStoredFile(storageName: string): void {
  const safeBase = path.basename(storageName);
  const fullPath = path.resolve(STORAGE_DIR, safeBase);
  if (fullPath.startsWith(STORAGE_DIR + path.sep) && fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}
