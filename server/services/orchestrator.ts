import { Type } from '@google/genai';
import type {
  CommandPlanStep,
  DivisionCode,
  ExecutionRunRecord,
  ExecutionStepRecord,
  TaskCategory,
  TaskComplexity,
  VentureStructuredSpec,
} from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { executeDivisionStep } from './agentRuntime.ts';
import { listIntegrations } from './aiProvider.ts';
import { logEvent } from './logger.ts';
import { executeRoutedAiTask } from './modelRouter.ts';
import { saveFileToStorage } from './storage.ts';

const VALID_DIVISIONS: DivisionCode[] = [
  'COMMAND',
  'FORGE',
  'VANGUARD',
  'SENTRY',
  'ATLAS',
  'NEXUS',
  'TREASURY',
];

const MAX_EXECUTION_STEPS = 7;

function sanitizeDivision(val: string | undefined): DivisionCode {
  const upper = (val || '').toUpperCase() as DivisionCode;
  return VALID_DIVISIONS.includes(upper) ? upper : 'COMMAND';
}

function sanitizeCategory(val: string | undefined): TaskCategory {
  const valid: TaskCategory[] = [
    'planning',
    'research',
    'strategy',
    'coding',
    'financial',
    'monitoring',
    'integration',
    'general',
  ];
  return valid.includes(val as TaskCategory) ? (val as TaskCategory) : 'general';
}

function sanitizeComplexity(val: string | undefined): TaskComplexity {
  if (val === 'low' || val === 'high') return val;
  return 'medium';
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const slice = firstBrace !== -1 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
  return JSON.parse(slice) as Record<string, unknown>;
}

interface PlanningAiOutput {
  interpretedObjective: string;
  needsClarification: boolean;
  clarificationQuestions: string[];
  summary: string;
  steps: Array<{
    title: string;
    division: string;
    taskCategory: string;
    complexity: string;
    requiresApproval: boolean;
    rationale: string;
    externalActionType?: string | null;
  }>;
}

export function getExecutionRunWithSteps(runId: string): ExecutionRunRecord | null {
  const db = getDb();
  const run = db.prepare('SELECT * FROM execution_runs WHERE id = ?').get(runId) as
    | Record<string, unknown>
    | undefined;
  if (!run) return null;

  const stepRows = db
    .prepare(`
      SELECT s.*, a.name as agent_name
      FROM execution_steps s
      LEFT JOIN agents a ON a.id = s.agent_id
      WHERE s.run_id = ?
      ORDER BY s.step_index ASC
    `)
    .all(runId) as Array<Record<string, unknown>>;

  let assignedDivisions: DivisionCode[] = [];
  try {
    assignedDivisions = JSON.parse(String(run.assigned_divisions_json || '[]')) as DivisionCode[];
  } catch {
    assignedDivisions = [];
  }

  const steps: ExecutionStepRecord[] = stepRows.map((s) => ({
    id: String(s.id),
    runId: String(s.run_id),
    stepIndex: Number(s.step_index),
    division: s.division as DivisionCode,
    agentId: s.agent_id ? String(s.agent_id) : null,
    agentName: s.agent_name ? String(s.agent_name) : null,
    taskId: s.task_id ? String(s.task_id) : null,
    title: String(s.title),
    objective: String(s.objective || ''),
    taskCategory: (s.task_category as TaskCategory) || 'general',
    complexity: (s.complexity as TaskComplexity) || 'medium',
    providerKey: s.provider_key ? String(s.provider_key) : null,
    modelName: s.model_name ? String(s.model_name) : null,
    routingReason: s.routing_reason ? String(s.routing_reason) : null,
    status: s.status as ExecutionStepRecord['status'],
    requiresApproval: Boolean(s.requires_approval),
    approvedBy: s.approved_by ? String(s.approved_by) : null,
    approvedAt: s.approved_at ? String(s.approved_at) : null,
    inputSummary: String(s.input_summary || ''),
    outputSummary: String(s.output_summary || ''),
    outputCreationId: s.output_creation_id ? String(s.output_creation_id) : null,
    outputFileId: s.output_file_id ? String(s.output_file_id) : null,
    tokensUsed: Number(s.tokens_used ?? 0),
    latencyMs: s.latency_ms !== null && s.latency_ms !== undefined ? Number(s.latency_ms) : null,
    retryCount: Number(s.retry_count ?? 0),
    errorMessage: s.error_message ? String(s.error_message) : null,
    startedAt: s.started_at ? String(s.started_at) : null,
    completedAt: s.completed_at ? String(s.completed_at) : null,
  }));

  return {
    id: String(run.id),
    commandId: String(run.command_id),
    projectId: run.project_id ? String(run.project_id) : null,
    originalInstruction: String(run.original_instruction),
    interpretedObjective: String(run.interpreted_objective || ''),
    assignedDivisions,
    currentStage: String(run.current_stage || ''),
    status: run.status as ExecutionRunRecord['status'],
    finalReport: run.final_report ? String(run.final_report) : null,
    remainingWork: run.remaining_work ? String(run.remaining_work) : null,
    errorMessage: run.error_message ? String(run.error_message) : null,
    totalTokens: Number(run.total_tokens ?? 0),
    retryCount: Number(run.retry_count ?? 0),
    startedAt: String(run.started_at),
    completedAt: run.completed_at ? String(run.completed_at) : null,
    createdBy: String(run.created_by),
    steps,
  };
}

