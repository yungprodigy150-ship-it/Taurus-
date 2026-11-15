import { GoogleGenAI } from '@google/genai';
import type { ConnectionStatus, IntegrationProviderKey, IntegrationRecord } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { decryptSecret, encryptSecret } from './crypto.ts';
import { logEvent } from './logger.ts';

interface RawIntegrationRow {
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

export function isGeminiVerifiedConnected(): boolean {
  const db = getDb();
  const row = db
    .prepare('SELECT connection_status FROM integrations WHERE provider_key = ?')
    .get('google_gemini') as { connection_status: string } | undefined;
  return Boolean(process.env.GEMINI_API_KEY?.trim()) && row?.connection_status === 'connected';
}

export function toSanitizedIntegration(row: RawIntegrationRow): IntegrationRecord {
  let config: Record<string, string> = {};
  try {
    config = JSON.parse(row.config_json || '{}') as Record<string, string>;
  } catch {
    config = {};
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

  return {
    id: row.id,
    providerKey: row.provider_key,
    displayName: row.display_name,
    category: row.category,
    authType: row.auth_type,
    connectionStatus: row.connection_status,
    hasCredential,
    credentialSource,
    config,
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
  const existing = db
    .prepare('SELECT * FROM integrations WHERE provider_key = ?')
    .get(providerKey) as RawIntegrationRow | undefined;

  if (!existing) {
    throw new Error(`Unknown integration provider: ${providerKey}`);
  }

  let currentConfig: Record<string, string> = {};
  try {
    currentConfig = JSON.parse(existing.config_json || '{}') as Record<string, string>;
  } catch {
    currentConfig = {};
  }

  const mergedConfig = { ...currentConfig, ...configUpdates };
  const encrypted = credential && credential.trim() ? encryptSecret(credential.trim()) : existing.encrypted_credentials;
  const now = new Date().toISOString();

  // Saving new credentials resets connection status to configured_untested until actually tested!
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

  logEvent({
    level: 'info',
    subsystem: 'NEXUS',
    action: 'integration.configured',
    message: `Updated encrypted configuration for ${existing.display_name}. Connection requires live test verification.`,
    entityType: 'integration',
    entityId: existing.id,
    actorId,
    actorName,
  });

  const updated = db
    .prepare('SELECT * FROM integrations WHERE provider_key = ?')
    .get(providerKey) as unknown as RawIntegrationRow;
  return toSanitizedIntegration(updated);
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
  const existing = db
    .prepare('SELECT * FROM integrations WHERE provider_key = ?')
    .get(providerKey) as RawIntegrationRow | undefined;
  if (!existing) throw new Error(`Unknown integration provider: ${providerKey}`);

  let currentConfig: Record<string, string> = {};
  try {
    currentConfig = JSON.parse(existing.config_json || '{}') as Record<string, string>;
  } catch {
    currentConfig = {};
  }
  if ('endpointUrl' in currentConfig) currentConfig.endpointUrl = '';
  if ('healthUrl' in currentConfig) currentConfig.healthUrl = '';

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

  const updated = db
    .prepare('SELECT * FROM integrations WHERE provider_key = ?')
    .get(providerKey) as unknown as RawIntegrationRow;
  return toSanitizedIntegration(updated);
}

function getProviderSecret(row: RawIntegrationRow): string | null {
  if (row.encrypted_credentials) {
    return decryptSecret(row.encrypted_credentials);
  }
  if (row.provider_key === 'groq') return process.env.GROQ_API_KEY?.trim() || null;
  if (row.provider_key === 'openai') return process.env.OPENAI_API_KEY?.trim() || null;
  if (row.provider_key === 'github') return process.env.GITHUB_TOKEN?.trim() || null;
  if (row.provider_key === 'email_services') return process.env.RESEND_API_KEY?.trim() || null;
  return null;
}

export async function testIntegrationConnection(
  providerKey: IntegrationProviderKey,
  actorId: string,
  actorName: string
): Promise<IntegrationRecord> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM integrations WHERE provider_key = ?')
    .get(providerKey) as RawIntegrationRow | undefined;

  if (!row) {
    throw new Error(`Unknown integration provider: ${providerKey}`);
  }

  let config: Record<string, string> = {};
  try {
    config = JSON.parse(row.config_json || '{}') as Record<string, string>;
  } catch {
    config = {};
  }

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
      const response = await client.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: 'Respond with exactly: OK',
      });
      if (!response.text) {
        throw new Error('Gemini returned an empty response during verification.');
      }
      nextStatus = 'connected';
      accountLabel = 'Model verified: gemini-4-hydrogen';
    } else if (providerKey === 'groq') {
      const token = getProviderSecret(row);
      if (!token) {
        nextStatus = 'not_configured';
        throw new Error('No Groq API key configured in encrypted vault or environment.');
      }
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(`Groq authentication failed with HTTP ${res.status}.`);
      }
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      nextStatus = 'connected';
      accountLabel = `${data.data?.length ?? 0} Groq models accessible`;
    } else if (providerKey === 'openai') {
      const token = getProviderSecret(row);
      if (!token) {
        nextStatus = 'not_configured';
        throw new Error('No OpenAI API key configured in encrypted vault or environment.');
      }
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(`OpenAI authentication failed with HTTP ${res.status}.`);
      }
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      nextStatus = 'connected';
      accountLabel = `${data.data?.length ?? 0} OpenAI models accessible`;
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
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(`GitHub authentication failed with HTTP ${res.status}.`);
      }
      const user = (await res.json()) as { login?: string };
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
        signal: AbortSignal.timeout(8000),
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
        throw new Error('No remote Chromium CDP or WebDriver endpoint configured in this environment.');
      }
      const probeUrl = endpoint.endsWith('/json/version') ? endpoint : `${endpoint.replace(/\/$/, '')}/json/version`;
      const res = await fetch(probeUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        throw new Error(`Browser automation endpoint responded with HTTP ${res.status}.`);
      }
      const info = (await res.json()) as { Browser?: string };
      nextStatus = 'connected';
      accountLabel = info.Browser || 'Remote browser endpoint verified';
    } else if (providerKey === 'external_apis') {
      const healthUrl = config.healthUrl?.trim();
      if (!healthUrl) {
        nextStatus = 'not_configured';
        throw new Error('No external API health check URL configured.');
      }
      const token = getProviderSecret(row);
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(healthUrl, { headers, signal: AbortSignal.timeout(8000) });
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
        account_label = ?,
        last_tested_at = ?,
        last_latency_ms = ?,
        last_error = ?,
        updated_at = ?
    WHERE provider_key = ?
  `).run(nextStatus, accountLabel, testedAt, latencyMs, errorMessage, testedAt, providerKey);

  logEvent({
    level: nextStatus === 'connected' ? 'success' : 'error',
    subsystem: 'NEXUS',
    action: 'integration.tested',
    message:
      nextStatus === 'connected'
        ? `Verified live connection to ${row.display_name} (${latencyMs}ms)${accountLabel ? ` · ${accountLabel}` : ''}.`
        : `Connection verification failed for ${row.display_name}: ${errorMessage}`,
    entityType: 'integration',
    entityId: row.id,
    actorId,
    actorName,
  });

  const updated = db
    .prepare('SELECT * FROM integrations WHERE provider_key = ?')
    .get(providerKey) as unknown as RawIntegrationRow;
  return toSanitizedIntegration(updated);
}
