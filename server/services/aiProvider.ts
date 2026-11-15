import { GoogleGenAI, type Schema } from '@google/genai';
import type { AiProviderKey, ConnectionStatus, IntegrationProviderKey, IntegrationRecord } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { syncDivisionCapabilitiesAndStatus } from '../db/seed.ts';
import { decryptSecret, encryptSecret } from './crypto.ts';
import { logEvent } from './logger.ts';

export interface RawIntegrationRow {
  id: string;
  provider_key: IntegrationProviderKey;
  display_name: string;
  category: 'ai_provider' | 'developer' | 'messaging' | 'automation' | 'api';
  auth_type: 'env_secret' | 'encrypted_token' | 'endpoint_config';
  connection_status: ConnectionStatus;
  encrypted_credentials: string | null;
  config_json: string;
  account_label: string | null;
  last_tested_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
  updated_at: string;
}

export interface UnifiedAiRequest {
  providerKey: AiProviderKey;
  model: string;
  prompt: string;
  systemInstruction?: string;
  jsonMode?: boolean;
  geminiSchema?: Schema;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface UnifiedAiResponse {
  text: string;
  providerKey: AiProviderKey;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  attempts: number;
}

export class ProviderExecutionError extends Error {
  providerKey: AiProviderKey;
  model: string;
  statusCode?: number;
  retryable: boolean;
  attempts: number;

  constructor(
    message: string,
    opts: { providerKey: AiProviderKey; model: string; statusCode?: number; retryable?: boolean; attempts?: number }
  ) {
    super(message);
    this.providerKey = opts.providerKey;
    this.model = opts.model;
    this.statusCode = opts.statusCode;
    this.retryable = Boolean(opts.retryable);
    this.attempts = opts.attempts ?? 1;
  }
}

export function getGeminiServerClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function getIntegrationRow(providerKey: IntegrationProviderKey): RawIntegrationRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM integrations WHERE provider_key = ?').get(providerKey) as
    | RawIntegrationRow
    | undefined;
}

export function getProviderSecret(row: RawIntegrationRow): string | null {
  if (row.provider_key === 'google_gemini') {
    return process.env.GEMINI_API_KEY?.trim() || null;
  }
  if (row.encrypted_credentials) {
    return decryptSecret(row.encrypted_credentials);
  }
  if (row.provider_key === 'groq') return process.env.GROQ_API_KEY?.trim() || null;
  if (row.provider_key === 'openai') return process.env.OPENAI_API_KEY?.trim() || null;
  if (row.provider_key === 'github') return process.env.GITHUB_TOKEN?.trim() || null;
  if (row.provider_key === 'email_services') return process.env.RESEND_API_KEY?.trim() || null;
  return null;
}

