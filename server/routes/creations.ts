import { Router } from 'express';
import type { CreationCategory, CreationContentType, CreationRecord } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';

export const creationsRouter = Router();
creationsRouter.use(requireAuth);

const VALID_CATEGORIES: CreationCategory[] = [
  'website',
  'application',
  'business',
  'document',
  'design',
  'media',
  'other',
];

const VALID_TYPES: CreationContentType[] = ['html', 'markdown', 'json', 'text', 'file'];

function mapCreation(r: Record<string, unknown>): CreationRecord {
  return {
    id: String(r.id),
    title: String(r.title),
    category: r.category as CreationCategory,
    description: String(r.description || ''),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    commandId: r.command_id ? String(r.command_id) : null,
    contentType: r.content_type as CreationContentType,
    contentBody: String(r.content_body || ''),
    libraryFileId: r.library_file_id ? String(r.library_file_id) : null,
    status: r.status as CreationRecord['status'],
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

creationsRouter.get('/', (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : null;
  const db = getDb();
  const rows = (
    category && VALID_CATEGORIES.includes(category as CreationCategory)
      ? db
          .prepare(`
            SELECT c.*, p.name as project_name
            FROM creations c
            LEFT JOIN projects p ON p.id = c.project_id
            WHERE c.category = ?
            ORDER BY c.updated_at DESC
          `)
          .all(category)
      : db
          .prepare(`
            SELECT c.*, p.name as project_name
            FROM creations c
            LEFT JOIN projects p ON p.id = c.project_id
            ORDER BY c.updated_at DESC
          `)
          .all()
  ) as Array<Record<string, unknown>>;

  res.json({ creations: rows.map(mapCreation) });
});

creationsRouter.post('/', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { title, category, description, projectId, contentType, contentBody } = req.body as {
    title?: string;
    category?: CreationCategory;
    description?: string;
    projectId?: string | null;
    contentType?: CreationContentType;
    contentBody?: string;
  };

  if (!title?.trim()) {
    res.status(400).json({ error: 'Creation title is required.' });
    return;
  }

  const targetCategory = category && VALID_CATEGORIES.includes(category) ? category : 'other';
  const targetType = contentType && VALID_TYPES.includes(contentType) ? contentType : 'markdown';

  const db = getDb();
  const id = newId('crt');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO creations (
      id, title, category, description, project_id, command_id,
      content_type, content_body, library_file_id, status,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, 'ready', ?, ?, ?)
  `).run(
    id,
    title.trim(),
    targetCategory,
    (description || '').trim(),
    projectId || null,
    targetType,
    contentBody || '',
    req.user!.id,
    now,
    now
  );

  logEvent({
    level: 'success',
    subsystem: 'FORGE',
    action: 'creation.registered',
    message: `Registered creation "${title.trim()}" (${targetCategory}).`,
    entityType: 'creation',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const row = db
    .prepare('SELECT c.*, p.name as project_name FROM creations c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?')
    .get(id) as Record<string, unknown>;
  res.status(201).json({ creation: mapCreation(row) });
});

creationsRouter.get('/:id/download', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM creations WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Creation not found.' });
    return;
  }

  const contentType = String(row.content_type);
  const titleSlug = String(row.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'taurus-creation';

  const ext =
    contentType === 'html' ? 'html' : contentType === 'markdown' ? 'md' : contentType === 'json' ? 'json' : 'txt';
  const mime =
    contentType === 'html'
      ? 'text/html; charset=utf-8'
      : contentType === 'json'
        ? 'application/json; charset=utf-8'
        : 'text/plain; charset=utf-8';

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${titleSlug}.${ext}"`);
  res.send(String(row.content_body || ''));
});

creationsRouter.delete('/:id', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM creations WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Creation not found.' });
    return;
  }
  logEvent({
    level: 'warn',
    subsystem: 'FORGE',
    action: 'creation.deleted',
    message: `Deleted creation ${req.params.id}.`,
    entityType: 'creation',
    entityId: req.params.id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });
  res.json({ ok: true });
});
