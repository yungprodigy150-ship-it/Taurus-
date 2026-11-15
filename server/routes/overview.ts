import fs from 'node:fs';
import { Router } from 'express';
import type { ExecutionLogRecord, ExecutionRunRecord, OverviewPayload, TaskRecord } from '../../shared/types.ts';
import { STORAGE_DIR } from '../config.ts';
import { getDb } from '../db/database.ts';
import { requireAuth, type AuthenticatedRequest } from '../services/auth.ts';
import { getExecutionRunWithSteps } from '../services/orchestrator.ts';

export const overviewRouter = Router();
overviewRouter.use(requireAuth);

overviewRouter.get('/', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const isOwner = req.user!.role === 'owner';
  const uid = req.user!.id;

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
    isOwner
      ? db.prepare("SELECT COUNT(*) as count FROM commands WHERE status IN ('analyzing', 'running')").get()
      : db
          .prepare("SELECT COUNT(*) as count FROM commands WHERE created_by = ? AND status IN ('analyzing', 'running')")
          .get(uid)
  ) as { count: number };

  const inProgressTaskCount = (
    isOwner
      ? db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'in_progress'").get()
      : db.prepare("SELECT COUNT(*) as count FROM tasks WHERE created_by = ? AND status = 'in_progress'").get(uid)
  ) as { count: number };

  const runningTasks = runningCommandCount.count + inProgressTaskCount.count;

  const completedTasks = (
    isOwner
      ? db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'").get()
      : db.prepare("SELECT COUNT(*) as count FROM tasks WHERE created_by = ? AND status = 'completed'").get(uid)
  ) as { count: number };

  const activeProjects = (
    isOwner
      ? db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'active'").get()
      : db.prepare("SELECT COUNT(*) as count FROM projects WHERE owner_id = ? AND status = 'active'").get(uid)
  ) as { count: number };

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

  const totalCommands = (
    isOwner
      ? db.prepare('SELECT COUNT(*) as count FROM commands').get()
      : db.prepare('SELECT COUNT(*) as count FROM commands WHERE created_by = ?').get(uid)
  ) as { count: number };

  const totalCreations = (
    isOwner
      ? db.prepare('SELECT COUNT(*) as count FROM creations').get()
      : db.prepare('SELECT COUNT(*) as count FROM creations WHERE created_by = ?').get(uid)
  ) as { count: number };

  const totalLibraryFiles = (
    isOwner
      ? db.prepare('SELECT COUNT(*) as count FROM library_files').get()
      : db.prepare('SELECT COUNT(*) as count FROM library_files WHERE uploaded_by = ?').get(uid)
  ) as { count: number };

  const totalExecutionRuns = (
    isOwner
      ? db.prepare('SELECT COUNT(*) as count FROM execution_runs').get()
      : db.prepare('SELECT COUNT(*) as count FROM execution_runs WHERE created_by = ?').get(uid)
  ) as { count: number };

  const approvalRows = (
    isOwner
      ? db
          .prepare(`
            SELECT t.*, p.name as project_name, a.name as agent_name
            FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN agents a ON a.id = t.agent_id
            WHERE t.status = 'awaiting_approval'
            ORDER BY t.created_at DESC
            LIMIT 20
          `)
          .all()
      : db
          .prepare(`
            SELECT t.*, p.name as project_name, a.name as agent_name
            FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN agents a ON a.id = t.agent_id
            WHERE t.created_by = ? AND t.status = 'awaiting_approval'
            ORDER BY t.created_at DESC
            LIMIT 20
          `)
          .all(uid)
  ) as Array<Record<string, unknown>>;

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

  const recentRunIds = (
    isOwner
      ? db.prepare('SELECT id FROM execution_runs ORDER BY started_at DESC LIMIT 5').all()
      : db.prepare('SELECT id FROM execution_runs WHERE created_by = ? ORDER BY started_at DESC LIMIT 5').all(uid)
  ) as Array<{ id: string }>;

  const recentRuns: ExecutionRunRecord[] = recentRunIds
    .map((r) => getExecutionRunWithSteps(r.id))
    .filter((r): r is ExecutionRunRecord => Boolean(r));

  const logRows = (
    isOwner
      ? db.prepare('SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 25').all()
      : db
          .prepare('SELECT * FROM execution_logs WHERE actor_id = ? OR actor_id IS NULL ORDER BY created_at DESC LIMIT 25')
          .all(uid)
  ) as Array<Record<string, unknown>>;

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
      storageDurability: 'local_container_disk',
      verifiedProviders,
      phaseLabel: 'Phase 2 · Multi-Agent Orchestration',
    },
    metrics: {
      activeAgents,
      totalAgents,
      runningTasks,
      completedTasks: completedTasks.count,
      activeProjects: activeProjects.count,
      connectedAiProviders,
      pendingApprovals: pendingApprovals.length,
      totalCommands: totalCommands.count,
      totalCreations: totalCreations.count,
      totalLibraryFiles: totalLibraryFiles.count,
      totalExecutionRuns: totalExecutionRuns.count,
    },
    pendingApprovals,
    recentRuns,
    recentActivity,
  };

  res.json(payload);
});
