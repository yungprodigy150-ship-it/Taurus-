import { Router } from 'express';
import type { CommandPlanStep, CommandRecord, DivisionCode, TaskRecord } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';
import { continueExecutionRun, getExecutionRunWithSteps, planAndRunCommand } from '../services/orchestrator.ts';

export const commandsRouter = Router();
commandsRouter.use(requireAuth);

function mapCommandRow(r: Record<string, unknown>): CommandRecord {
  let planSteps: CommandPlanStep[] = [];
  let clarificationQuestions: string[] = [];
  try {
    planSteps = JSON.parse(String(r.plan_json || '[]')) as CommandPlanStep[];
  } catch {
    planSteps = [];
  }
  try {
    clarificationQuestions = JSON.parse(String(r.clarification_json || '[]')) as string[];
  } catch {
    clarificationQuestions = [];
  }

  return {
    id: String(r.id),
    prompt: String(r.prompt),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    assignedAgentId: r.assigned_agent_id ? String(r.assigned_agent_id) : null,
    assignedDivision: (r.assigned_division as DivisionCode) ?? null,
    status: r.status as CommandRecord['status'],
    progressPercent: Number(r.progress_percent ?? 0),
    progressStage: String(r.progress_stage || ''),
    executionNote: String(r.execution_note || ''),
    planSteps,
    clarificationQuestions,
    latestRunId: r.latest_run_id ? String(r.latest_run_id) : null,
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdBy: String(r.created_by),
    createdByName: r.created_by_name ? String(r.created_by_name) : undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function assertCommandAccess(cmd: Record<string, unknown>, req: AuthenticatedRequest): boolean {
  if (req.user!.role === 'owner') return true;
  return String(cmd.created_by) === req.user!.id;
}

commandsRouter.get('/', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
  const isOwner = req.user!.role === 'owner';

  const conditions: string[] = [];
  const params: string[] = [];
  if (!isOwner) {
    conditions.push('c.created_by = ?');
    params.push(req.user!.id);
  }
  if (projectId) {
    conditions.push('c.project_id = ?');
    params.push(projectId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `
    SELECT c.*, p.name as project_name, u.name as created_by_name
    FROM commands c
    LEFT JOIN projects p ON p.id = c.project_id
    LEFT JOIN users u ON u.id = c.created_by
    ${whereClause}
    ORDER BY c.created_at DESC
  `;

  const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
  res.json({ commands: rows.map(mapCommandRow) });
});

commandsRouter.post('/', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const { prompt, projectId, assignedAgentId, autoExecute, runAiIntake } = req.body as {
    prompt?: string;
    projectId?: string | null;
    assignedAgentId?: string | null;
    autoExecute?: boolean;
    runAiIntake?: boolean;
  };

  if (!prompt?.trim()) {
    res.status(400).json({ error: 'Command instruction text is required.' });
    return;
  }

  const db = getDb();
  if (projectId) {
    const proj = db.prepare('SELECT id, owner_id FROM projects WHERE id = ?').get(projectId) as
      | { id: string; owner_id: string }
      | undefined;
    if (!proj || (req.user!.role !== 'owner' && proj.owner_id !== req.user!.id)) {
      res.status(404).json({ error: 'Selected project was not found or inaccessible.' });
      return;
    }
  }

  let assignedDivision: DivisionCode | null = null;
  if (assignedAgentId) {
    const agent = db.prepare('SELECT id, division FROM agents WHERE id = ?').get(assignedAgentId) as
      | { id: string; division: DivisionCode }
      | undefined;
    if (!agent) {
      res.status(404).json({ error: 'Selected agent was not found.' });
      return;
    }
    assignedDivision = agent.division;
  }

  const commandId = newId('cmd');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO commands (
      id, prompt, project_id, assigned_agent_id, assigned_division,
      status, progress_percent, progress_stage, execution_note,
      plan_json, clarification_json, latest_run_id, error_message, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', 0, 'Instruction recorded', '', '[]', '[]', NULL, NULL, ?, ?, ?)
  `).run(
    commandId,
    prompt.trim(),
    projectId || null,
    assignedAgentId || null,
    assignedDivision,
    req.user!.id,
    now,
    now
  );

  logEvent({
    level: 'info',
    subsystem: 'COMMAND',
    action: 'command.submitted',
    message: `Submitted directive: "${prompt.trim().slice(0, 90)}${prompt.trim().length > 90 ? '...' : ''}"`,
    entityType: 'command',
    entityId: commandId,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  let run = null;
  if (runAiIntake !== false) {
    run = await planAndRunCommand(commandId, req.user!.id, req.user!.name, {
      autoExecute: autoExecute !== false,
    });
  }

  const createdRow = db
    .prepare(
      `SELECT c.*, p.name as project_name, u.name as created_by_name
       FROM commands c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = ?`
    )
    .get(commandId) as Record<string, unknown>;

  res.status(201).json({ command: mapCommandRow(createdRow), executionRun: run });
});

commandsRouter.post('/:id/analyze', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing || !assertCommandAccess(existing, req)) {
    res.status(404).json({ error: 'Command not found.' });
    return;
  }

  const { autoExecute } = (req.body || {}) as { autoExecute?: boolean };
  const run = await planAndRunCommand(req.params.id, req.user!.id, req.user!.name, {
    autoExecute: autoExecute !== false,
  });

  const row = db
    .prepare(
      `SELECT c.*, p.name as project_name, u.name as created_by_name
       FROM commands c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = ?`
    )
    .get(req.params.id) as Record<string, unknown>;

  res.json({ command: mapCommandRow(row), executionRun: run });
});

commandsRouter.post('/:id/clarify', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const { answer, autoExecute } = req.body as { answer?: string; autoExecute?: boolean };
  if (!answer?.trim()) {
    res.status(400).json({ error: 'Clarification response is required.' });
    return;
  }

  const db = getDb();
  const existing = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing || !assertCommandAccess(existing, req)) {
    res.status(404).json({ error: 'Command not found.' });
    return;
  }

  const run = await planAndRunCommand(req.params.id, req.user!.id, req.user!.name, {
    autoExecute: autoExecute !== false,
    clarificationAnswer: answer.trim(),
  });

  const row = db
    .prepare(
      `SELECT c.*, p.name as project_name, u.name as created_by_name
       FROM commands c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = ?`
    )
    .get(req.params.id) as Record<string, unknown>;

  res.json({ command: mapCommandRow(row), executionRun: run });
});

commandsRouter.post('/:id/execute', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing || !assertCommandAccess(existing, req)) {
    res.status(404).json({ error: 'Command not found.' });
    return;
  }

  let run = null;
  if (existing.latest_run_id) {
    run = await continueExecutionRun(String(existing.latest_run_id), req.user!.id, req.user!.name);
  } else {
    run = await planAndRunCommand(req.params.id, req.user!.id, req.user!.name, { autoExecute: true });
  }

  const row = db
    .prepare(
      `SELECT c.*, p.name as project_name, u.name as created_by_name
       FROM commands c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = ?`
    )
    .get(req.params.id) as Record<string, unknown>;

  res.json({ command: mapCommandRow(row), executionRun: run });
});

commandsRouter.get('/:id/run', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM commands WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing || !assertCommandAccess(existing, req)) {
    res.status(404).json({ error: 'Command not found.' });
    return;
  }

  const run = existing.latest_run_id ? getExecutionRunWithSteps(String(existing.latest_run_id)) : null;
  res.json({ executionRun: run });
});

commandsRouter.patch('/:id', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { status, progressPercent, progressStage, projectId, assignedAgentId } = req.body as {
    status?: CommandRecord['status'];
    progressPercent?: number;
    progressStage?: string;
    projectId?: string | null;
    assignedAgentId?: string | null;
  };

  const db = getDb();
  const existing = db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing || !assertCommandAccess(existing, req)) {
    res.status(404).json({ error: 'Command not found.' });
    return;
  }

  const now = new Date().toISOString();
  const nextStatus = status ?? String(existing.status);
  const nextProgress =
    typeof progressPercent === 'number'
      ? Math.max(0, Math.min(100, Math.round(progressPercent)))
      : Number(existing.progress_percent);
  const nextStage = progressStage?.trim() || String(existing.progress_stage);
  const nextProjectId = projectId !== undefined ? projectId : (existing.project_id as string | null);
  const nextAgentId = assignedAgentId !== undefined ? assignedAgentId : (existing.assigned_agent_id as string | null);

  db.prepare(`
    UPDATE commands
    SET status = ?, progress_percent = ?, progress_stage = ?, project_id = ?, assigned_agent_id = ?, updated_at = ?
    WHERE id = ?
  `).run(nextStatus, nextProgress, nextStage, nextProjectId, nextAgentId, now, id);

  logEvent({
    level: 'info',
    subsystem: 'COMMAND',
    action: 'command.updated',
    message: `Command ${id} updated to ${nextStatus} (${nextProgress}%).`,
    entityType: 'command',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const updated = db
    .prepare(
      `SELECT c.*, p.name as project_name, u.name as created_by_name
       FROM commands c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = ?`
    )
    .get(id) as Record<string, unknown>;

  res.json({ command: mapCommandRow(updated) });
});

commandsRouter.get('/:id/tasks', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id, created_by FROM commands WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined;
  if (!existing || !assertCommandAccess(existing, req)) {
    res.status(404).json({ error: 'Command not found.' });
    return;
  }

  const rows = db
    .prepare(`
      SELECT t.*, p.name as project_name, a.name as agent_name
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN agents a ON a.id = t.agent_id
      WHERE t.command_id = ?
      ORDER BY t.created_at ASC
    `)
    .all(req.params.id) as Array<Record<string, unknown>>;

  const tasks: TaskRecord[] = rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    description: String(r.description || ''),
    projectId: r.project_id ? String(r.project_id) : null,
    projectName: r.project_name ? String(r.project_name) : null,
    commandId: r.command_id ? String(r.command_id) : null,
    agentId: r.agent_id ? String(r.agent_id) : null,
    agentName: r.agent_name ? String(r.agent_name) : null,
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

  res.json({ tasks });
});

commandsRouter.post('/steps/:stepId/decision', requireRole(['owner']), async (req: AuthenticatedRequest, res) => {
  const { stepId } = req.params;
  const { decision } = req.body as { decision?: 'approve' | 'reject' };
  if (decision !== 'approve' && decision !== 'reject') {
    res.status(400).json({ error: 'Decision must be approve or reject.' });
    return;
  }

  const db = getDb();
  const step = db.prepare('SELECT * FROM execution_steps WHERE id = ?').get(stepId) as
    | { id: string; run_id: string; task_id: string | null; title: string; status: string }
    | undefined;
  if (!step) {
    res.status(404).json({ error: 'Execution step not found.' });
    return;
  }

  const now = new Date().toISOString();
  const nextStepStatus = decision === 'approve' ? 'pending' : 'skipped';
  db.prepare(`
    UPDATE execution_steps
    SET status = ?, approved_by = ?, approved_at = ?
    WHERE id = ?
  `).run(nextStepStatus, req.user!.id, now, stepId);

  if (step.task_id) {
    db.prepare(`
      UPDATE tasks
      SET status = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ?
    `).run(decision === 'approve' ? 'pending' : 'rejected', req.user!.id, now, now, step.task_id);
  }

  logEvent({
    level: decision === 'approve' ? 'success' : 'warn',
    subsystem: 'COMMAND',
    action: `step.${decision}`,
    message: `${decision === 'approve' ? 'Approved' : 'Rejected'} gated step "${step.title}".`,
    entityType: 'execution_step',
    entityId: stepId,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  const updatedRun = await continueExecutionRun(step.run_id, req.user!.id, req.user!.name);
  res.json({ executionRun: updatedRun });
});

commandsRouter.post('/tasks/:taskId/decision', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const { taskId } = req.params;
  const { decision, notes } = req.body as { decision?: 'approve' | 'reject' | 'complete'; notes?: string };

  if (decision !== 'approve' && decision !== 'reject' && decision !== 'complete') {
    res.status(400).json({ error: 'Decision must be approve, reject, or complete.' });
    return;
  }

  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as Record<string, unknown> | undefined;
  if (!task) {
    res.status(404).json({ error: 'Task not found.' });
    return;
  }
  if (req.user!.role !== 'owner' && String(task.created_by) !== req.user!.id) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }

  if ((decision === 'approve' || decision === 'reject') && req.user!.role !== 'owner') {
    res.status(403).json({ error: 'Only an Owner can approve or reject gated operational tasks.' });
    return;
  }

  const now = new Date().toISOString();
  const nextStatus =
    decision === 'approve' ? 'pending' : decision === 'reject' ? 'rejected' : 'completed';

  db.prepare(`
    UPDATE tasks
    SET status = ?,
        approved_by = COALESCE(?, approved_by),
        approved_at = COALESCE(?, approved_at),
        result_notes = COALESCE(?, result_notes),
        updated_at = ?
    WHERE id = ?
  `).run(
    nextStatus,
    decision === 'approve' || decision === 'reject' ? req.user!.id : null,
    decision === 'approve' || decision === 'reject' ? now : null,
    notes?.trim() || null,
    now,
    taskId
  );

  // Sync linked execution_step if present and resume run on approval
  const linkedStep = db.prepare('SELECT id, run_id FROM execution_steps WHERE task_id = ?').get(taskId) as
    | { id: string; run_id: string }
    | undefined;

  if (linkedStep && (decision === 'approve' || decision === 'reject')) {
    db.prepare(`
      UPDATE execution_steps SET status = ?, approved_by = ?, approved_at = ? WHERE id = ?
    `).run(decision === 'approve' ? 'pending' : 'skipped', req.user!.id, now, linkedStep.id);

    await continueExecutionRun(linkedStep.run_id, req.user!.id, req.user!.name);
  } else if (task.command_id) {
    const commandId = String(task.command_id);
    const siblings = db.prepare('SELECT status FROM tasks WHERE command_id = ?').all(commandId) as Array<{
      status: string;
    }>;
    if (siblings.length > 0) {
      const doneCount = siblings.filter((s) => s.status === 'completed' || s.status === 'rejected').length;
      const pct = Math.round((doneCount / siblings.length) * 100);
      const anyWaiting = siblings.some((s) => s.status === 'awaiting_approval');
      const allCompleted = siblings.every((s) => s.status === 'completed');
      const nextCmdStatus = allCompleted ? 'completed' : anyWaiting ? 'awaiting_approval' : 'planned';
      db.prepare('UPDATE commands SET progress_percent = ?, status = ?, updated_at = ? WHERE id = ?').run(
        Math.max(20, pct),
        nextCmdStatus,
        now,
        commandId
      );
    }
  }

  logEvent({
    level: decision === 'reject' ? 'warn' : 'success',
    subsystem: 'COMMAND',
    action: `task.${decision}`,
    message: `Task "${String(task.title)}" marked ${nextStatus} by ${req.user!.name}.`,
    entityType: 'task',
    entityId: taskId,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.json({ ok: true, status: nextStatus });
});
