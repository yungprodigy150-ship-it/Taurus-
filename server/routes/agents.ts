import { Router } from 'express';
import type { AgentRecord, AgentRuntimeMode, AgentStatus, DivisionCode, ExecutionLogRecord, TaskRecord } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

const VALID_DIVISIONS: DivisionCode[] = [
  'COMMAND',
  'FORGE',
  'VANGUARD',
  'SENTRY',
  'ATLAS',
  'NEXUS',
  'TREASURY',
];

function mapAgent(r: Record<string, unknown>): AgentRecord {
  let capabilities: string[] = [];
  let config: Record<string, unknown> = {};
  try {
    capabilities = JSON.parse(String(r.capabilities_json || '[]')) as string[];
  } catch {
    capabilities = [];
  }
  try {
    config = JSON.parse(String(r.config_json || '{}')) as Record<string, unknown>;
  } catch {
    config = {};
  }

  return {
    id: String(r.id),
    name: String(r.name),
    division: r.division as DivisionCode,
    description: String(r.description || ''),
    responsibilities: String(r.responsibilities || ''),
    modelProvider: String(r.model_provider || 'unassigned'),
    modelName: String(r.model_name || 'none'),
    status: r.status as AgentStatus,
    runtimeMode: r.runtime_mode as AgentRuntimeMode,
    capabilities,
    config,
    assignedTaskCount: typeof r.assigned_task_count === 'number' ? r.assigned_task_count : 0,
    createdBy: r.created_by ? String(r.created_by) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

agentsRouter.get('/', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM tasks t WHERE t.agent_id = a.id AND t.status NOT IN ('completed', 'rejected')) as assigned_task_count
      FROM agents a
      ORDER BY a.created_at ASC
    `)
    .all() as Array<Record<string, unknown>>;

  res.json({ agents: rows.map(mapAgent) });
});

agentsRouter.get('/:id/details', (req, res) => {
  const db = getDb();
  const agentRow = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!agentRow) {
    res.status(404).json({ error: 'Agent not found.' });
    return;
  }

  const taskRows = db
    .prepare(`
      SELECT t.*, p.name as project_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.agent_id = ?
      ORDER BY t.created_at DESC
    `)
    .all(req.params.id) as Array<Record<string, unknown>>;

  const tasks: TaskRecord[] = taskRows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    description: String(r.description || ''),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    commandId: r.command_id ? String(r.command_id) : null,
    agentId: r.agent_id ? String(r.agent_id) : null,
    division: (r.division as DivisionCode) ?? null,
    status: r.status as TaskRecord['status'],
    priority: r.priority as TaskRecord['priority'],
    requiresApproval: Boolean(r.requires_approval),
    approvedBy: r.approved_by ? String(r.approved_by) : null,
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    resultNotes: r.result_notes ? String(r.result_notes) : null,
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));

  const logRows = db
    .prepare('SELECT * FROM execution_logs WHERE entity_id = ? OR subsystem = ? ORDER BY created_at DESC LIMIT 30')
    .all(req.params.id, String(agentRow.division)) as Array<Record<string, unknown>>;

  const history: ExecutionLogRecord[] = logRows.map((r) => ({
    id: String(r.id),
    level: r.level as ExecutionLogRecord['level'],
    subsystem: String(r.subsystem),
    action: String(r.action),
    message: String(r.message),
    entityType: r.entity_type ? String(r.entity_type) : null,
    entityId: r.entity_id ? String(r.entity_id) : null,
    actorId: r.actor_id ? String(r.actor_id) : null,
    actorName: r.actor_name ? String(r.actor_name) : null,
    createdAt: String(r.created_at),
  }));

  res.json({ agent: mapAgent(agentRow), tasks, history });
});

agentsRouter.post('/', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { name, division, description, responsibilities, modelProvider, modelName, status, config } = req.body as {
    name?: string;
    division?: DivisionCode;
    description?: string;
    responsibilities?: string;
    modelProvider?: string;
    modelName?: string;
    status?: AgentStatus;
    config?: Record<string, unknown>;
  };

  if (!name?.trim() || !division || !VALID_DIVISIONS.includes(division)) {
    res.status(400).json({ error: 'Agent name and a valid operational division are required.' });
    return;
  }

  // Honest capability guard: agents cannot be forced to 'active' unless explicitly configured with a verified provider,
  // and Phase 1 runtimeMode remains 'intake_assisted' or 'architecture_only'.
  const requestedStatus: AgentStatus =
    status === 'configured' || status === 'disabled' || status === 'standby' ? status : 'configured';

  const db = getDb();
  const id = newId('agt');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO agents (
      id, name, division, description, responsibilities,
      model_provider, model_name, status, runtime_mode,
      capabilities_json, config_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'architecture_only', '[]', ?, ?, ?, ?)
  `).run(
    id,
    name.trim(),
    division,
    (description || '').trim(),
    (responsibilities || '').trim(),
    (modelProvider || 'unassigned').trim(),
    (modelName || 'none').trim(),
    requestedStatus,
    JSON.stringify(config || { autonomousExecutionReady: false, phaseTarget: 'Phase 2' }),
    req.user!.id,
    now,
    now
  );

  logEvent({
    level: 'info',
    subsystem: division,
    action: 'agent.created',
    message: `Registered agent "${name.trim()}" in division ${division} (${requestedStatus}).`,
    entityType: 'agent',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>;
  res.status(201).json({ agent: mapAgent(row) });
});

agentsRouter.patch('/:id', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Agent not found.' });
    return;
  }

  const { name, description, responsibilities, modelProvider, modelName, status, config } = req.body as {
    name?: string;
    description?: string;
    responsibilities?: string;
    modelProvider?: string;
    modelName?: string;
    status?: AgentStatus;
    config?: Record<string, unknown>;
  };

  // Prevent claiming autonomous 'active' status unless a verified AI provider is linked
  let nextStatus: AgentStatus = (status ?? existing.status) as AgentStatus;
  let nextRuntimeMode: AgentRuntimeMode = existing.runtime_mode as AgentRuntimeMode;
  const nextProvider = modelProvider !== undefined ? modelProvider : String(existing.model_provider);

  if (nextStatus === 'active') {
    const verifiedProvider = db
      .prepare("SELECT connection_status FROM integrations WHERE provider_key = ? AND connection_status = 'connected'")
      .get(nextProvider) as { connection_status: string } | undefined;

    if (!verifiedProvider) {
      res.status(400).json({
        error: `Cannot mark agent as active without a verified connected AI provider. Verify "${nextProvider}" in Integrations first, or set status to "configured" or "standby".`,
      });
      return;
    }
    nextRuntimeMode = 'intake_assisted';
  } else if (nextStatus === 'standby' || nextStatus === 'disabled') {
    nextRuntimeMode = 'architecture_only';
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE agents
    SET name = ?,
        description = ?,
        responsibilities = ?,
        model_provider = ?,
        model_name = ?,
        status = ?,
        runtime_mode = ?,
        config_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : String(existing.name),
    description !== undefined ? description.trim() : String(existing.description),
    responsibilities !== undefined ? responsibilities.trim() : String(existing.responsibilities),
    nextProvider,
    modelName !== undefined ? modelName.trim() : String(existing.model_name),
    nextStatus,
    nextRuntimeMode,
    config !== undefined ? JSON.stringify(config) : String(existing.config_json),
    now,
    id
  );

  logEvent({
    level: 'info',
    subsystem: String(existing.division),
    action: 'agent.updated',
    message: `Updated configuration for agent "${name ?? String(existing.name)}" (${nextStatus}).`,
    entityType: 'agent',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const updated = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>;
  res.json({ agent: mapAgent(updated) });
});

agentsRouter.post('/:id/tasks', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { title, description, projectId, priority, requiresApproval } = req.body as {
    title?: string;
    description?: string;
    projectId?: string | null;
    priority?: TaskRecord['priority'];
    requiresApproval?: boolean;
  };

  if (!title?.trim()) {
    res.status(400).json({ error: 'Task title is required.' });
    return;
  }

  const db = getDb();
  const agent = db.prepare('SELECT id, name, division FROM agents WHERE id = ?').get(id) as
    | { id: string; name: string; division: DivisionCode }
    | undefined;
  if (!agent) {
    res.status(404).json({ error: 'Agent not found.' });
    return;
  }

  const taskId = newId('tsk');
  const now = new Date().toISOString();
  const needsApproval = Boolean(requiresApproval);
  const taskStatus = needsApproval ? 'awaiting_approval' : 'pending';

  db.prepare(`
    INSERT INTO tasks (
      id, title, description, project_id, command_id, agent_id, division,
      status, priority, requires_approval, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    title.trim(),
    (description || '').trim(),
    projectId || null,
    agent.id,
    agent.division,
    taskStatus,
    priority || 'medium',
    needsApproval ? 1 : 0,
    req.user!.id,
    now,
    now
  );

  logEvent({
    level: 'info',
    subsystem: agent.division,
    action: 'task.assigned',
    message: `Assigned task "${title.trim()}" to ${agent.name}.`,
    entityType: 'task',
    entityId: taskId,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.status(201).json({ taskId, status: taskStatus });
});

agentsRouter.delete('/:id', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  if (id.startsWith('div-')) {
    res.status(400).json({ error: 'Core division scaffolds cannot be deleted; you may disable them instead.' });
    return;
  }
  const db = getDb();
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Agent not found.' });
    return;
  }

  logEvent({
    level: 'warn',
    subsystem: 'COMMAND',
    action: 'agent.deleted',
    message: `Removed custom agent ${id}.`,
    entityType: 'agent',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.json({ ok: true });
});
