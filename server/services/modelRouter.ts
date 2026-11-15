import type { Schema } from '@google/genai';
import type {
  AiExecutionAuditRecord,
  AiProviderKey,
  DivisionCode,
  RoutingPolicy,
  TaskCategory,
  TaskComplexity,
} from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { DEFAULT_ROUTING_POLICY, newId } from '../db/seed.ts';
import {
  executeProviderRequest,
  listIntegrations,
  ProviderExecutionError,
  type UnifiedAiResponse,
} from './aiProvider.ts';
import { logEvent } from './logger.ts';

export interface RouteDecision {
  providerKey: AiProviderKey;
  model: string;
  tier: 'fast' | 'reasoning' | 'coding';
  routingReason: string;
}

export interface RoutedAiCallInput {
  division: DivisionCode;
  taskCategory: TaskCategory;
  complexity: TaskComplexity;
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  geminiSchema?: Schema;
  preferredProvider?: AiProviderKey | 'auto';
  preferredModel?: string;
  runId?: string | null;
  stepId?: string | null;
  actorId?: string | null;
  timeoutMs?: number;
}

export interface RoutedAiCallOutput extends UnifiedAiResponse {
  routingReason: string;
  fallbackUsed: boolean;
  tier: 'fast' | 'reasoning' | 'coding';
}

export function getRoutingPolicy(): RoutingPolicy {
  const db = getDb();
  const row = db
    .prepare("SELECT value_json FROM system_settings WHERE key = 'routing_policy'")
    .get() as { value_json: string } | undefined;

  if (!row) return DEFAULT_ROUTING_POLICY;
  try {
    const parsed = JSON.parse(row.value_json) as Partial<RoutingPolicy>;
    return {
      preferredProvider: parsed.preferredProvider || 'auto',
      fallbackOrder:
        Array.isArray(parsed.fallbackOrder) && parsed.fallbackOrder.length > 0
          ? parsed.fallbackOrder
          : DEFAULT_ROUTING_POLICY.fallbackOrder,
      preferCostEfficiency:
        typeof parsed.preferCostEfficiency === 'boolean'
          ? parsed.preferCostEfficiency
          : DEFAULT_ROUTING_POLICY.preferCostEfficiency,
      tierModels: {
        fast: { ...DEFAULT_ROUTING_POLICY.tierModels.fast, ...(parsed.tierModels?.fast || {}) },
        reasoning: { ...DEFAULT_ROUTING_POLICY.tierModels.reasoning, ...(parsed.tierModels?.reasoning || {}) },
        coding: { ...DEFAULT_ROUTING_POLICY.tierModels.coding, ...(parsed.tierModels?.coding || {}) },
      },
    };
  } catch {
    return DEFAULT_ROUTING_POLICY;
  }
}

