import { Router } from 'express';
import type { VentureRecord } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';
import { synthesizeVentureBlueprint } from '../services/orchestrator.ts';

export const foundryRouter = Router();
foundryRouter.use(requireAuth);

function mapVenture(r: Record<string, unknown>): VentureRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    targetMarket: String(r.target_market || ''),
    productType: String(r.product_type || ''),
    revenueModel: String(r.revenue_model || ''),
    constraints: String(r.constraints || ''),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    status: r.status as VentureRecord['status'],
    blueprintMarkdown: String(r.blueprint_markdown || ''),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

foundryRouter.get('/', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT v.*, p.name as project_name
      FROM ventures v
      LEFT JOIN projects p ON p.id = v.project_id
      ORDER BY v.updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>;
  res.json({ ventures: rows.map(mapVenture) });
});

foundryRouter.post('/', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { name, targetMarket, productType, revenueModel, constraints, projectId, blueprintMarkdown } = req.body as {
    name?: string;
    targetMarket?: string;
    productType?: string;
    revenueModel?: string;
    constraints?: string;
    projectId?: string | null;
    blueprintMarkdown?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'Venture name is required.' });
    return;
  }

  const db = getDb();
  const id = newId('vnt');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ventures (
      id, name, target_market, product_type, revenue_model, constraints,
      project_id, status, blueprint_markdown, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name.trim(),
    (targetMarket || '').trim(),
    (productType || '').trim(),
    (revenueModel || '').trim(),
    (constraints || '').trim(),
    projectId || null,
    blueprintMarkdown?.trim() ? 'architected' : 'draft',
    (blueprintMarkdown || '').trim(),
    req.user!.id,
    now,
    now
  );

  logEvent({
    level: 'success',
    subsystem: 'FORGE',
    action: 'venture.created',
    message: `Created venture blueprint "${name.trim()}".`,
    entityType: 'venture',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const row = db
    .prepare('SELECT v.*, p.name as project_name FROM ventures v LEFT JOIN projects p ON p.id = v.project_id WHERE v.id = ?')
    .get(id) as Record<string, unknown>;
  res.status(201).json({ venture: mapVenture(row) });
});

foundryRouter.post('/:id/synthesize', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await synthesizeVentureBlueprint(req.params.id, req.user!.id, req.user!.name);
    const db = getDb();
    const row = db
      .prepare('SELECT v.*, p.name as project_name FROM ventures v LEFT JOIN projects p ON p.id = v.project_id WHERE v.id = ?')
      .get(req.params.id) as Record<string, unknown>;
    res.json({ venture: mapVenture(row), creationId: result.creationId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

foundryRouter.delete('/:id', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM ventures WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Venture blueprint not found.' });
    return;
  }
  logEvent({
    level: 'warn',
    subsystem: 'FORGE',
    action: 'venture.deleted',
    message: `Deleted venture blueprint ${req.params.id}.`,
    entityType: 'venture',
    entityId: req.params.id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });
  res.json({ ok: true });
});
