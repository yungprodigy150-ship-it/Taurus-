import { Type } from '@google/genai';
import type { CommandPlanStep, DivisionCode } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { getGeminiServerClient, isGeminiVerifiedConnected } from './aiProvider.ts';
import { logEvent } from './logger.ts';

interface IntakeAnalysisResult {
  primaryDivision: DivisionCode;
  requiresApproval: boolean;
  summary: string;
  steps: CommandPlanStep[];
}

const VALID_DIVISIONS: DivisionCode[] = [
  'COMMAND',
  'FORGE',
  'VANGUARD',
  'SENTRY',
  'ATLAS',
  'NEXUS',
  'TREASURY',
];

function sanitizeDivision(val: string | undefined): DivisionCode {
  const upper = (val || '').toUpperCase() as DivisionCode;
  return VALID_DIVISIONS.includes(upper) ? upper : 'COMMAND';
}

export async function analyzeCommandIntake(commandId: string, actorId: string, actorName: string): Promise<void> {
  const db = getDb();
  const cmd = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId) as
    | { id: string; prompt: string; project_id: string | null; assigned_agent_id: string | null }
    | undefined;

  if (!cmd) throw new Error('Command not found');

  const now = new Date().toISOString();

  // Only invoke Gemini if server key exists AND integration has been verified/connected or user explicitly runs AI intake
  const geminiClient = getGeminiServerClient();
  const geminiVerified = isGeminiVerifiedConnected();

  if (!geminiClient || !geminiVerified) {
    const reason = !geminiClient
      ? 'No AI provider key configured on server.'
      : 'Google Gemini integration has not been verified in Integrations yet.';

    db.prepare(`
      UPDATE commands
      SET status = 'queued',
          progress_percent = 15,
          progress_stage = 'Queued for operator review',
          execution_note = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      `Intake saved persistently. ${reason} Verify an AI provider in Integrations to enable AI-assisted task decomposition, or manage tasks manually.`,
      now,
      commandId
    );

    logEvent({
      level: 'info',
      subsystem: 'COMMAND',
      action: 'command.queued',
      message: `Command recorded in intake queue (${reason})`,
      entityType: 'command',
      entityId: commandId,
      actorId,
      actorName,
    });
    return;
  }

  db.prepare(`
    UPDATE commands
    SET status = 'analyzing',
        progress_percent = 30,
        progress_stage = 'Structuring operational plan via Gemini',
        updated_at = ?
    WHERE id = ?
  `).run(now, commandId);

  try {
    const response = await geminiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Analyze this operational directive for the TAURUS platform and break it into concrete, honest operational steps:\n\n"${cmd.prompt}"`,
      config: {
        systemInstruction:
          'You are TAURUS Command Intake Planner (Phase 1). Decompose the operator directive into 3 to 5 clear execution steps across TAURUS divisions (COMMAND, FORGE, VANGUARD, SENTRY, ATLAS, NEXUS, TREASURY). Be strictly truthful: Phase 1 supports planning, project structuring, and document/blueprint authoring; live external deployments, payments, or browser automation require Phase 2 execution engines and must be marked phaseAvailability="phase_2_required" and requiresApproval=true.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            primaryDivision: { type: Type.STRING },
            requiresApproval: { type: Type.BOOLEAN },
            summary: { type: Type.STRING },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  division: { type: Type.STRING },
                  phaseAvailability: { type: Type.STRING },
                  requiresApproval: { type: Type.BOOLEAN },
                  rationale: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const rawText = (response.text ?? '{}').trim();
    const parsed = JSON.parse(rawText) as Partial<IntakeAnalysisResult>;
    const primaryDivision = sanitizeDivision(parsed.primaryDivision);
    const steps: CommandPlanStep[] = (Array.isArray(parsed.steps) ? parsed.steps : []).slice(0, 6).map((s) => ({
      title: String(s.title || 'Operational Step').slice(0, 140),
      division: sanitizeDivision(s.division),
      phaseAvailability: s.phaseAvailability === 'phase_2_required' ? 'phase_2_required' : 'phase_1_planned',
      requiresApproval: Boolean(s.requiresApproval),
      rationale: String(s.rationale || '').slice(0, 400),
    }));

    const needsApproval = Boolean(parsed.requiresApproval) || steps.some((s) => s.requiresApproval);
    const nextStatus = needsApproval ? 'awaiting_approval' : 'planned';
    const doneAt = new Date().toISOString();

    db.prepare(`
      UPDATE commands
      SET assigned_division = ?,
          status = ?,
          progress_percent = ?,
          progress_stage = ?,
          execution_note = ?,
          plan_json = ?,
          error_message = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(
      primaryDivision,
      nextStatus,
      needsApproval ? 60 : 50,
      needsApproval ? 'Plan generated · Awaiting operator approval' : 'Execution plan structured',
      String(parsed.summary || 'Structured operational plan created. Autonomous runtime execution is reserved for Phase 2+.'),
      JSON.stringify(steps),
      doneAt,
      commandId
    );

    // Create persistent tasks linked to this command & project
    const insertTask = db.prepare(`
      INSERT INTO tasks (
        id, title, description, project_id, command_id, agent_id, division,
        status, priority, requires_approval, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const divisionAgentMap = new Map<string, string>();
    const agents = db.prepare('SELECT id, division FROM agents').all() as Array<{ id: string; division: string }>;
    for (const a of agents) {
      if (!divisionAgentMap.has(a.division)) divisionAgentMap.set(a.division, a.id);
    }

    for (const step of steps) {
      const taskId = newId('tsk');
      const taskStatus = step.requiresApproval ? 'awaiting_approval' : 'pending';
      const targetAgentId = cmd.assigned_agent_id || divisionAgentMap.get(step.division) || null;
      const note =
        step.phaseAvailability === 'phase_2_required'
          ? `${step.rationale} (Requires Phase 2 autonomous execution engine)`
          : step.rationale;

      insertTask.run(
        taskId,
        step.title,
        note,
        cmd.project_id,
        commandId,
        targetAgentId,
        step.division,
        taskStatus,
        step.requiresApproval ? 'high' : 'medium',
        step.requiresApproval ? 1 : 0,
        actorId,
        doneAt,
        doneAt
      );
    }

    logEvent({
      level: 'success',
      subsystem: 'COMMAND',
      action: 'command.planned',
      message: `Structured ${steps.length} tasks for directive via Gemini (${primaryDivision}).`,
      entityType: 'command',
      entityId: commandId,
      actorId,
      actorName,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const failedAt = new Date().toISOString();
    db.prepare(`
      UPDATE commands
      SET status = 'failed',
          progress_stage = 'Intake analysis failed',
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `).run(errMsg, failedAt, commandId);

    logEvent({
      level: 'error',
      subsystem: 'COMMAND',
      action: 'command.analysis_failed',
      message: `Command analysis failed: ${errMsg}`,
      entityType: 'command',
      entityId: commandId,
      actorId,
      actorName,
    });
  }
}

export async function synthesizeVentureBlueprint(
  ventureId: string,
  actorId: string,
  actorName: string
): Promise<{ blueprintMarkdown: string; creationId: string }> {
  const db = getDb();
  const venture = db.prepare('SELECT * FROM ventures WHERE id = ?').get(ventureId) as
    | {
        id: string;
        name: string;
        target_market: string;
        product_type: string;
        revenue_model: string;
        constraints: string;
        project_id: string | null;
      }
    | undefined;

  if (!venture) throw new Error('Venture blueprint not found.');

  const client = getGeminiServerClient();
  const verified = isGeminiVerifiedConnected();
  if (!client || !verified) {
    throw new Error(
      'Google Gemini must be verified in Integrations before synthesizing an AI-assisted venture blueprint.'
    );
  }

  const response = await client.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Create a structured, execution-ready business & product architecture document in Markdown for:
- Venture Name: ${venture.name}
- Target Market: ${venture.target_market || 'International digital market'}
- Product Type: ${venture.product_type || 'Digital product'}
- Revenue Model: ${venture.revenue_model || 'Direct digital sales'}
- Operational Constraints: ${venture.constraints || 'None specified'}

Include sections:
1. Executive Positioning
2. Product & Technical Architecture
3. International Distribution & Pricing Strategy
4. Phase 1 Deliverables vs Phase 2 Execution Requirements (be explicit about what requires external payment/deployment integrations).`,
  });

  const markdown = (response.text ?? '').trim();
  if (!markdown) {
    throw new Error('AI provider returned empty blueprint content.');
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE ventures
    SET blueprint_markdown = ?,
        status = 'architected',
        updated_at = ?
    WHERE id = ?
  `).run(markdown, now, ventureId);

  const creationId = newId('crt');
  db.prepare(`
    INSERT INTO creations (
      id, title, category, description, project_id, command_id,
      content_type, content_body, library_file_id, status,
      created_by, created_at, updated_at
    ) VALUES (?, ?, 'business', ?, ?, NULL, 'markdown', ?, NULL, 'ready', ?, ?, ?)
  `).run(
    creationId,
    `${venture.name} — Venture Architecture`,
    `Business Foundry blueprint for ${venture.target_market || 'international market'} (${venture.product_type || 'digital product'}).`,
    venture.project_id,
    markdown,
    actorId,
    now,
    now
  );

  logEvent({
    level: 'success',
    subsystem: 'FORGE',
    action: 'venture.architected',
    message: `Synthesized venture blueprint for "${venture.name}" and registered deliverable in My Creations.`,
    entityType: 'venture',
    entityId: ventureId,
    actorId,
    actorName,
  });

  return { blueprintMarkdown: markdown, creationId };
}