export function parseIntegrationConfig(row: RawIntegrationRow): Record<string, string> {
  try {
    return JSON.parse(row.config_json || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function toSanitizedIntegration(row: RawIntegrationRow): IntegrationRecord {
  const config = parseIntegrationConfig(row);

  let discoveredModels: string[] | undefined;
  if (config.discoveredModels) {
    try {
      discoveredModels = JSON.parse(config.discoveredModels) as string[];
    } catch {
      discoveredModels = undefined;
    }
  }

  let hasCredential = false;
  let credentialSource: 'environment' | 'encrypted_vault' | 'none' = 'none';

  if (row.provider_key === 'google_gemini') {
    if (process.env.GEMINI_API_KEY?.trim()) {
      hasCredential = true;
      credentialSource = 'environment';
    }
  } else if (row.encrypted_credentials) {
    hasCredential = true;
    credentialSource = 'encrypted_vault';
  } else if (
    (row.provider_key === 'groq' && process.env.GROQ_API_KEY) ||
    (row.provider_key === 'openai' && process.env.OPENAI_API_KEY) ||
    (row.provider_key === 'github' && process.env.GITHUB_TOKEN) ||
    (row.provider_key === 'email_services' && process.env.RESEND_API_KEY) ||
    (row.provider_key === 'browser_automation' && config.endpointUrl) ||
    (row.provider_key === 'external_apis' && config.healthUrl)
  ) {
    hasCredential = true;
    credentialSource = 'environment';
  }

  // Expose safe config keys (omit serialized discoveredModels string in favor of typed array)
  const safeConfig: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k !== 'discoveredModels') safeConfig[k] = v;
  }

  return {
    id: row.id,
    providerKey: row.provider_key,
    displayName: row.display_name,
    category: row.category,
    authType: row.auth_type,
    connectionStatus: row.connection_status,
    hasCredential,
    credentialSource,
    config: safeConfig,
    discoveredModels,
    accountLabel: row.account_label,
    lastTestedAt: row.last_tested_at,
    lastLatencyMs: row.last_latency_ms,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function listIntegrations(): IntegrationRecord[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM integrations ORDER BY id ASC').all() as unknown as RawIntegrationRow[];
  return rows.map(toSanitizedIntegration);
}

export function isGeminiVerifiedConnected(): boolean {
  const row = getIntegrationRow('google_gemini');
  return Boolean(process.env.GEMINI_API_KEY?.trim()) && row?.connection_status === 'connected';
}

export function saveIntegrationCredentials(
  providerKey: IntegrationProviderKey,
  credential: string | null,
  configUpdates: Record<string, string>,
  actorId: string,
  actorName: string
): IntegrationRecord {
  if (providerKey === 'google_gemini') {
    throw new Error('Google Gemini credentials are managed externally via GEMINI_API_KEY environment secrets.');
  }

  const db = getDb();
  const existing = getIntegrationRow(providerKey);
  if (!existing) {
    throw new Error(`Unknown integration provider: ${providerKey}`);
  }

  const currentConfig = parseIntegrationConfig(existing);
  const mergedConfig = { ...currentConfig, ...configUpdates };
  const encrypted = credential && credential.trim() ? encryptSecret(credential.trim()) : existing.encrypted_credentials;
  const now = new Date().toISOString();

  const nextStatus: ConnectionStatus =
    encrypted || mergedConfig.endpointUrl || mergedConfig.healthUrl
      ? 'configured_untested'
      : 'not_configured';

  db.prepare(`
    UPDATE integrations
    SET encrypted_credentials = ?,
        config_json = ?,
        connection_status = ?,
        last_error = NULL,
        updated_at = ?
    WHERE provider_key = ?
  `).run(encrypted, JSON.stringify(mergedConfig), nextStatus, now, providerKey);

  syncDivisionCapabilitiesAndStatus();

  logEvent({
    level: 'info',
    subsystem: 'NEXUS',
    action: 'integration.configured',
    message: `Updated encrypted configuration for ${existing.display_name}. Connection remains untested until verified.`,
    entityType: 'integration',
    entityId: existing.id,
    actorId,
    actorName,
  });

  return toSanitizedIntegration(getIntegrationRow(providerKey)!);
}

export function clearIntegrationCredentials(
  providerKey: IntegrationProviderKey,
  actorId: string,
  actorName: string
): IntegrationRecord {
  if (providerKey === 'google_gemini') {
    throw new Error('Google Gemini environment credentials cannot be cleared from the application.');
  }

  const db = getDb();
  const existing = getIntegrationRow(providerKey);
  if (!existing) throw new Error(`Unknown integration provider: ${providerKey}`);

  const currentConfig = parseIntegrationConfig(existing);
  if ('endpointUrl' in currentConfig) currentConfig.endpointUrl = '';
  if ('healthUrl' in currentConfig) currentConfig.healthUrl = '';
  delete currentConfig.discoveredModels;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE integrations
    SET encrypted_credentials = NULL,
        config_json = ?,
        connection_status = 'not_configured',
        account_label = NULL,
        last_tested_at = NULL,
        last_latency_ms = NULL,
        last_error = NULL,
        updated_at = ?
    WHERE provider_key = ?
  `).run(JSON.stringify(currentConfig), now, providerKey);

  syncDivisionCapabilitiesAndStatus();

  logEvent({
    level: 'warn',
    subsystem: 'NEXUS',
    action: 'integration.cleared',
    message: `Cleared stored credentials for ${existing.display_name}.`,
    entityType: 'integration',
    entityId: existing.id,
    actorId,
    actorName,
  });

  return toSanitizedIntegration(getIntegrationRow(providerKey)!);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status?: number): boolean {
  if (!status) return true;
  return status === 429 || status === 408 || status >= 500;
}

async function executeOpenAiCompatibleCompletion(
  providerKey: 'groq' | 'openai',
  baseUrl: string,
  token: string,
  req: UnifiedAiRequest
): Promise<Omit<UnifiedAiResponse, 'latencyMs' | 'attempts'>> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (req.systemInstruction) {
    messages.push({ role: 'system', content: req.systemInstruction });
  }
  messages.push({ role: 'user', content: req.prompt });

  const bodyPayload: Record<string, unknown> = {
    model: req.model,
    messages,
  };
  if (req.jsonMode) {
    bodyPayload.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
    signal: AbortSignal.timeout(req.timeoutMs ?? 45000),
  });

  if (!res.ok) {
    let errDetail = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody.error?.message) errDetail = `${errDetail}: ${errBody.error.message}`;
    } catch {
      // fallback to status
    }
    throw new ProviderExecutionError(`${providerKey} request failed (${errDetail})`, {
      providerKey,
      model: req.model,
      statusCode: res.status,
      retryable: isRetryableStatus(res.status),
    });
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  };

  const text = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!text) {
    throw new ProviderExecutionError(`${providerKey} returned an empty completion.`, {
      providerKey,
      model: req.model,
      retryable: false,
    });
  }

  return {
    text,
    providerKey,
    model: data.model || req.model,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };
}

async function executeGeminiCompletion(
  req: UnifiedAiRequest
): Promise<Omit<UnifiedAiResponse, 'latencyMs' | 'attempts'>> {
  const client = getGeminiServerClient();
  if (!client) {
    throw new ProviderExecutionError('GEMINI_API_KEY is not configured on the server.', {
      providerKey: 'google_gemini',
      model: req.model,
      statusCode: 401,
      retryable: false,
    });
  }

  try {
    const config: Record<string, unknown> = {};
    if (req.systemInstruction) config.systemInstruction = req.systemInstruction;
    if (req.jsonMode) config.responseMimeType = 'application/json';
    if (req.geminiSchema) config.responseSchema = req.geminiSchema;

    const response = await client.models.generateContent({
      model: req.model,
      contents: req.prompt,
      config: Object.keys(config).length > 0 ? config : undefined,
    });

    const text = (response.text ?? '').trim();
    if (!text) {
      throw new ProviderExecutionError('Gemini returned an empty response.', {
        providerKey: 'google_gemini',
        model: req.model,
        retryable: false,
      });
    }

    const usage = response.usageMetadata;
    return {
      text,
      providerKey: 'google_gemini',
      model: req.model,
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
    };
  } catch (err) {
    if (err instanceof ProviderExecutionError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    const statusMatch = msg.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
    const statusCode = statusMatch ? Number(statusMatch[1]) : undefined;
    throw new ProviderExecutionError(`Gemini request failed: ${msg}`, {
      providerKey: 'google_gemini',
      model: req.model,
      statusCode,
      retryable: isRetryableStatus(statusCode),
    });
  }
}

export async function executeProviderRequest(req: UnifiedAiRequest): Promise<UnifiedAiResponse> {
  const row = getIntegrationRow(req.providerKey);
  if (!row) {
    throw new ProviderExecutionError(`Unknown provider ${req.providerKey}`, {
      providerKey: req.providerKey,
      model: req.model,
      retryable: false,
    });
  }

  const maxRetries = req.maxRetries ?? 2;
  const startedAt = Date.now();
  let lastError: ProviderExecutionError | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      let result: Omit<UnifiedAiResponse, 'latencyMs' | 'attempts'>;

      if (req.providerKey === 'google_gemini') {
        result = await executeGeminiCompletion(req);
      } else {
        const token = getProviderSecret(row);
        if (!token) {
          throw new ProviderExecutionError(`No API key configured for ${row.display_name}.`, {
            providerKey: req.providerKey,
            model: req.model,
            statusCode: 401,
            retryable: false,
          });
        }
        const config = parseIntegrationConfig(row);
        const baseUrl =
          config.baseUrl ||
          (req.providerKey === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
        result = await executeOpenAiCompatibleCompletion(req.providerKey, baseUrl, token, req);
      }

      return {
        ...result,
        latencyMs: Date.now() - startedAt,
        attempts: attempt,
      };
    } catch (err) {
      const pErr =
        err instanceof ProviderExecutionError
          ? err
          : new ProviderExecutionError(err instanceof Error ? err.message : String(err), {
              providerKey: req.providerKey,
              model: req.model,
              retryable: false,
            });
      pErr.attempts = attempt;
      lastError = pErr;

      if (!pErr.retryable || attempt > maxRetries) {
        throw pErr;
      }

      // Exponential backoff for transient rate limits / 5xx
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }

  throw lastError!;
}

export async function testIntegrationConnection(
  providerKey: IntegrationProviderKey,
  actorId: string,
  actorName: string
): Promise<IntegrationRecord> {
  const db = getDb();
  const row = getIntegrationRow(providerKey);
  if (!row) {
    throw new Error(`Unknown integration provider: ${providerKey}`);
  }

  const config = parseIntegrationConfig(row);
  const startedAt = Date.now();
  const testedAt = new Date().toISOString();

  let nextStatus: ConnectionStatus = 'error';
  let accountLabel: string | null = null;
  let errorMessage: string | null = null;

  try {
    if (providerKey === 'google_gemini') {
      const client = getGeminiServerClient();
      if (!client) {
        nextStatus = 'not_configured';
        throw new Error('GEMINI_API_KEY environment variable is not set.');
      }

      // 1. Discover official models from Gemini API
      const discovered: string[] = [];
      try {
        const pager = await client.models.list({ config: { pageSize: 50 } });
        for await (const m of pager) {
          if (m.name) {
            discovered.push(m.name.replace(/^models\//, ''));
          }
        }
      } catch {
        // If list endpoint is restricted on key tier, continue with direct generateContent probe
      }

      // 2. Verify actual completion execution on default model (and fallback to gemini-3.1-flash-lite if needed)
      let verifiedModel = config.defaultModel || 'gemini-4-hydrogen';
      try {
        await executeProviderRequest({
          providerKey: 'google_gemini',
          model: verifiedModel,
          prompt: 'Respond with exactly: OK',
          maxRetries: 0,
          timeoutMs: 20000,
        });
      } catch (primaryErr) {
        if (verifiedModel !== 'gemini-3.1-flash-lite') {
          await executeProviderRequest({
            providerKey: 'google_gemini',
            model: 'gemini-3.1-flash-lite',
            prompt: 'Respond with exactly: OK',
            maxRetries: 0,
            timeoutMs: 20000,
          });
          verifiedModel = 'gemini-3.1-flash-lite';
        } else {
          throw primaryErr;
        }
      }

      if (discovered.length > 0) {
        config.discoveredModels = JSON.stringify(discovered.slice(0, 30));
      } else {
        config.discoveredModels = JSON.stringify([verifiedModel]);
      }
      config.defaultModel = verifiedModel;

      nextStatus = 'connected';
      accountLabel = `Verified completion on ${verifiedModel}${discovered.length > 0 ? ` (${discovered.length} models listed)` : ''}`;
    } else if (providerKey === 'groq') {
      const token = getProviderSecret(row);
      if (!token) {
        nextStatus = 'not_configured';
        throw new Error('No Groq API key configured in encrypted vault or environment.');
      }
      const groqBaseUrl = (config.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
      const modelsRes = await fetch(`${groqBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!modelsRes.ok) {
        throw new Error(`Groq authentication failed with HTTP ${modelsRes.status}.`);
      }
      const modelsData = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      const modelIds = (modelsData.data || []).map((m) => m.id);
      const testModel =
        modelIds.find((id) => id === (config.defaultModel || 'llama-3.3-70b-versatile')) ||
        modelIds.find((id) => id.includes('llama')) ||
        modelIds[0];

      if (!testModel) {
        throw new Error('No executable Groq models returned for this API key.');
      }

      // Prove real completion execution works, not just key lookup
      await executeProviderRequest({
        providerKey: 'groq',
        model: testModel,
        prompt: 'Respond with exactly: OK',
        maxRetries: 0,
        timeoutMs: 20000,
      });

      config.discoveredModels = JSON.stringify(modelIds.slice(0, 30));
      config.defaultModel = testModel;
      nextStatus = 'connected';
      accountLabel = `Verified completion on ${testModel} (${modelIds.length} models)`;
    } else if (providerKey === 'openai') {
      const token = getProviderSecret(row);
      if (!token) {
        nextStatus = 'not_configured';
        throw new Error('No OpenAI API key configured in encrypted vault or environment.');
      }
      const openaiBaseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
      const modelsRes = await fetch(`${openaiBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!modelsRes.ok) {
        throw new Error(`OpenAI authentication failed with HTTP ${modelsRes.status}.`);
      }
      const modelsData = (await modelsRes.json()) as { data?: Array<{ id: string }> };
      const modelIds = (modelsData.data || []).map((m) => m.id);
      const testModel =
        modelIds.find((id) => id === (config.defaultModel || 'gpt-4o-mini')) ||
        modelIds.find((id) => id.startsWith('gpt-4o')) ||
        modelIds[0] ||
        'gpt-4o-mini';

      await executeProviderRequest({
        providerKey: 'openai',
        model: testModel,
        prompt: 'Respond with exactly: OK',
        maxRetries: 0,
        timeoutMs: 20000,
      });

      config.discoveredModels = JSON.stringify(
        modelIds.filter((id) => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')).slice(0, 30)
      );
      config.defaultModel = testModel;
      nextStatus = 'connected';
      accountLabel = `Verified completion on ${testModel} (${modelIds.length} total models)`;
    } else if (providerKey === 'github') {
      const token = getProviderSecret(row);
      if (!token) {
        nextStatus = 'not_configured';
        throw new Error('No GitHub personal access token configured.');
      }
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Taurus-Operations-Platform',
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        throw new Error(`GitHub authentication failed with HTTP ${res.status}.`);
      }
      const user = (await res.json()) as { login?: string; public_repos?: number };
      nextStatus = 'connected';
      accountLabel = user.login ? `@${user.login}` : 'Authenticated GitHub account';
    } else if (providerKey === 'email_services') {
      const token = getProviderSecret(row);
      if (!token) {
        nextStatus = 'not_configured';
        throw new Error('No Email service (Resend) API key configured.');
      }
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        throw new Error(`Email service authentication failed with HTTP ${res.status}.`);
      }
      const domains = (await res.json()) as { data?: Array<{ name: string }> };
      nextStatus = 'connected';
      accountLabel = `${domains.data?.length ?? 0} verified sending domains`;
    } else if (providerKey === 'browser_automation') {
      const endpoint = config.endpointUrl?.trim();
      if (!endpoint) {
        nextStatus = 'not_configured';
        throw new Error(
          'No remote Chromium CDP / WebDriver endpoint configured. Public URL HTML inspection still works via HTTP Fetch Adapter.'
        );
      }
      const probeUrl = endpoint.endsWith('/json/version') ? endpoint : `${endpoint.replace(/\/$/, '')}/json/version`;
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) {
        throw new Error(`Browser automation endpoint responded with HTTP ${res.status}.`);
      }
      const info = (await res.json()) as { Browser?: string };
      nextStatus = 'connected';
      accountLabel = info.Browser || 'Remote browser CDP endpoint verified';
    } else if (providerKey === 'external_apis') {
      const healthUrl = config.healthUrl?.trim();
      if (!healthUrl) {
        nextStatus = 'not_configured';
        throw new Error('No external API health check URL configured.');
      }
      const token = getProviderSecret(row);
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        throw new Error(`External API endpoint returned HTTP ${res.status}.`);
      }
      nextStatus = 'connected';
      accountLabel = `HTTP ${res.status} verified`;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    if (nextStatus !== 'not_configured') {
      nextStatus = 'error';
    }
  }

  const latencyMs = Date.now() - startedAt;

  db.prepare(`
    UPDATE integrations
    SET connection_status = ?,
        config_json = ?,
        account_label = ?,
        last_tested_at = ?,
        last_latency_ms = ?,
        last_error = ?,
        updated_at = ?
    WHERE provider_key = ?
  `).run(nextStatus, JSON.stringify(config), accountLabel, testedAt, latencyMs, errorMessage, testedAt, providerKey);

  syncDivisionCapabilitiesAndStatus();

  logEvent({
    level: nextStatus === 'connected' ? 'success' : 'error',
    subsystem: 'NEXUS',
    action: 'integration.tested',
    message:
      nextStatus === 'connected'
        ? `Verified live execution & authentication for ${row.display_name} (${latencyMs}ms)${accountLabel ? ` · ${accountLabel}` : ''}.`
        : `Connection verification failed for ${row.display_name}: ${errorMessage}`,
    entityType: 'integration',
    entityId: row.id,
    actorId,
    actorName,
  });

  return toSanitizedIntegration(getIntegrationRow(providerKey)!);
}
