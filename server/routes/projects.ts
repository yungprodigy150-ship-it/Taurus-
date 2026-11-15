import { Router } from 'express';
import type { ProjectRecord, ProjectStatus } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

function mapProject(r: Record<string, unknown>): ProjectRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    description: String(r.description || ''),
    category: String(r.category || 'General'),
    status: r.status as ProjectStatus,
    ownerId: String(r.owner_id),
    ownerName: r.owner_name ? String(r.owner_name) : undefined,
    commandCount: Number(r.command_count ?? 0),
    taskCount: Number(r.task_count ?? 0),
    creationCount: Number(r.creation_count ?? 0),
    fileCount: Number(r.file_count ?? 0),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    archivedAt: r.archived_at ? String(r.archived_at) : null,
  };
}

projectsRouter.get('/', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT p.*, u.name as owner_name,
        (SELECT COUNT(*) FROM commands c WHERE c.project_id = p.id) as command_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM creations cr WHERE cr.project_id = p.id) as creation_count,
        (SELECT COUNT(*) FROM library_files lf WHERE lf.project_id = p.id) as file_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      ORDER BY CASE WHEN p.status = 'archived' THEN 1 ELSE 0 END, p.updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>;

  res.json({ projects: rows.map(mapProject) });
});

projectsRouter.post('/', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { name, description, category } = req.body as {
    name?: string;
    description?: string;
    category?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'Project name is required.' });
    return;
  }

  const db = getDb();
  const id = newId('prj');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO projects (id, name, description, category, status, owner_id, created_at, updated_at, archived_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)
  `).run(id, name.trim(), (description || '').trim(), (category || 'Operations').trim(), req.user!.id, now, now);

  logEvent({
    level: 'success',
    subsystem: 'PROJECTS',
    action: 'project.created',
    message: `Created project "${name.trim()}".`,
    entityType: 'project',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const row = db
    .prepare('SELECT p.*, u.name as owner_name FROM projects p LEFT JOIN users u ON u.id = p.owner_id WHERE p.id = ?')
    .get(id) as Record<string, unknown>;

  res.status(201).json({ project: mapProject(row) });
});

projectsRouter.patch('/:id', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { name, description, category, status } = req.body as {
    name?: string;
    description?: string;
    category?: string;
    status?: ProjectStatus;
  };

  const db = getDb();
  const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const nextStatus: ProjectStatus = status ?? (existing.status as ProjectStatus);
  const now = new Date().toISOString();
  const archivedAt = nextStatus === 'archived' ? (existing.archived_at ? String(existing.archived_at) : now) : null;

  db.prepare(`
    UPDATE projects
    SET name = ?, description = ?, category = ?, status = ?, archived_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : String(existing.name),
    description !== undefined ? description.trim() : String(existing.description),
    category !== undefined ? category.trim() : String(existing.category),
    nextStatus,
    archivedAt,
    now,
    id
  );

  logEvent({
    level: 'info',
    subsystem: 'PROJECTS',
    action: nextStatus === 'archived' ? 'project.archived' : 'project.updated',
    message: `Updated project "${name ?? String(existing.name)}" (${nextStatus}).`,
    entityType: 'project',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const updated = db
    .prepare(`
      SELECT p.*, u.name as owner_name,
        (SELECT COUNT(*) FROM commands c WHERE c.project_id = p.id) as command_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) as task_count,
        (SELECT COUNT(*) FROM creations cr WHERE cr.project_id = p.id) as creation_count,
        (SELECT COUNT(*) FROM library_files lf WHERE lf.project_id = p.id) as file_count
      FROM projects p
      LEFT JOIN users u ON u.id = p.owner_id
      WHERE p.id = ?
    `)
    .get(id) as Record<string, unknown>;

  res.json({ project: mapProject(updated) });
});

projectsRouter.get('/:id/history', (req, res) => {
  const { id } = req.params;
  const db = getDb();

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const commands = db
    .prepare('SELECT id, prompt, status, progress_percent as progressPercent, created_at as createdAt FROM commands WHERE project_id = ? ORDER BY created_at DESC')
    .all(id);
  const tasks = db
    .prepare('SELECT id, title, status, division, priority, created_at as createdAt FROM tasks WHERE project_id = ? ORDER BY created_at DESC')
    .all(id);
  const creations = db
    .prepare('SELECT id, title, category, status, created_at as createdAt FROM creations WHERE project_id = ? ORDER BY created_at DESC')
    .all(id);
  const files = db
    .prepare('SELECT id, original_name as originalName, category, size_bytes as sizeBytes, created_at as createdAt FROM library_files WHERE project_id = ? ORDER BY created_at DESC')
    .all(id);

  res.json({ commands, tasks, creations, files });
});
