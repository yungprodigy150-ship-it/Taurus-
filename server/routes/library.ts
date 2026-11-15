import express, { Router } from 'express';
import type { LibraryCategory, LibraryFileRecord } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';
import { deleteStoredFile, resolveStoredFilePath, saveFileToStorage } from '../services/storage.ts';

export const libraryRouter = Router();
libraryRouter.use(requireAuth);

const VALID_CATEGORIES: LibraryCategory[] = [
  'source_code',
  'documents',
  'images',
  'videos',
  'business_assets',
  'research',
  'project_files',
  'generated_materials',
];

function mapFile(r: Record<string, unknown>): LibraryFileRecord {
  return {
    id: String(r.id),
    originalName: String(r.original_name),
    category: r.category as LibraryCategory,
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes),
    sha256: String(r.sha256),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    description: String(r.description || ''),
    uploadedBy: String(r.uploaded_by),
    uploadedByName: r.uploaded_by_name ? String(r.uploaded_by_name) : undefined,
    createdAt: String(r.created_at),
  };
}

libraryRouter.get('/', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : null;
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
  const db = getDb();

  let sql = `
    SELECT lf.*, p.name as project_name, u.name as uploaded_by_name
    FROM library_files lf
    LEFT JOIN projects p ON p.id = lf.project_id
    LEFT JOIN users u ON u.id = lf.uploaded_by
  `;
  const conditions: string[] = [];
  const params: string[] = [];

  if (category && VALID_CATEGORIES.includes(category as LibraryCategory)) {
    conditions.push('lf.category = ?');
    params.push(category);
  }
  if (projectId) {
    conditions.push('lf.project_id = ?');
    params.push(projectId);
  }
  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }
  sql += ' ORDER BY lf.created_at DESC';

  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  res.json({ files: rows.map(mapFile) });
});

// Binary upload endpoint using express.raw up to 25MB
libraryRouter.post(
  '/upload',
  requireRole(['owner', 'operator']),
  express.raw({ type: '*/*', limit: '25mb' }),
  (req: AuthenticatedRequest, res) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: 'Non-empty file payload is required.' });
      return;
    }

    const rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'upload.bin'));
    const rawCategory = String(req.headers['x-file-category'] || 'project_files') as LibraryCategory;
    const category: LibraryCategory = VALID_CATEGORIES.includes(rawCategory) ? rawCategory : 'project_files';
    const mimeType = String(req.headers['x-file-mime'] || 'application/octet-stream').slice(0, 120);
    const projectId = req.headers['x-project-id'] ? String(req.headers['x-project-id']) : null;
    const description = req.headers['x-file-description']
      ? decodeURIComponent(String(req.headers['x-file-description']))
      : '';

    const stored = saveFileToStorage(body, rawName);
    const db = getDb();
    const id = newId('fil');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO library_files (
        id, original_name, storage_name, category, mime_type,
        size_bytes, sha256, project_id, description, uploaded_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      stored.safeOriginalName,
      stored.storageName,
      category,
      mimeType,
      stored.sizeBytes,
      stored.sha256,
      projectId || null,
      description,
      req.user!.id,
      now
    );

    logEvent({
      level: 'success',
      subsystem: 'LIBRARY',
      action: 'file.uploaded',
      message: `Persisted file "${stored.safeOriginalName}" (${stored.sizeBytes} bytes) to Library storage.`,
      entityType: 'library_file',
      entityId: id,
      actorId: req.user!.id,
      actorName: req.user!.name,
    });

    const row = db
      .prepare(
        `SELECT lf.*, p.name as project_name, u.name as uploaded_by_name
         FROM library_files lf
         LEFT JOIN projects p ON p.id = lf.project_id
         LEFT JOIN users u ON u.id = lf.uploaded_by
         WHERE lf.id = ?`
      )
      .get(id) as Record<string, unknown>;

    res.status(201).json({ file: mapFile(row) });
  }
);

// Create text/code file directly from UI
libraryRouter.post('/text', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { filename, content, category, projectId, description } = req.body as {
    filename?: string;
    content?: string;
    category?: LibraryCategory;
    projectId?: string | null;
    description?: string;
  };

  if (!filename?.trim() || content === undefined) {
    res.status(400).json({ error: 'Filename and content are required.' });
    return;
  }

  const buf = Buffer.from(content, 'utf8');
  const stored = saveFileToStorage(buf, filename.trim());
  const targetCat = category && VALID_CATEGORIES.includes(category) ? category : 'documents';
  const ext = filename.trim().split('.').pop()?.toLowerCase();
  const mimeType =
    ext === 'json'
      ? 'application/json'
      : ext === 'md'
        ? 'text/markdown'
        : ext === 'html'
          ? 'text/html'
          : 'text/plain';

  const db = getDb();
  const id = newId('fil');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO library_files (
      id, original_name, storage_name, category, mime_type,
      size_bytes, sha256, project_id, description, uploaded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    stored.safeOriginalName,
    stored.storageName,
    targetCat,
    mimeType,
    stored.sizeBytes,
    stored.sha256,
    projectId || null,
    (description || '').trim(),
    req.user!.id,
    now
  );

  logEvent({
    level: 'success',
    subsystem: 'LIBRARY',
    action: 'file.created',
    message: `Created persistent file "${stored.safeOriginalName}" in Library.`,
    entityType: 'library_file',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const row = db
    .prepare(
      `SELECT lf.*, p.name as project_name, u.name as uploaded_by_name
       FROM library_files lf
       LEFT JOIN projects p ON p.id = lf.project_id
       LEFT JOIN users u ON u.id = lf.uploaded_by
       WHERE lf.id = ?`
    )
    .get(id) as Record<string, unknown>;

  res.status(201).json({ file: mapFile(row) });
});

libraryRouter.get('/:id/content', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM library_files WHERE id = ?').get(req.params.id) as
    | { original_name: string; storage_name: string; mime_type: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Library file not found.' });
    return;
  }
  try {
    const filePath = resolveStoredFilePath(row.storage_name);
    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${row.original_name}"`);
    res.sendFile(filePath);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'File missing on disk.' });
  }
});

libraryRouter.get('/:id/download', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM library_files WHERE id = ?').get(req.params.id) as
    | { original_name: string; storage_name: string; mime_type: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Library file not found.' });
    return;
  }
  try {
    const filePath = resolveStoredFilePath(row.storage_name);
    res.download(filePath, row.original_name);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'File missing on disk.' });
  }
});

libraryRouter.delete('/:id', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const row = db.prepare('SELECT original_name, storage_name FROM library_files WHERE id = ?').get(req.params.id) as
    | { original_name: string; storage_name: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Library file not found.' });
    return;
  }

  db.prepare('DELETE FROM library_files WHERE id = ?').run(req.params.id);
  deleteStoredFile(row.storage_name);

  logEvent({
    level: 'warn',
    subsystem: 'LIBRARY',
    action: 'file.deleted',
    message: `Removed file "${row.original_name}" from Library storage.`,
    entityType: 'library_file',
    entityId: req.params.id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.json({ ok: true });
});