export function saveRoutingPolicy(updates: Partial<RoutingPolicy>, actorId: string, actorName: string): RoutingPolicy {
  const current = getRoutingPolicy();
  const next: RoutingPolicy = {
    preferredProvider: updates.preferredProvider ?? current.preferredProvider,
    fallbackOrder: updates.fallbackOrder ?? current.fallbackOrder,
    preferCostEfficiency:
      typeof updates.preferCostEfficiency === 'boolean' ? updates.preferCostEfficiency : current.preferCostEfficiency,
    tierModels: {
      fast: { ...current.tierModels.fast, ...(updates.tierModels?.fast || {}) },
      reasoning: { ...current.tierModels.reasoning, ...(updates.tierModels?.reasoning || {}) },
      coding: { ...current.tierModels.coding, ...(updates.tierModels?.coding || {}) },
    },
  };

  const db = getDb();
  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES ('routing_policy', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(JSON.stringify(next), new Date().toISOString());

  logEvent({
    level: 'info',
    subsystem: 'NEXUS',
    action: 'routing_policy.updated',
    message: `Updated AI model routing policy (preferred: ${next.preferredProvider}, fallback: ${next.fallbackOrder.join(' -> ')}).`,
    entityType: 'system_settings',
    entityId: 'routing_policy',
    actorId,
    actorName,
  });

  return next;
}

function selectTier(
  taskCategory: TaskCategory,
  complexity: TaskComplexity,
  promptLength: number
): 'fast' | 'reasoning' | 'coding' {
  if (taskCategory === 'coding') return 'coding';
  if (complexity === 'high' || taskCategory === 'strategy' || taskCategory === 'research' || taskCategory === 'financial') {
    return 'reasoning';
  }
  if (complexity === 'low' && promptLength < 2500 && (taskCategory === 'monitoring' || taskCategory === 'general')) {
    return 'fast';
  }
  return complexity === 'low' ? 'fast' : 'reasoning';
}

function resolveModelForProvider(
  providerKey: AiProviderKey,
  tier: 'fast' | 'reasoning' | 'coding',
  policy: RoutingPolicy,
  discoveredModels: string[] | undefined,
  defaultModel: string | undefined,
  preferredModel?: string
): string {
  if (preferredModel && preferredModel !== 'none' && preferredModel !== 'intelligent_router') {
    if (!discoveredModels || discoveredModels.length === 0 || discoveredModels.includes(preferredModel)) {
      return preferredModel;
    }
  }

  const tierCandidate = policy.tierModels[tier]?.[providerKey];
  if (tierCandidate) {
    if (!discoveredModels || discoveredModels.length === 0 || discoveredModels.includes(tierCandidate)) {
      return tierCandidate;
    }
  }

  if (defaultModel) return defaultModel;
  if (discoveredModels && discoveredModels.length > 0) return discoveredModels[0];

  if (providerKey === 'google_gemini') return 'gemini-4-hydrogen';
  if (providerKey === 'groq') return 'llama-3.3-70b-versatile';
  return 'gpt-4o-mini';
}

export function buildRoutingCandidates(input: {
  taskCategory: TaskCategory;
  complexity: TaskComplexity;
  promptLength: number;
  preferredProvider?: AiProviderKey | 'auto';
  preferredModel?: string;
}): { tier: 'fast' | 'reasoning' | 'coding'; candidates: RouteDecision[] } {
  const policy = getRoutingPolicy();
  const integrations = listIntegrations().filter((i) => i.category === 'ai_provider');
  const connected = integrations.filter((i) => i.connectionStatus === 'connected');

  const tier = selectTier(input.taskCategory, input.complexity, input.promptLength);

  // Order connected providers by explicit preference -> policy preference -> cost/speed heuristic -> fallback order
  const orderedKeys: AiProviderKey[] = [];
  const pushUnique = (k: AiProviderKey) => {
    if (!orderedKeys.includes(k) && connected.some((c) => c.providerKey === k)) {
      orderedKeys.push(k);
    }
  };

  if (input.preferredProvider && input.preferredProvider !== 'auto') {
    pushUnique(input.preferredProvider);
  }
  if (policy.preferredProvider && policy.preferredProvider !== 'auto') {
    pushUnique(policy.preferredProvider);
  }

  // Dynamic task-aware ordering when policy is 'auto'
  if (tier === 'fast' && policy.preferCostEfficiency) {
    pushUnique('groq');
    pushUnique('google_gemini');
    pushUnique('openai');
  } else if (tier === 'coding') {
    pushUnique('openai');
    pushUnique('google_gemini');
    pushUnique('groq');
  } else {
    for (const k of policy.fallbackOrder) pushUnique(k);
  }

  // Append any remaining connected providers
  for (const c of connected) {
    pushUnique(c.providerKey as AiProviderKey);
  }

  const candidates: RouteDecision[] = orderedKeys.map((providerKey, idx) => {
    const meta = connected.find((c) => c.providerKey === providerKey)!;
    const model = resolveModelForProvider(
      providerKey,
      tier,
      policy,
      meta.discoveredModels,
      meta.config.defaultModel,
      idx === 0 ? input.preferredModel : undefined
    );

    const reasonParts = [
      `tier=${tier}`,
      `category=${input.taskCategory}`,
      `complexity=${input.complexity}`,
      idx === 0 ? 'primary route' : `fallback #${idx}`,
    ];
    if (input.promptLength > 8000) reasonParts.push('extended-context');

    return {
      providerKey,
      model,
      tier,
      routingReason: reasonParts.join(' · '),
    };
  });

  return { tier, candidates };
}

function recordAiAudit(entry: Omit<AiExecutionAuditRecord, 'id' | 'createdAt'> & { createdBy?: string | null }): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO ai_executions (
        id, run_id, step_id, division, task_category, complexity,
        provider_key, model_name, routing_reason, fallback_used,
        status, prompt_tokens, completion_tokens, total_tokens,
        latency_ms, error_message, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('ai'),
      entry.runId,
      entry.stepId,
      entry.division,
      entry.taskCategory,
      entry.complexity,
      entry.providerKey,
      entry.modelName,
      entry.routingReason,
      entry.fallbackUsed ? 1 : 0,
      entry.status,
      entry.promptTokens,
      entry.completionTokens,
      entry.totalTokens,
      entry.latencyMs,
      entry.errorMessage,
      entry.createdBy ?? null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to record AI audit:', err instanceof Error ? err.message : String(err));
  }
}

