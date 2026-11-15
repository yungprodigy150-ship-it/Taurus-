import type {
  CreationCategory,
  CreationContentType,
  DivisionCode,
  TaskCategory,
  TaskComplexity,
} from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { inspectWebPage } from './browserAdapter.ts';
import { listGithubRepos, queueEmailForApproval } from './externalIntegrations.ts';
import { logEvent } from './logger.ts';
import { executeRoutedAiTask } from './modelRouter.ts';
import { saveFileToStorage } from './storage.ts';

export interface DivisionExecutionContext {
  runId: string;
  stepId: string;
  commandId: string;
  projectId: string | null;
  division: DivisionCode;
  agentId: string | null;
  title: string;
  objective: string;
  taskCategory: TaskCategory;
  complexity: TaskComplexity;
  originalInstruction: string;
  priorOutputs: Array<{ division: DivisionCode; title: string; output: string }>;
  actorId: string;
  actorName: string;
}

export interface DivisionExecutionResult {
  outputSummary: string;
  providerKey: string | null;
  modelName: string | null;
  routingReason: string | null;
  tokensUsed: number;
  latencyMs: number;
  outputCreationId: string | null;
  outputFileId: string | null;
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi);
  return matches ? Array.from(new Set(matches)).slice(0, 3) : [];
}

function saveGeneratedLibraryText(input: {
  filename: string;
  content: string;
  category: 'source_code' | 'documents' | 'research' | 'business_assets' | 'generated_materials';
  mimeType: string;
  projectId: string | null;
  description: string;
  actorId: string;
}): string {
  const db = getDb();
  const buf = Buffer.from(input.content, 'utf8');
  const stored = saveFileToStorage(buf, input.filename);
  const fileId = newId('fil');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO library_files (
      id, original_name, storage_name, category, mime_type,
      size_bytes, sha256, project_id, description, uploaded_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fileId,
    stored.safeOriginalName,
    stored.storageName,
    input.category,
    input.mimeType,
    stored.sizeBytes,
    stored.sha256,
    input.projectId,
    input.description,
    input.actorId,
    now
  );

  return fileId;
}

function saveGeneratedCreation(input: {
  title: string;
  category: CreationCategory;
  description: string;
  projectId: string | null;
  commandId: string | null;
  runId: string | null;
  contentType: CreationContentType;
  contentBody: string;
  libraryFileId: string | null;
  isInteractive: boolean;
  actorId: string;
}): string {
  const db = getDb();
  const creationId = newId('crt');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO creations (
      id, title, category, description, project_id, command_id, execution_run_id,
      content_type, content_body, library_file_id, deployed_url, is_interactive,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'ready', ?, ?, ?)
  `).run(
    creationId,
    input.title.slice(0, 140),
    input.category,
    input.description.slice(0, 300),
    input.projectId,
    input.commandId,
    input.runId,
    input.contentType,
    input.contentBody,
    input.libraryFileId,
    input.isInteractive ? 1 : 0,
    input.actorId,
    now,
    now
  );

  return creationId;
}

function stripMarkdownCodeFence(text: string): string {
  const match = text.match(/```(?:html|json|markdown)?\s*\n([\s\S]*?)```/i);
  return match ? match[1].trim() : text.trim();
}

function formatPriorContext(priorOutputs: DivisionExecutionContext['priorOutputs']): string {
  if (priorOutputs.length === 0) return 'No prior division outputs yet.';
  return priorOutputs
    .map((p) => `### [${p.division}] ${p.title}\n${p.output.slice(0, 1800)}`)
    .join('\n\n');
}

