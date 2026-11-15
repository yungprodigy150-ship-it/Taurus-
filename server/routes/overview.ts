import fs from 'node:fs';
import { Router } from 'express';
import type { ExecutionLogRecord, OverviewPayload, TaskRecord } from '../../shared/types.ts';
import { STORAGE_DIR } from '../config.ts';
import { getDb } from '../db/database.ts';
import { requireAuth } from '../services/auth.ts';

export const overviewRouter = Router();
overviewRouter.use(requireAuth);

overviewRouter.get('/', (_req, res) => {
  const db = getDb();

  let databaseConnected = true;
  try {
    db.prepare('SELECT 1').get();
  } catch {
    databaseConnected = false;
  }

  const storageAvailable = fs.existsSync(STORAGE_DIR);

  const activeAgents = (
    db.prepare("SELECT COUNT(*) as count FROM agents WHERE status = 'active'").get() as { count: number }
  ).count;
  const totalAgents = (db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number }).count;

  const runningCommandCount = (
    db.prepare("SELECT COUNT(*) as count FROM commands WHERE status IN ('analyzing', 'running')").get() as {
      count: number;
    }
  ).count;
  const inProgressTaskCount = (
    db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'in_progress'").get() as { count: number }
  ).count;
  const runningTasks = runningCommandCount + inProgressTaskCount;

  const completedTasks = (
    db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'").get() as { count: number }
  ).count;

  const activeProjects = (
    db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'active'").get() as { count: number }
  ).count;

  const connectedAiProviders = (
    db
      .prepare("SELECT COUNT(*) as count FROM integrations WHERE category = 'ai_provider' AND connection_status = 'connected'")
      .get() as { count: number }
  ).count;

  const verifiedProviders = (
    db.prepare("SELECT COUNT(*) as count FROM integrations WHERE connection_status = 'connected'").get() as {
      count: number;
    }
  ).count;

  const errorIntegrations = (
    db.prepare("SELECT COUNT(*) as count FROM integrations WHERE connection_status = 'error'").get() as {
      count: number;
    }
  ).count;

  const totalCommands = (db.prepare('SELECT COUNT(*) as count FROM commands').get() as { count: number }).count;
  const totalCreations = (db.prepare('SELECT COUNT(*) as count FROM creations').get() as { count: number }).count;
  const totalLibraryFiles = (db.prepare('SELECT COUNT(*) as count FROM library_files').get() as { count: number }).count;

  const approvalRows = db
    .prepare(`
      SELECT t.*, p.name as project_name, a.name as agent_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN agents a ON a.id = t.agent_id
      WHERE t.status = 'awaiting_approval'
      ORDER BY t.created_at DESC
      LIMIT 20
    `)
    .all() as Array<Record<string, unknown>>;

  const pendingApprovals: TaskRecord[] = approvalRows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    description: String(r.description || ''),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    commandId: r.command_id ? String(r.command_id) : null,
    agentId: r.agent_id ? String(r.agent_id) : null,
    agentName: r.agent_name ? String(r.agent_name) : null,
    division: (r.division as TaskRecord['division']) ?? null,
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
    .prepare('SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 25')
    .all() as Array<Record<string, unknown>>;

  const recentActivity: ExecutionLogRecord[] = logRows.map((r) => ({
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

  const payload: OverviewPayload = {
    systemStatus: {
      health: !databaseConnected || !storageAvailable || errorIntegrations > 0 ? 'degraded' : 'operational',
      databaseConnected,
      storageAvailable,
      verifiedProviders,
      phaseLabel: 'Phase 1 · System Foundation',
    },
    metrics: {
      activeAgents,
      totalAgents,
      runningTasks,
      completedTasks,
      activeProjects,
      connectedAiProviders,
      pendingApprovals: pendingApprovals.length,
      totalCommands,
      totalCreations,
      totalLibraryFiles,
    },
    pendingApprovals,
    recentActivity,
  };

  res.json(payload);
});