export async function executeRoutedAiTask(input: RoutedAiCallInput): Promise<RoutedAiCallOutput> {
  const { tier, candidates } = buildRoutingCandidates({
    taskCategory: input.taskCategory,
    complexity: input.complexity,
    promptLength: input.prompt.length + (input.systemInstruction?.length || 0),
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
  });

  if (candidates.length === 0) {
    throw new Error(
      'No verified AI providers are currently connected. Open Integrations and run "Verify Connection" on Google Gemini, Groq, or OpenAI first.'
    );
  }

  const errors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const isFallback = i > 0;

    try {
      const response = await executeProviderRequest({
        providerKey: candidate.providerKey,
        model: candidate.model,
        prompt: input.prompt,
        systemInstruction: input.systemInstruction,
        jsonMode: input.jsonMode,
        geminiSchema: candidate.providerKey === 'google_gemini' ? input.geminiSchema : undefined,
        timeoutMs: input.timeoutMs ?? 60000,
        maxRetries: 2,
      });

      recordAiAudit({
        runId: input.runId ?? null,
        stepId: input.stepId ?? null,
        division: input.division,
        taskCategory: input.taskCategory,
        complexity: input.complexity,
        providerKey: response.providerKey,
        modelName: response.model,
        routingReason: candidate.routingReason,
        fallbackUsed: isFallback,
        status: 'success',
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        totalTokens: response.totalTokens,
        latencyMs: response.latencyMs,
        errorMessage: null,
        createdBy: input.actorId ?? null,
      });

      return {
        ...response,
        routingReason: candidate.routingReason,
        fallbackUsed: isFallback,
        tier,
      };
    } catch (err) {
      const errMsg = err instanceof ProviderExecutionError ? err.message : String(err);
      errors.push(`${candidate.providerKey}/${candidate.model}: ${errMsg}`);

      recordAiAudit({
        runId: input.runId ?? null,
        stepId: input.stepId ?? null,
        division: input.division,
        taskCategory: input.taskCategory,
        complexity: input.complexity,
        providerKey: candidate.providerKey,
        modelName: candidate.model,
        routingReason: candidate.routingReason,
        fallbackUsed: isFallback,
        status: 'error',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
        errorMessage: errMsg,
        createdBy: input.actorId ?? null,
      });

      logEvent({
        level: 'warn',
        subsystem: 'NEXUS',
        action: isFallback ? 'ai.fallback_failed' : 'ai.primary_failed',
        message: `AI execution failed on ${candidate.providerKey} (${candidate.model}): ${errMsg}${
          i + 1 < candidates.length ? ` — attempting fallback to ${candidates[i + 1].providerKey}.` : ''
        }`,
        entityType: input.runId ? 'execution_run' : null,
        entityId: input.runId ?? null,
        actorId: input.actorId ?? null,
      });
    }
  }

  throw new Error(`All configured AI providers failed. Details: ${errors.join(' | ')}`);
}

export function listRecentAiExecutions(limit = 40): AiExecutionAuditRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM ai_executions ORDER BY created_at DESC LIMIT ?').all(limit) as Array<
    Record<string, unknown>
  >;

  return rows.map((r) => ({
    id: String(r.id),
    runId: r.run_id ? String(r.run_id) : null,
    stepId: r.step_id ? String(r.step_id) : null,
    division: String(r.division),
    taskCategory: String(r.task_category),
    complexity: String(r.complexity),
    providerKey: String(r.provider_key),
    modelName: String(r.model_name),
    routingReason: String(r.routing_reason),
    fallbackUsed: Boolean(r.fallback_used),
    status: r.status as 'success' | 'error',
    promptTokens: Number(r.prompt_tokens ?? 0),
    completionTokens: Number(r.completion_tokens ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    latencyMs: Number(r.latency_ms ?? 0),
    errorMessage: r.error_message ? String(r.error_message) : null,
    createdAt: String(r.created_at),
  }));
}