export async function executeDivisionStep(ctx: DivisionExecutionContext): Promise<DivisionExecutionResult> {
  const startedAt = Date.now();
  const priorContext = formatPriorContext(ctx.priorOutputs);

  // SENTRY performs real programmatic operational & health verification combined with AI synthesis
  if (ctx.division === 'SENTRY') {
    const db = getDb();
    const integrations = db
      .prepare('SELECT provider_key, display_name, connection_status, last_error FROM integrations')
      .all() as Array<{
      provider_key: string;
      display_name: string;
      connection_status: string;
      last_error: string | null;
    }>;
    const stepStats = db
      .prepare('SELECT status, COUNT(*) as count FROM execution_steps WHERE run_id = ? GROUP BY status')
      .all(ctx.runId) as Array<{ status: string; count: number }>;

    const systemSnapshot = {
      integrations,
      runStepBreakdown: stepStats,
      priorDivisionsCompleted: ctx.priorOutputs.map((p) => p.division),
    };

    const aiRes = await executeRoutedAiTask({
      division: 'SENTRY',
      taskCategory: 'monitoring',
      complexity: 'low',
      runId: ctx.runId,
      stepId: ctx.stepId,
      actorId: ctx.actorId,
      systemInstruction:
        'You are TAURUS SENTRY (Monitoring & Operational Security). Review the real execution telemetry snapshot and prior division outputs. Identify actual gaps, unverified integrations, incomplete work, or security/approval considerations. Never fabricate metrics.',
      prompt: `Objective: ${ctx.objective}\nOriginal Instruction: ${ctx.originalInstruction}\n\nReal System & Run Snapshot:\n${JSON.stringify(
        systemSnapshot,
        null,
        2
      )}\n\nPrior Outputs:\n${priorContext}`,
    });

    const fileId = saveGeneratedLibraryText({
      filename: `sentry-audit-${ctx.runId}.md`,
      content: aiRes.text,
      category: 'documents',
      mimeType: 'text/markdown',
      projectId: ctx.projectId,
      description: `SENTRY operational audit for "${ctx.title}"`,
      actorId: ctx.actorId,
    });

    return {
      outputSummary: aiRes.text,
      providerKey: aiRes.providerKey,
      modelName: aiRes.model,
      routingReason: aiRes.routingReason,
      tokensUsed: aiRes.totalTokens,
      latencyMs: aiRes.latencyMs,
      outputCreationId: null,
      outputFileId: fileId,
    };
  }

  // ATLAS performs real URL inspection when URLs exist, plus structured market/competitor research
  if (ctx.division === 'ATLAS') {
    const urls = extractUrls(`${ctx.originalInstruction} ${ctx.objective}`);
    const inspectedPages: string[] = [];

    for (const url of urls) {
      try {
        const page = await inspectWebPage(url, ctx.actorId, ctx.actorName);
        inspectedPages.push(
          `URL: ${page.finalUrl} (${page.mode}, HTTP ${page.statusCode})\nTitle: ${page.title}\nMeta: ${page.metaDescription}\nHeadings: ${page.headings.join(
            ' | '
          )}\nExcerpt: ${page.textExcerpt}`
        );
      } catch (err) {
        inspectedPages.push(`URL: ${url} — Inspection error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const aiRes = await executeRoutedAiTask({
      division: 'ATLAS',
      taskCategory: 'research',
      complexity: ctx.complexity,
      runId: ctx.runId,
      stepId: ctx.stepId,
      actorId: ctx.actorId,
      systemInstruction:
        'You are TAURUS ATLAS (Research & Intelligence). Produce a structured, grounded research brief in Markdown. Clearly distinguish verified live web observations (if provided) from analytical market knowledge. Do not invent live web statistics or pretend to have browsed websites that were not fetched.',
      prompt: `Research Task: ${ctx.title}\nObjective: ${ctx.objective}\nOriginal Operator Instruction: ${ctx.originalInstruction}\n\nLive Web Inspection Data:\n${
        inspectedPages.length > 0 ? inspectedPages.join('\n\n') : 'No target URLs supplied for live fetch.'
      }\n\nPrior Context:\n${priorContext}`,
    });

    const slug = ctx.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'research';
    const fileId = saveGeneratedLibraryText({
      filename: `atlas-${slug}.md`,
      content: aiRes.text,
      category: 'research',
      mimeType: 'text/markdown',
      projectId: ctx.projectId,
      description: `ATLAS research brief: ${ctx.title}`,
      actorId: ctx.actorId,
    });

    const creationId = saveGeneratedCreation({
      title: `Research: ${ctx.title}`,
      category: 'document',
      description: 'ATLAS market and intelligence dossier',
      projectId: ctx.projectId,
      commandId: ctx.commandId,
      runId: ctx.runId,
      contentType: 'markdown',
      contentBody: aiRes.text,
      libraryFileId: fileId,
      isInteractive: false,
      actorId: ctx.actorId,
    });

    return {
      outputSummary: aiRes.text,
      providerKey: aiRes.providerKey,
      modelName: aiRes.model,
      routingReason: aiRes.routingReason,
      tokensUsed: aiRes.totalTokens,
      latencyMs: Date.now() - startedAt,
      outputCreationId: creationId,
      outputFileId: fileId,
    };
  }

  // FORGE creates tangible websites, interactive HTML/JS apps, software specs, or business blueprints
  if (ctx.division === 'FORGE') {
    const wantsWebsiteOrApp = /\b(website|web\s*app|landing\s*page|site|html|storefront|frontend|page|app)\b/i.test(
      `${ctx.title} ${ctx.objective} ${ctx.originalInstruction}`
    );

    if (wantsWebsiteOrApp) {
      const aiRes = await executeRoutedAiTask({
        division: 'FORGE',
        taskCategory: 'coding',
        complexity: 'high',
        runId: ctx.runId,
        stepId: ctx.stepId,
        actorId: ctx.actorId,
        systemInstruction:
          'You are TAURUS FORGE (Product & Web Engineering). Output ONLY a complete, self-contained, responsive HTML5 document (with embedded Tailwind CDN or clean inline CSS and interactive vanilla JavaScript) implementing the requested website or web application. Use real domain copy, accessible contrast, and working interactive elements (forms, calculators, service selectors, navigation). Do not wrap in explanations outside the HTML.',
        prompt: `Build Deliverable: ${ctx.title}\nObjective: ${ctx.objective}\nOperator Instruction: ${ctx.originalInstruction}\n\nResearch & Strategy Context:\n${priorContext}`,
      });

      const htmlContent = stripMarkdownCodeFence(aiRes.text);
      const slug = ctx.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'website';

      const fileId = saveGeneratedLibraryText({
        filename: `${slug}.html`,
        content: htmlContent,
        category: 'source_code',
        mimeType: 'text/html',
        projectId: ctx.projectId,
        description: `FORGE generated interactive deliverable: ${ctx.title}`,
        actorId: ctx.actorId,
      });

      const creationId = saveGeneratedCreation({
        title: ctx.title,
        category: /\bapp\b/i.test(ctx.title) ? 'application' : 'website',
        description: `Generated by FORGE (${aiRes.providerKey} / ${aiRes.model}). Local interactive preview ready; not externally deployed.`,
        projectId: ctx.projectId,
        commandId: ctx.commandId,
        runId: ctx.runId,
        contentType: 'html',
        contentBody: htmlContent,
        libraryFileId: fileId,
        isInteractive: true,
        actorId: ctx.actorId,
      });

      return {
        outputSummary: `Generated interactive HTML deliverable "${ctx.title}" (${Buffer.byteLength(
          htmlContent,
          'utf8'
        )} bytes) and saved to My Creations & Library.`,
        providerKey: aiRes.providerKey,
        modelName: aiRes.model,
        routingReason: aiRes.routingReason,
        tokensUsed: aiRes.totalTokens,
        latencyMs: aiRes.latencyMs,
        outputCreationId: creationId,
        outputFileId: fileId,
      };
    }

    const aiRes = await executeRoutedAiTask({
      division: 'FORGE',
      taskCategory: ctx.taskCategory === 'coding' ? 'coding' : 'strategy',
      complexity: ctx.complexity,
      runId: ctx.runId,
      stepId: ctx.stepId,
      actorId: ctx.actorId,
      systemInstruction:
        'You are TAURUS FORGE (Business & Product Creation). Produce a concrete, actionable product/business specification in Markdown based on the operator directive and prior division outputs. Clearly label what is created as a blueprint vs what requires Phase 3 deployment or external setup.',
      prompt: `Deliverable: ${ctx.title}\nObjective: ${ctx.objective}\nOperator Instruction: ${ctx.originalInstruction}\n\nPrior Context:\n${priorContext}`,
    });

    const slug = ctx.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'blueprint';
    const fileId = saveGeneratedLibraryText({
      filename: `forge-${slug}.md`,
      content: aiRes.text,
      category: 'business_assets',
      mimeType: 'text/markdown',
      projectId: ctx.projectId,
      description: `FORGE specification: ${ctx.title}`,
      actorId: ctx.actorId,
    });

    const creationId = saveGeneratedCreation({
      title: ctx.title,
      category: 'business',
      description: `FORGE product & business specification (${aiRes.providerKey} / ${aiRes.model})`,
      projectId: ctx.projectId,
      commandId: ctx.commandId,
      runId: ctx.runId,
      contentType: 'markdown',
      contentBody: aiRes.text,
      libraryFileId: fileId,
      isInteractive: false,
      actorId: ctx.actorId,
    });

    return {
      outputSummary: aiRes.text,
      providerKey: aiRes.providerKey,
      modelName: aiRes.model,
      routingReason: aiRes.routingReason,
      tokensUsed: aiRes.totalTokens,
      latencyMs: aiRes.latencyMs,
      outputCreationId: creationId,
      outputFileId: fileId,
    };
  }

  // NEXUS handles external tool & integration execution (GitHub, Email Outbox, Browser URL inspection)
  if (ctx.division === 'NEXUS') {
    const urls = extractUrls(`${ctx.objective} ${ctx.originalInstruction}`);
    const toolFindings: string[] = [];

    if (urls.length > 0) {
      for (const u of urls) {
        try {
          const page = await inspectWebPage(u, ctx.actorId, ctx.actorName);
          toolFindings.push(`Browser/HTTP inspection of ${page.finalUrl} (${page.mode}): Title="${page.title}", Headings=[${page.headings.join(', ')}]`);
        } catch (err) {
          toolFindings.push(`Browser inspection of ${u} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (/\bgithub|repo|repository\b/i.test(`${ctx.title} ${ctx.objective}`)) {
      try {
        const repos = await listGithubRepos(ctx.actorId, ctx.actorName);
        toolFindings.push(
          `GitHub accessible repositories (${repos.length}): ${repos
            .slice(0, 8)
            .map((r) => r.fullName)
            .join(', ')}`
        );
      } catch (err) {
        toolFindings.push(`GitHub check: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const emailMatch = `${ctx.objective} ${ctx.originalInstruction}`.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch && /\b(email|send|outreach|mail)\b/i.test(`${ctx.title} ${ctx.objective}`)) {
      const drafted = await executeRoutedAiTask({
        division: 'NEXUS',
        taskCategory: 'general',
        complexity: 'low',
        runId: ctx.runId,
        stepId: ctx.stepId,
        actorId: ctx.actorId,
        systemInstruction: 'Draft a concise, professional plain-text email body and subject line for the requested task. Output JSON with keys "subject" and "body".',
        prompt: `Task: ${ctx.objective}\nContext:\n${priorContext}`,
        jsonMode: true,
      });

      let subject = ctx.title;
      let body = drafted.text;
      try {
        const parsed = JSON.parse(stripMarkdownCodeFence(drafted.text)) as { subject?: string; body?: string };
        if (parsed.subject) subject = parsed.subject;
        if (parsed.body) body = parsed.body;
      } catch {}

      const queued = queueEmailForApproval(
        {
          toEmail: emailMatch[0],
          subject,
          bodyText: body,
          projectId: ctx.projectId,
          runId: ctx.runId,
        },
        ctx.actorId,
        ctx.actorName
      );

      return {
        outputSummary: `Drafted email to ${queued.toEmail} ("${queued.subject}") and placed it in the Integrations Email Outbox awaiting explicit Owner approval before sending.`,
        providerKey: drafted.providerKey,
        modelName: drafted.model,
        routingReason: drafted.routingReason,
        tokensUsed: drafted.totalTokens,
        latencyMs: Date.now() - startedAt,
        outputCreationId: null,
        outputFileId: null,
      };
    }

    const aiRes = await executeRoutedAiTask({
      division: 'NEXUS',
      taskCategory: 'integration',
      complexity: ctx.complexity,
      runId: ctx.runId,
      stepId: ctx.stepId,
      actorId: ctx.actorId,
      systemInstruction:
        'You are TAURUS NEXUS (Integrations & External Tools). Summarize real tool outputs and integration readiness accurately. Never claim external accounts were modified unless explicitly confirmed in the tool results.',
      prompt: `Task: ${ctx.title}\nObjective: ${ctx.objective}\nTool Results:\n${
        toolFindings.length > 0 ? toolFindings.join('\n') : 'No external tool calls triggered.'
      }\n\nPrior Context:\n${priorContext}`,
    });

    return {
      outputSummary: aiRes.text,
      providerKey: aiRes.providerKey,
      modelName: aiRes.model,
      routingReason: aiRes.routingReason,
      tokensUsed: aiRes.totalTokens,
      latencyMs: Date.now() - startedAt,
      outputCreationId: null,
      outputFileId: null,
    };
  }

  // VANGUARD (Strategy & Growth), TREASURY (Financial Projections), or COMMAND (Coordination)
  const divisionPersona: Record<string, string> = {
    VANGUARD:
      'You are TAURUS VANGUARD (Strategy & Market Growth). Develop a concrete positioning, pricing, customer acquisition, and launch strategy grounded in the objective and research context.',
    TREASURY:
      'You are TAURUS TREASURY (Financial Operations). Produce transparent unit economics, startup/monthly operating cost estimates, pricing tiers, and break-even projections in Markdown tables. Clearly mark all financial numbers as modeled projections, not historical revenue.',
    COMMAND:
      'You are TAURUS COMMAND (Central Coordination). Synthesize the task objective clearly and provide structured operational guidance.',
  };

  const aiRes = await executeRoutedAiTask({
    division: ctx.division,
    taskCategory: ctx.division === 'TREASURY' ? 'financial' : ctx.division === 'VANGUARD' ? 'strategy' : ctx.taskCategory,
    complexity: ctx.complexity,
    runId: ctx.runId,
    stepId: ctx.stepId,
    actorId: ctx.actorId,
    systemInstruction: divisionPersona[ctx.division] || divisionPersona.COMMAND,
    prompt: `Task: ${ctx.title}\nObjective: ${ctx.objective}\nOriginal Instruction: ${ctx.originalInstruction}\n\nPrior Division Outputs:\n${priorContext}`,
  });

  const slug = ctx.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || ctx.division.toLowerCase();
  const fileId = saveGeneratedLibraryText({
    filename: `${ctx.division.toLowerCase()}-${slug}.md`,
    content: aiRes.text,
    category: ctx.division === 'TREASURY' ? 'business_assets' : 'documents',
    mimeType: 'text/markdown',
    projectId: ctx.projectId,
    description: `${ctx.division} output: ${ctx.title}`,
    actorId: ctx.actorId,
  });

  const creationId = saveGeneratedCreation({
    title: `${ctx.division}: ${ctx.title}`,
    category: 'document',
    description: `${ctx.division} deliverable (${aiRes.providerKey} / ${aiRes.model})`,
    projectId: ctx.projectId,
    commandId: ctx.commandId,
    runId: ctx.runId,
    contentType: 'markdown',
    contentBody: aiRes.text,
    libraryFileId: fileId,
    isInteractive: false,
    actorId: ctx.actorId,
  });

  logEvent({
    level: 'success',
    subsystem: ctx.division,
    action: 'division.step_completed',
    message: `${ctx.division} completed "${ctx.title}" via ${aiRes.providerKey}/${aiRes.model} (${aiRes.totalTokens} tokens).`,
    entityType: 'execution_step',
    entityId: ctx.stepId,
    actorId: ctx.actorId,
    actorName: ctx.actorName,
  });

  return {
    outputSummary: aiRes.text,
    providerKey: aiRes.providerKey,
    modelName: aiRes.model,
    routingReason: aiRes.routingReason,
    tokensUsed: aiRes.totalTokens,
    latencyMs: aiRes.latencyMs,
    outputCreationId: creationId,
    outputFileId: fileId,
  };
}
