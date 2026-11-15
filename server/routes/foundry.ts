import { Router } from 'express';
import type { VentureRecord, VentureStructuredSpec } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';
import { executeRoutedAiTask } from '../services/modelRouter.ts';
import { synthesizeNaturalLanguageVenture } from '../services/orchestrator.ts';
import { saveFileToStorage } from '../services/storage.ts';

export const foundryRouter = Router();
foundryRouter.use(requireAuth);

function mapVenture(r: Record<string, unknown>): VentureRecord {
  let structuredSpec: VentureStructuredSpec | null = null;
  if (r.structured_spec_json) {
    try {
      structuredSpec = JSON.parse(String(r.structured_spec_json)) as VentureStructuredSpec;
    } catch {
      structuredSpec = null;
    }
  }

  return {
    id: String(r.id),
    name: String(r.name),
    sourceIdea: r.source_idea ? String(r.source_idea) : '',
    targetMarket: String(r.target_market || ''),
    productType: String(r.product_type || ''),
    revenueModel: String(r.revenue_model || ''),
    constraints: String(r.constraints || ''),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    status: r.status as VentureRecord['status'],
    blueprintMarkdown: String(r.blueprint_markdown || ''),
    structuredSpec,
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    approvedBy: r.approved_by ? String(r.approved_by) : null,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

foundryRouter.get('/', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const isOwner = req.user!.role === 'owner';
  const rows = (
    isOwner
      ? db
          .prepare(`
            SELECT v.*, p.name as project_name
            FROM ventures v
            LEFT JOIN projects p ON p.id = v.project_id
            ORDER BY v.updated_at DESC
          `)
          .all()
      : db
          .prepare(`
            SELECT v.*, p.name as project_name
            FROM ventures v
            LEFT JOIN projects p ON p.id = v.project_id
            WHERE v.created_by = ?
            ORDER BY v.updated_at DESC
          `)
          .all(req.user!.id)
  ) as Array<Record<string, unknown>>;

  res.json({ ventures: rows.map(mapVenture) });
});

// Natural-language one-box venture synthesis
foundryRouter.post('/natural', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const { idea, projectId } = req.body as { idea?: string; projectId?: string | null };
  if (!idea?.trim()) {
    res.status(400).json({ error: 'Please describe your business idea in plain language.' });
    return;
  }

  try {
    const result = await synthesizeNaturalLanguageVenture(
      { sourceIdea: idea.trim(), projectId: projectId || null },
      req.user!.id,
      req.user!.name
    );
    const db = getDb();
    const row = db
      .prepare('SELECT v.*, p.name as project_name FROM ventures v LEFT JOIN projects p ON p.id = v.project_id WHERE v.id = ?')
      .get(result.ventureId) as Record<string, unknown>;

    res.status(201).json({
      venture: mapVenture(row),
      creationId: result.creationId,
      projectId: result.projectId,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Preserve manual structured creation endpoint for compatibility
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
      id, name, source_idea, target_market, product_type, revenue_model, constraints,
      project_id, status, blueprint_markdown, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name.trim(),
    name.trim(),
    (targetMarket || '').trim(),
    (productType || '').trim(),
    (revenueModel || '').trim(),
    (constraints || '').trim(),
    projectId || null,
    blueprintMarkdown?.trim() ? 'blueprint_created' : 'idea_generated',
    (blueprintMarkdown || '').trim(),
    req.user!.id,
    now,
    now
  );

  logEvent({
    level: 'success',
    subsystem: 'FORGE',
    action: 'venture.created',
    message: `Created venture "${name.trim()}".`,
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

// Approve blueprint -> provision tasks & optionally build initial interactive product prototype via FORGE
foundryRouter.post('/:id/approve', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const { buildInitialPrototype } = (req.body || {}) as { buildInitialPrototype?: boolean };
  const db = getDb();
  const row = db.prepare('SELECT * FROM ventures WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;

  if (!row || (req.user!.role !== 'owner' && String(row.created_by) !== req.user!.id)) {
    res.status(404).json({ error: 'Venture not found.' });
    return;
  }

  const venture = mapVenture(row);
  const now = new Date().toISOString();

  let projectId = venture.projectId;
  if (!projectId) {
    projectId = newId('prj');
    db.prepare(`
      INSERT INTO projects (id, name, description, category, status, owner_id, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, 'Business Foundry', 'active', ?, ?, ?, NULL)
    `).run(projectId, venture.name, venture.sourceIdea || venture.productType || '', req.user!.id, now, now);
  }

  // Create initial development tasks from structured spec (or baseline tasks)
  const devTasks =
    venture.structuredSpec?.initialDevelopmentTasks && venture.structuredSpec.initialDevelopmentTasks.length > 0
      ? venture.structuredSpec.initialDevelopmentTasks
      : [
          {
            title: `Build MVP prototype for ${venture.name}`,
            division: 'FORGE' as const,
            description: venture.blueprintMarkdown.slice(0, 300),
          },
          {
            title: `Validate go-to-market channels for ${venture.name}`,
            division: 'VANGUARD' as const,
            description: venture.targetMarket || 'Target customer acquisition channels',
          },
          {
            title: `Verify unit economics and pricing for ${venture.name}`,
            division: 'TREASURY' as const,
            description: venture.revenueModel || 'Pricing and cost model',
          },
        ];

  const divisionAgentMap = new Map<string, string>();
  const agentRows = db.prepare('SELECT id, division FROM agents').all() as Array<{ id: string; division: string }>;
  for (const a of agentRows) {
    if (!divisionAgentMap.has(a.division)) divisionAgentMap.set(a.division, a.id);
  }

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      id, title, description, project_id, command_id, agent_id, division,
      status, priority, requires_approval, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'pending', 'medium', 0, ?, ?, ?)
  `);

  for (const t of devTasks.slice(0, 6)) {
    insertTask.run(
      newId('tsk'),
      t.title.slice(0, 140),
      t.description.slice(0, 500),
      projectId,
      divisionAgentMap.get(t.division) || null,
      t.division,
      req.user!.id,
      now,
      now
    );
  }

  let nextStatus = venture.status === 'idea_generated' ? 'blueprint_created' : venture.status;
  let prototypeCreationId: string | null = null;

  if (buildInitialPrototype) {
    const aiRes = await executeRoutedAiTask({
      division: 'FORGE',
      taskCategory: 'coding',
      complexity: 'high',
      actorId: req.user!.id,
      systemInstruction:
        'You are TAURUS FORGE. Build a clean, responsive, interactive HTML5 landing page & MVP interface for the venture described below. Include working interactive UI elements (service/product selector, inquiry/quote form, pricing calculator) in embedded JavaScript and clean CSS. Output ONLY complete HTML.',
      prompt: `Venture: ${venture.name}\nTarget Market: ${venture.targetMarket}\nProduct Type: ${venture.productType}\nRevenue Model: ${venture.revenueModel}\n\nBlueprint:\n${venture.blueprintMarkdown.slice(
        0,
        3500
      )}`,
    });

    const html = aiRes.text.replace(/^```(?:html)?\s*\n/i, '').replace(/```\s*$/i, '').trim();
    const slug = venture.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'venture';
    const stored = saveFileToStorage(Buffer.from(html, 'utf8'), `${slug}-prototype.html`);
    const fileId = newId('fil');

    db.prepare(`
      INSERT INTO library_files (
        id, original_name, storage_name, category, mime_type,
        size_bytes, sha256, project_id, description, uploaded_by, created_at
      ) VALUES (?, ?, ?, 'source_code', 'text/html', ?, ?, ?, ?, ?, ?)
    `).run(
      fileId,
      stored.safeOriginalName,
      stored.storageName,
      stored.sizeBytes,
      stored.sha256,
      projectId,
      `Initial interactive HTML prototype for ${venture.name}`,
      req.user!.id,
      now
    );

    prototypeCreationId = newId('crt');
    db.prepare(`
      INSERT INTO creations (
        id, title, category, description, project_id, command_id,
        content_type, content_body, library_file_id, deployed_url, is_interactive,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, 'website', ?, ?, NULL, 'html', ?, ?, NULL, 1, 'ready', ?, ?, ?)
    `).run(
      prototypeCreationId,
      `${venture.name} — Interactive MVP Prototype`,
      `Built by FORGE (${aiRes.providerKey}/${aiRes.model}). Local interactive preview ready; not externally deployed.`,
      projectId,
      html,
      fileId,
      req.user!.id,
      now,
      now
    );

    nextStatus = 'product_developed';
  }

  db.prepare(`
    UPDATE ventures
    SET project_id = ?,
        status = ?,
        approved_by = ?,
        approved_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(projectId, nextStatus, req.user!.id, now, now, venture.id);

  logEvent({
    level: 'success',
    subsystem: 'FORGE',
    action: 'venture.approved',
    message: `Approved blueprint for "${venture.name}", created ${Math.min(devTasks.length, 6)} tasks${
      prototypeCreationId ? ' and generated interactive prototype' : ''
    }.`,
    entityType: 'venture',
    entityId: venture.id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const updated = db
    .prepare('SELECT v.*, p.name as project_name FROM ventures v LEFT JOIN projects p ON p.id = v.project_id WHERE v.id = ?')
    .get(venture.id) as Record<string, unknown>;

  res.json({ venture: mapVenture(updated), prototypeCreationId, tasksCreated: Math.min(devTasks.length, 6) });
});

// Legacy synthesize route preserved
foundryRouter.post('/:id/synthesize', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM ventures WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing || (req.user!.role !== 'owner' && String(existing.created_by) !== req.user!.id)) {
      res.status(404).json({ error: 'Venture not found.' });
      return;
    }

    const aiRes = await executeRoutedAiTask({
      division: 'FORGE',
      taskCategory: 'strategy',
      complexity: 'high',
      actorId: req.user!.id,
      prompt: `Create a structured business & product architecture document in Markdown for:
- Venture Name: ${String(existing.name)}
- Target Market: ${String(existing.target_market || 'International digital market')}
- Product Type: ${String(existing.product_type || 'Digital product')}
- Revenue Model: ${String(existing.revenue_model || 'Direct digital sales')}
- Constraints: ${String(existing.constraints || 'None specified')}`,
    });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE ventures SET blueprint_markdown = ?, status = 'blueprint_created', updated_at = ? WHERE id = ?
    `).run(aiRes.text, now, req.params.id);

    const creationId = newId('crt');
    db.prepare(`
      INSERT INTO creations (
        id, title, category, description, project_id, command_id,
        content_type, content_body, library_file_id, is_interactive, status,
        created_by, created_at, updated_at
      ) VALUES (?, ?, 'business', ?, ?, NULL, 'markdown', ?, NULL, 0, 'ready', ?, ?, ?)
    `).run(
      creationId,
      `${String(existing.name)} — Venture Blueprint`,
      `Synthesized via ${aiRes.providerKey}/${aiRes.model}`,
      existing.project_id ? String(existing.project_id) : null,
      aiRes.text,
      req.user!.id,
      now,
      now
    );

    const updated = db
      .prepare('SELECT v.*, p.name as project_name FROM ventures v LEFT JOIN projects p ON p.id = v.project_id WHERE v.id = ?')
      .get(req.params.id) as Record<string, unknown>;
    res.json({ venture: mapVenture(updated), creationId });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

foundryRouter.delete('/:id', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT created_by FROM ventures WHERE id = ?').get(req.params.id) as
    | { created_by: string }
    | undefined;
  if (!existing || (req.user!.role !== 'owner' && existing.created_by !== req.user!.id)) {
    res.status(404).json({ error: 'Venture blueprint not found.' });
    return;
  }

  db.prepare('DELETE FROM ventures WHERE id = ?').run(req.params.id);
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