export async function planAndRunCommand(
  commandId: string,
  actorId: string,
  actorName: string,
  options: { autoExecute?: boolean; clarificationAnswer?: string } = {}
): Promise<ExecutionRunRecord | null> {
  const db = getDb();
  const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId) as
    | {
        id: string;
        prompt: string;
        project_id: string | null;
        assigned_agent_id: string | null;
        created_by: string;
      }
    | undefined;

  if (!cmd) throw new Error('Command not found.');

  const connectedProviders = listIntegrations().filter(
    (i) => i.category === 'ai_provider' && i.connectionStatus === 'connected'
  );

  const now = new Date().toISOString();

  if (connectedProviders.length === 0) {
    db.prepare(`
      UPDATE commands
      SET status = 'queued',
          progress_percent = 0,
          progress_stage = 'Awaiting verified AI provider',
          execution_note = 'Instruction saved. Verify at least one AI provider (Google Gemini, Groq, or OpenAI) in Integrations to plan and execute tasks.',
          updated_at = ?
      WHERE id = ?
    `).run(now, commandId);

    logEvent({
      level: 'warn',
      subsystem: 'COMMAND',
      action: 'command.queued_no_provider',
      message: 'Directive queued without execution: no verified AI provider is connected.',
      entityType: 'command',
      entityId: commandId,
      actorId,
      actorName,
    });
    return null;
  }

  db.prepare(`
    UPDATE commands
    SET status = 'analyzing',
        progress_percent = 10,
        progress_stage = 'COMMAND interpreting objective and routing plan',
        error_message = NULL,
        updated_at = ?
    WHERE id = ?
  `).run(now, commandId);

  const fullInstruction = options.clarificationAnswer
    ? `${cmd.prompt}\n\nOperator Clarification: ${options.clarificationAnswer}`
    : cmd.prompt;

  try {
    const planRes = await executeRoutedAiTask({
      division: 'COMMAND',
      taskCategory: 'planning',
      complexity: 'medium',
      actorId,
      jsonMode: true,
      geminiSchema: {
        type: Type.OBJECT,
        properties: {
          interpretedObjective: { type: Type.STRING },
          needsClarification: { type: Type.BOOLEAN },
          clarificationQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          summary: { type: Type.STRING },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                division: { type: Type.STRING },
                taskCategory: { type: Type.STRING },
                complexity: { type: Type.STRING },
                requiresApproval: { type: Type.BOOLEAN },
                rationale: { type: Type.STRING },
                externalActionType: { type: Type.STRING },
              },
            },
          },
        },
      },
      systemInstruction:
        'You are TAURUS COMMAND, the central AI operations orchestrator. Interpret the user instruction in plain language and design a focused execution plan (2 to 5 steps) assigning work to the right divisions: ATLAS (research/web inspection), VANGUARD (strategy/growth), FORGE (websites, apps, blueprints), TREASURY (financial projections), NEXUS (GitHub/email/browser tools), SENTRY (audit/health check). Set needsClarification=true ONLY when critical information is completely missing (e.g., asking to send an email without any recipient or topic). Set requiresApproval=true ONLY for consequential external actions (sending external emails, creating GitHub repos, publishing externally). Return strict JSON with keys: interpretedObjective (string), needsClarification (boolean), clarificationQuestions (string[]), summary (string), steps (array of {title, division, taskCategory, complexity, requiresApproval, rationale, externalActionType}).',
      prompt: `Operator Directive:\n"${fullInstruction}"`,
    });

    const parsed = extractJsonObject(planRes.text) as unknown as Partial<PlanningAiOutput>;
    const interpretedObjective = String(parsed.interpretedObjective || cmd.prompt).slice(0, 400);
    const needsClarification = Boolean(parsed.needsClarification) && !options.clarificationAnswer;
    const clarificationQuestions = Array.isArray(parsed.clarificationQuestions)
      ? parsed.clarificationQuestions.map((q) => String(q)).filter(Boolean).slice(0, 3)
      : [];

    if (needsClarification && clarificationQuestions.length > 0) {
      const clarAt = new Date().toISOString();
      db.prepare(`
        UPDATE commands
        SET status = 'clarification_needed',
            assigned_division = 'COMMAND',
            progress_percent = 15,
            progress_stage = 'Awaiting operator clarification',
            execution_note = ?,
            clarification_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        String(parsed.summary || 'Essential details are needed before execution can proceed.'),
        JSON.stringify(clarificationQuestions),
        clarAt,
        commandId
      );

      logEvent({
        level: 'info',
        subsystem: 'COMMAND',
        action: 'command.clarification_requested',
        message: `Requested ${clarificationQuestions.length} clarification detail(s) before planning execution.`,
        entityType: 'command',
        entityId: commandId,
        actorId,
        actorName,
      });
      return null;
    }

    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, MAX_EXECUTION_STEPS) : [];
    const planSteps: CommandPlanStep[] = rawSteps.map((s) => {
      const div = sanitizeDivision(s.division);
      const extType =
        s.externalActionType === 'github_create_repo' ||
        s.externalActionType === 'send_email' ||
        s.externalActionType === 'browser_navigate'
          ? s.externalActionType
          : null;
      return {
        title: String(s.title || 'Division Task').slice(0, 140),
        division: div,
        taskCategory: sanitizeCategory(s.taskCategory),
        complexity: sanitizeComplexity(s.complexity),
        phaseAvailability: extType ? 'requires_external_integration' : 'phase_2_executable',
        requiresApproval: Boolean(s.requiresApproval) || extType === 'send_email' || extType === 'github_create_repo',
        rationale: String(s.rationale || '').slice(0, 500),
        externalActionType: extType,
      };
    });

    if (planSteps.length === 0) {
      planSteps.push({
        title: 'Execute Directive Deliverable',
        division: 'FORGE',
        taskCategory: 'general',
        complexity: 'medium',
        phaseAvailability: 'phase_2_executable',
        requiresApproval: false,
        rationale: interpretedObjective,
        externalActionType: null,
      });
    }

    // Create Execution Run
    const runId = newId('run');
    const runStart = new Date().toISOString();
    const assignedDivisions = Array.from(new Set(planSteps.map((s) => s.division)));

    db.prepare(`
      INSERT INTO execution_runs (
        id, command_id, project_id, original_instruction, interpreted_objective,
        assigned_divisions_json, current_stage, status, total_tokens, retry_count,
        started_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'Plan generated', 'planning', ?, 0, ?, ?)
    `).run(
      runId,
      commandId,
      cmd.project_id,
      fullInstruction,
      interpretedObjective,
      JSON.stringify(assignedDivisions),
      planRes.totalTokens,
      runStart,
      cmd.created_by
    );

    // Map division -> primary agent id
    const divisionAgentMap = new Map<string, string>();
    const agentRows = db.prepare('SELECT id, division FROM agents WHERE status != ?').all('disabled') as Array<{
      id: string;
      division: string;
    }>;
    for (const a of agentRows) {
      if (!divisionAgentMap.has(a.division)) divisionAgentMap.set(a.division, a.id);
    }

    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, title, description, project_id, command_id, agent_id, division,
        status, priority, requires_approval, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertStep = db.prepare(`
      INSERT INTO execution_steps (
        id, run_id, step_index, division, agent_id, task_id, title, objective,
        task_category, complexity, status, requires_approval, input_summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    planSteps.forEach((step, idx) => {
      const taskId = newId('tsk');
      const stepId = newId('stp');
      const agentId = cmd.assigned_agent_id || divisionAgentMap.get(step.division) || null;
      const initialStatus = step.requiresApproval ? 'awaiting_approval' : 'pending';

      insertTask.run(
        taskId,
        step.title,
        step.rationale,
        cmd.project_id,
        commandId,
        agentId,
        step.division,
        initialStatus,
        step.requiresApproval ? 'high' : 'medium',
        step.requiresApproval ? 1 : 0,
        cmd.created_by,
        runStart,
        runStart
      );

      insertStep.run(
        stepId,
        runId,
        idx,
        step.division,
        agentId,
        taskId,
        step.title,
        step.rationale,
        step.taskCategory,
        step.complexity,
        initialStatus,
        step.requiresApproval ? 1 : 0,
        interpretedObjective
      );
    });

    db.prepare(`
      UPDATE commands
      SET assigned_division = ?,
          status = 'planned',
          progress_percent = 15,
          progress_stage = ?,
          execution_note = ?,
          plan_json = ?,
          clarification_json = '[]',
          latest_run_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      assignedDivisions[0] || 'COMMAND',
      `Execution plan ready (${planSteps.length} steps via ${planRes.providerKey}/${planRes.model})`,
      String(parsed.summary || interpretedObjective),
      JSON.stringify(planSteps),
      runId,
      runStart,
      commandId
    );

    logEvent({
      level: 'info',
      subsystem: 'COMMAND',
      action: 'execution_run.planned',
      message: `Planned ${planSteps.length}-step multi-agent run across ${assignedDivisions.join(', ')} using ${planRes.providerKey}/${planRes.model}.`,
      entityType: 'execution_run',
      entityId: runId,
      actorId,
      actorName,
    });

    if (options.autoExecute !== false) {
      return await continueExecutionRun(runId, actorId, actorName);
    }

    return getExecutionRunWithSteps(runId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failedAt = new Date().toISOString();
    db.prepare(`
      UPDATE commands
      SET status = 'failed',
          progress_stage = 'Planning failed',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `).run(errMsg, failedAt, commandId);

    logEvent({
      level: 'error',
      subsystem: 'COMMAND',
      action: 'command.planning_failed',
      message: `Directive planning failed: ${errMsg}`,
      entityType: 'command',
      entityId: commandId,
      actorId,
      actorName,
    });
    return null;
  }
}

export async function continueExecutionRun(
  runId: string,
  actorId: string,
  actorName: string
): Promise<ExecutionRunRecord> {
  const db = getDb();
  const run = getExecutionRunWithSteps(runId);
  if (!run) throw new Error('Execution run not found.');

  const now = new Date().toISOString();
  db.prepare("UPDATE execution_runs SET status = 'running', current_stage = 'Executing division workflows' WHERE id = ?").run(
    runId
  );
  db.prepare("UPDATE commands SET status = 'running', progress_stage = 'Executing multi-agent workflow', updated_at = ? WHERE id = ?").run(
    now,
    run.commandId
  );

  const priorOutputs: Array<{ division: DivisionCode; title: string; output: string }> = [];
  let totalTokens = run.totalTokens;
  let pausedForApproval = false;
  let failedCount = 0;

  for (const step of run.steps) {
    if (step.status === 'completed' || step.status === 'skipped') {
      if (step.outputSummary) {
        priorOutputs.push({ division: step.division, title: step.title, output: step.outputSummary });
      }
      continue;
    }

    if (step.status === 'awaiting_approval') {
      pausedForApproval = true;
      break;
    }

    if (step.status === 'failed') {
      failedCount++;
      continue;
    }

    const stepStart = new Date().toISOString();
    db.prepare(`
      UPDATE execution_steps
      SET status = 'waiting_ai', started_at = ?
      WHERE id = ?
    `).run(stepStart, step.id);

    if (step.taskId) {
      db.prepare("UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ?").run(stepStart, step.taskId);
    }
    db.prepare('UPDATE execution_runs SET current_stage = ? WHERE id = ?').run(
      `Waiting on ${step.division}: ${step.title}`,
      runId
    );
    db.prepare('UPDATE commands SET progress_stage = ?, updated_at = ? WHERE id = ?').run(
      `Running ${step.division}: ${step.title}`,
      stepStart,
      run.commandId
    );

    try {
      const result = await executeDivisionStep({
        runId,
        stepId: step.id,
        commandId: run.commandId,
        projectId: run.projectId,
        division: step.division,
        agentId: step.agentId,
        title: step.title,
        objective: step.objective,
        taskCategory: step.taskCategory,
        complexity: step.complexity,
        originalInstruction: run.originalInstruction,
        priorOutputs,
        actorId,
        actorName,
      });

      const stepDone = new Date().toISOString();
      totalTokens += result.tokensUsed;

      db.prepare(`
        UPDATE execution_steps
        SET status = 'completed',
            provider_key = ?,
            model_name = ?,
            routing_reason = ?,
            output_summary = ?,
            output_creation_id = ?,
            output_file_id = ?,
            tokens_used = ?,
            latency_ms = ?,
            completed_at = ?
        WHERE id = ?
      `).run(
        result.providerKey,
        result.modelName,
        result.routingReason,
        result.outputSummary,
        result.outputCreationId,
        result.outputFileId,
        result.tokensUsed,
        result.latencyMs,
        stepDone,
        step.id
      );

      if (step.taskId) {
        db.prepare("UPDATE tasks SET status = 'completed', result_notes = ?, updated_at = ? WHERE id = ?").run(
          result.outputSummary.slice(0, 1000),
          stepDone,
          step.taskId
        );
      }

      priorOutputs.push({ division: step.division, title: step.title, output: result.outputSummary });

      // Update real step-completion percentage on parent command
      const currentSteps = db.prepare('SELECT status FROM execution_steps WHERE run_id = ?').all(runId) as Array<{
        status: string;
      }>;
      const doneSteps = currentSteps.filter((s) => s.status === 'completed').length;
      const pct = Math.round((doneSteps / Math.max(1, currentSteps.length)) * 90);
      db.prepare('UPDATE commands SET progress_percent = ?, updated_at = ? WHERE id = ?').run(
        pct,
        stepDone,
        run.commandId
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errAt = new Date().toISOString();
      failedCount++;

      db.prepare(`
        UPDATE execution_steps
        SET status = 'failed',
            error_message = ?,
            completed_at = ?
        WHERE id = ?
      `).run(errMsg, errAt, step.id);

      if (step.taskId) {
        db.prepare("UPDATE tasks SET status = 'failed', result_notes = ?, updated_at = ? WHERE id = ?").run(
          errMsg,
          errAt,
          step.taskId
        );
      }

      logEvent({
        level: 'error',
        subsystem: step.division,
        action: 'execution_step.failed',
        message: `Step "${step.title}" failed: ${errMsg}`,
        entityType: 'execution_step',
        entityId: step.id,
        actorId,
        actorName,
      });
    }
  }

  const finalState = getExecutionRunWithSteps(runId)!;
  const completedCount = finalState.steps.filter((s) => s.status === 'completed').length;
  const totalCount = finalState.steps.length;
  const remainingSteps = finalState.steps.filter((s) => s.status !== 'completed' && s.status !== 'skipped');
  const finishedAt = new Date().toISOString();

  if (pausedForApproval) {
    db.prepare(`
      UPDATE execution_runs
      SET status = 'awaiting_approval',
          current_stage = 'Paused for operator approval',
          total_tokens = ?,
          remaining_work = ?
      WHERE id = ?
    `).run(
      totalTokens,
      `Awaiting approval on ${remainingSteps.map((s) => s.title).join(', ')}`,
      runId
    );
    db.prepare(`
      UPDATE commands
      SET status = 'awaiting_approval',
          progress_stage = 'Paused · Approval required for external/gated step',
          updated_at = ?
      WHERE id = ?
    `).run(finishedAt, run.commandId);

    return getExecutionRunWithSteps(runId)!;
  }

  // Synthesize final completion report via COMMAND
  let finalReport = '';
  try {
    const synth = await executeRoutedAiTask({
      division: 'COMMAND',
      taskCategory: 'planning',
      complexity: 'low',
      runId,
      actorId,
      systemInstruction:
        'You are TAURUS COMMAND compiling a concise, plain-language executive completion report for the operator. Summarize strictly what was actually produced, which deliverables were saved to My Creations or Library, any failures, and any remaining manual/external steps. Never exaggerate or claim external deployments that did not happen.',
      prompt: `Original Directive: ${run.originalInstruction}\nCompleted Steps (${completedCount}/${totalCount}):\n${finalState.steps
        .map(
          (s) =>
            `- [${s.status.toUpperCase()}] ${s.division}: ${s.title}${
              s.outputSummary ? `\n  Output: ${s.outputSummary.slice(0, 500)}` : ''
            }${s.errorMessage ? `\n  Error: ${s.errorMessage}` : ''}`
        )
        .join('\n')}`,
    });
    totalTokens += synth.totalTokens;
    finalReport = synth.text;
  } catch {
    finalReport = `Completed ${completedCount} of ${totalCount} steps.${
      failedCount > 0 ? ` ${failedCount} step(s) failed.` : ''
    }`;
  }

  const runStatus =
    completedCount === totalCount
      ? 'completed'
      : completedCount > 0
        ? 'partial'
        : 'failed';
  const cmdStatus = runStatus;
  const progressPercent = runStatus === 'completed' ? 100 : Math.round((completedCount / Math.max(1, totalCount)) * 100);
  const remainingWork =
    remainingSteps.length > 0
      ? remainingSteps.map((s) => `${s.division}: ${s.title} (${s.status})`).join('; ')
      : null;

  db.prepare(`
    UPDATE execution_runs
    SET status = ?,
        current_stage = ?,
        final_report = ?,
        remaining_work = ?,
        total_tokens = ?,
        completed_at = ?
    WHERE id = ?
  `).run(
    runStatus,
    runStatus === 'completed' ? 'Completed' : runStatus === 'partial' ? 'Partially completed' : 'Failed',
    finalReport,
    remainingWork,
    totalTokens,
    finishedAt,
    runId
  );

  db.prepare(`
    UPDATE commands
    SET status = ?,
        progress_percent = ?,
        progress_stage = ?,
        execution_note = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    cmdStatus,
    progressPercent,
    runStatus === 'completed'
      ? `Completed (${completedCount}/${totalCount} steps)`
      : runStatus === 'partial'
        ? `Partial (${completedCount}/${totalCount} steps completed)`
        : 'Execution failed',
    finalReport,
    finishedAt,
    run.commandId
  );

  logEvent({
    level: runStatus === 'completed' ? 'success' : runStatus === 'partial' ? 'warn' : 'error',
    subsystem: 'COMMAND',
    action: `execution_run.${runStatus}`,
    message: `Execution run ${runId} finished as ${runStatus} (${completedCount}/${totalCount} steps, ${totalTokens} tokens).`,
    entityType: 'execution_run',
    entityId: runId,
    actorId,
    actorName,
  });

  return getExecutionRunWithSteps(runId)!;
}

export async function synthesizeNaturalLanguageVenture(
  input: { sourceIdea: string; projectId?: string | null },
  actorId: string,
  actorName: string
): Promise<{ ventureId: string; creationId: string; projectId: string }> {
  const db = getDb();
  const aiRes = await executeRoutedAiTask({
    division: 'FORGE',
    taskCategory: 'strategy',
    complexity: 'high',
    actorId,
    jsonMode: true,
    geminiSchema: {
      type: Type.OBJECT,
      properties: {
        ventureName: { type: Type.STRING },
        targetMarket: { type: Type.STRING },
        productType: { type: Type.STRING },
        revenueModel: { type: Type.STRING },
        constraints: { type: Type.STRING },
        businessConcept: { type: Type.STRING },
        targetAudience: { type: Type.STRING },
        marketOpportunity: { type: Type.STRING },
        productRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
        operationalRequirements: { type: Type.ARRAY, items: { type: Type.STRING } },
        initialDevelopmentTasks: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              division: { type: Type.STRING },
              description: { type: Type.STRING },
            },
          },
        },
        growthStrategy: { type: Type.STRING },
        financialConsiderations: { type: Type.STRING },
        blueprintMarkdown: { type: Type.STRING },
      },
    },
    systemInstruction:
      'You are TAURUS Business Foundry (combining ATLAS research, FORGE product engineering, VANGUARD growth, and TREASURY economics). From the operator natural-language business description, extract a complete structured venture specification AND a clean Markdown blueprint. Never claim the business is launched or generating revenue yet. Return strict JSON with keys: ventureName, targetMarket, productType, revenueModel, constraints, businessConcept, targetAudience, marketOpportunity, productRequirements (string[]), operationalRequirements (string[]), initialDevelopmentTasks (array of {title, division, description}), growthStrategy, financialConsiderations, blueprintMarkdown.',
    prompt: `Business Idea:\n"${input.sourceIdea}"`,
  });

  const parsed = extractJsonObject(aiRes.text) as Record<string, unknown>;
  const now = new Date().toISOString();

  const ventureName = String(parsed.ventureName || parsed.name || 'New Venture').slice(0, 120);
  const targetMarket = String(parsed.targetMarket || '').slice(0, 200);
  const productType = String(parsed.productType || '').slice(0, 200);
  const revenueModel = String(parsed.revenueModel || '').slice(0, 200);
  const constraints = String(parsed.constraints || '').slice(0, 300);

  const structuredSpec: VentureStructuredSpec = {
    businessConcept: String(parsed.businessConcept || input.sourceIdea),
    targetAudience: String(parsed.targetAudience || targetMarket),
    marketOpportunity: String(parsed.marketOpportunity || ''),
    productRequirements: Array.isArray(parsed.productRequirements)
      ? parsed.productRequirements.map(String)
      : [],
    revenueModel,
    operationalRequirements: Array.isArray(parsed.operationalRequirements)
      ? parsed.operationalRequirements.map(String)
      : [],
    initialDevelopmentTasks: Array.isArray(parsed.initialDevelopmentTasks)
      ? (parsed.initialDevelopmentTasks as Array<{ title?: string; division?: string; description?: string }>).map((t) => ({
          title: String(t.title || 'Development Task'),
          division: sanitizeDivision(t.division),
          description: String(t.description || ''),
        }))
      : [],
    growthStrategy: String(parsed.growthStrategy || ''),
    financialConsiderations: String(parsed.financialConsiderations || ''),
  };

  const blueprintMarkdown =
    String(parsed.blueprintMarkdown || '').trim() ||
    `# ${ventureName}\n\n## Concept\n${structuredSpec.businessConcept}\n\n## Target Audience\n${structuredSpec.targetAudience}\n\n## Market Opportunity\n${structuredSpec.marketOpportunity}\n\n## Revenue Model\n${structuredSpec.revenueModel}\n\n## Growth Strategy\n${structuredSpec.growthStrategy}\n\n## Financial Considerations\n${structuredSpec.financialConsiderations}`;

  // Create or link project
  let targetProjectId = input.projectId || null;
  if (!targetProjectId) {
    targetProjectId = newId('prj');
    db.prepare(`
      INSERT INTO projects (id, name, description, category, status, owner_id, created_at, updated_at, archived_at)
      VALUES (?, ?, ?, 'Business Foundry', 'active', ?, ?, ?, NULL)
    `).run(targetProjectId, ventureName, structuredSpec.businessConcept.slice(0, 280), actorId, now, now);
  }

  const ventureId = newId('vnt');
  db.prepare(`
    INSERT INTO ventures (
      id, name, source_idea, target_market, product_type, revenue_model, constraints,
      project_id, status, blueprint_markdown, structured_spec_json,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'blueprint_created', ?, ?, ?, ?, ?)
  `).run(
    ventureId,
    ventureName,
    input.sourceIdea,
    targetMarket,
    productType,
    revenueModel,
    constraints,
    targetProjectId,
    blueprintMarkdown,
    JSON.stringify(structuredSpec),
    actorId,
    now,
    now
  );

  // Save blueprint in Library & My Creations
  const stored = saveFileToStorage(Buffer.from(blueprintMarkdown, 'utf8'), `${ventureName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-blueprint.md`);
  const fileId = newId('fil');
  db.prepare(`
    INSERT INTO library_files (
      id, original_name, storage_name, category, mime_type,
      size_bytes, sha256, project_id, description, uploaded_by, created_at
    ) VALUES (?, ?, ?, 'business_assets', 'text/markdown', ?, ?, ?, ?, ?, ?)
  `).run(
    fileId,
    stored.safeOriginalName,
    stored.storageName,
    stored.sizeBytes,
    stored.sha256,
    targetProjectId,
    `Business Foundry blueprint for ${ventureName}`,
    actorId,
    now
  );

  const creationId = newId('crt');
  db.prepare(`
    INSERT INTO creations (
      id, title, category, description, project_id, command_id,
      content_type, content_body, library_file_id, is_interactive,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, 'business', ?, ?, NULL, 'markdown', ?, ?, 0, 'ready', ?, ?, ?)
  `).run(
    creationId,
    `${ventureName} — Venture Blueprint`,
    `Generated via Business Foundry (${aiRes.providerKey}/${aiRes.model}). Status: Blueprint Created (pending review & approval).`,
    targetProjectId,
    blueprintMarkdown,
    fileId,
    actorId,
    now,
    now
  );

  logEvent({
    level: 'success',
    subsystem: 'FORGE',
    action: 'venture.blueprint_created',
    message: `Created venture blueprint "${ventureName}" via ${aiRes.providerKey}/${aiRes.model} and linked project ${targetProjectId}.`,
    entityType: 'venture',
    entityId: ventureId,
    actorId,
    actorName,
  });

  return { ventureId, creationId, projectId: targetProjectId };
}
