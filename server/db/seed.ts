import crypto from 'node:crypto';
import type { DivisionCode, IntegrationProviderKey } from '../../shared/types.ts';
import { getDb } from './database.ts';

interface DivisionBlueprint {
  id: string;
  name: string;
  division: DivisionCode;
  description: string;
  responsibilities: string;
}

const FOUNDATIONAL_DIVISIONS: DivisionBlueprint[] = [
  {
    id: 'div-command',
    name: 'Command Core',
    division: 'COMMAND',
    description: 'Central coordination division responsible for instruction intake, cross-division routing, and human approval gates.',
    responsibilities: 'Parse operator directives, break initiatives into structured task queues, enforce approval policies, and coordinate division handoffs.',
  },
  {
    id: 'div-forge',
    name: 'Forge Foundry',
    division: 'FORGE',
    description: 'Business and product creation division designed for venture structuring, software blueprints, and digital product packaging.',
    responsibilities: 'Structure new ventures, generate technical and commercial specifications, and register deliverables in My Creations.',
  },
  {
    id: 'div-vanguard',
    name: 'Vanguard Growth',
    division: 'VANGUARD',
    description: 'Strategy and market growth division focused on positioning, distribution channels, and launch planning.',
    responsibilities: 'Evaluate target markets, formulate go-to-market plans, and define acquisition metrics and channel workflows.',
  },
  {
    id: 'div-sentry',
    name: 'Sentry Operations',
    division: 'SENTRY',
    description: 'Monitoring, reliability, and security oversight division for audit trails, permissions, and runtime checks.',
    responsibilities: 'Track operational logs, enforce role-based access rules, monitor provider health, and flag failed operations.',
  },
  {
    id: 'div-atlas',
    name: 'Atlas Intelligence',
    division: 'ATLAS',
    description: 'Research and market intelligence division prepared for structured synthesis and external research workflows.',
    responsibilities: 'Organize research briefs, store market documents in the Library, and prepare competitor or domain intelligence.',
  },
  {
    id: 'div-nexus',
    name: 'Nexus Integrations',
    division: 'NEXUS',
    description: 'AI provider and external service gateway managing verified model providers, GitHub, email, and API adapters.',
    responsibilities: 'Maintain encrypted provider credentials, verify live authentication states, and route AI model requests server-side.',
  },
  {
    id: 'div-treasury',
    name: 'Treasury Ledger',
    division: 'TREASURY',
    description: 'Financial operations architecture for pricing models, unit economics, and future payment/billing integrations.',
    responsibilities: 'Define revenue models and cost constraints during venture creation; live payment execution reserved for Phase 2+.',
  },
];

interface IntegrationSeed {
  id: string;
  providerKey: IntegrationProviderKey;
  displayName: string;
  category: 'ai_provider' | 'developer' | 'messaging' | 'automation' | 'api';
  authType: 'env_secret' | 'encrypted_token' | 'endpoint_config';
  config: Record<string, string>;
}

const BASE_INTEGRATIONS: IntegrationSeed[] = [
  {
    id: 'int-gemini',
    providerKey: 'google_gemini',
    displayName: 'Google Gemini',
    category: 'ai_provider',
    authType: 'env_secret',
    config: { defaultModel: 'gemini-4-hydrogen', secretVariable: 'GEMINI_API_KEY' },
  },
  {
    id: 'int-groq',
    providerKey: 'groq',
    displayName: 'Groq',
    category: 'ai_provider',
    authType: 'encrypted_token',
    config: { baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.3-70b-versatile' },
  },
  {
    id: 'int-openai',
    providerKey: 'openai',
    displayName: 'OpenAI',
    category: 'ai_provider',
    authType: 'encrypted_token',
    config: { baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  },
  {
    id: 'int-github',
    providerKey: 'github',
    displayName: 'GitHub',
    category: 'developer',
    authType: 'encrypted_token',
    config: { apiUrl: 'https://api.github.com' },
  },
  {
    id: 'int-email',
    providerKey: 'email_services',
    displayName: 'Email Services',
    category: 'messaging',
    authType: 'encrypted_token',
    config: { provider: 'resend', apiUrl: 'https://api.resend.com' },
  },
  {
    id: 'int-browser',
    providerKey: 'browser_automation',
    displayName: 'Browser Automation',
    category: 'automation',
    authType: 'endpoint_config',
    config: { endpointUrl: '' },
  },
  {
    id: 'int-external',
    providerKey: 'external_apis',
    displayName: 'External APIs',
    category: 'api',
    authType: 'endpoint_config',
    config: { healthUrl: '' },
  },
];

export function seedSystemFoundations(): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Seed architectural division scaffolds ONLY if agents table is empty.
  // Status is strictly 'standby' and runtime_mode is 'architecture_only' so Phase 1 never fakes autonomous execution.
  const agentCountRow = db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
  if (agentCountRow.count === 0) {
    const insertAgent = db.prepare(`
      INSERT INTO agents (
        id, name, division, description, responsibilities,
        model_provider, model_name, status, runtime_mode,
        capabilities_json, config_json, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `);

    for (const div of FOUNDATIONAL_DIVISIONS) {
      insertAgent.run(
        div.id,
        div.name,
        div.division,
        div.description,
        div.responsibilities,
        'unassigned',
        'none',
        'standby',
        'architecture_only',
        JSON.stringify([]),
        JSON.stringify({ autonomousExecutionReady: false, phaseTarget: 'Phase 2' }),
        now,
        now
      );
    }
  }

  // Seed integration registry records if missing. Never mark connected until tested!
  const insertIntegration = db.prepare(`
    INSERT OR IGNORE INTO integrations (
      id, provider_key, display_name, category, auth_type,
      connection_status, encrypted_credentials, config_json,
      account_label, last_tested_at, last_latency_ms, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, ?)
  `);

  for (const item of BASE_INTEGRATIONS) {
    let initialStatus: 'not_configured' | 'configured_untested' = 'not_configured';
    if (item.providerKey === 'google_gemini' && process.env.GEMINI_API_KEY) {
      initialStatus = 'configured_untested';
    }
    insertIntegration.run(
      item.id,
      item.providerKey,
      item.displayName,
      item.category,
      item.authType,
      initialStatus,
      JSON.stringify(item.config),
      now
    );
  }

  // Ensure Gemini env status reflects current env presence if still not tested
  const geminiRow = db
    .prepare('SELECT connection_status FROM integrations WHERE provider_key = ?')
    .get('google_gemini') as { connection_status: string } | undefined;

  if (geminiRow && geminiRow.connection_status === 'not_configured' && process.env.GEMINI_API_KEY) {
    db.prepare('UPDATE integrations SET connection_status = ?, updated_at = ? WHERE provider_key = ?').run(
      'configured_untested',
      now,
      'google_gemini'
    );
  }

  // Seed default system settings
  db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
  `).run(
    'workspace_policy',
    JSON.stringify({
      requireApprovalForExternalActions: true,
      defaultIntakeMode: 'ai_assisted_when_connected',
      platformPhase: 'Phase 1: System Foundation',
      executionEngineReady: false,
    }),
    now
  );

  // Clean expired sessions on boot
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
