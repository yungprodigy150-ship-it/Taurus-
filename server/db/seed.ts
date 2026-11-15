import crypto from 'node:crypto';
import type { DivisionCode, IntegrationProviderKey, RoutingPolicy } from '../../shared/types.ts';
import { getDb } from './database.ts';

interface DivisionBlueprint {
  id: string;
  name: string;
  division: DivisionCode;
  description: string;
  responsibilities: string;
  capabilities: string[];
}

const FOUNDATIONAL_DIVISIONS: DivisionBlueprint[] = [
  {
    id: 'div-command',
    name: 'Command Core',
    division: 'COMMAND',
    description:
      'Central coordination division responsible for directive interpretation, multi-division planning, delegation, and synthesis.',
    responsibilities:
      'Interpret natural-language goals, assign work across specialized divisions, enforce approval gates, and compile final execution reports.',
    capabilities: ['directive_interpretation', 'execution_planning', 'division_delegation', 'report_synthesis'],
  },
  {
    id: 'div-forge',
    name: 'Forge Foundry',
    division: 'FORGE',
    description:
      'Business, software, website, and digital product creation division generating interactive deliverables and blueprints.',
    responsibilities:
      'Build interactive HTML/JS websites, application architectures, venture blueprints, and store deliverables in My Creations & Library.',
    capabilities: ['website_generation', 'application_architecture', 'venture_blueprinting', 'artifact_persistence'],
  },
  {
    id: 'div-vanguard',
    name: 'Vanguard Growth',
    division: 'VANGUARD',
    description:
      'Strategy, market positioning, go-to-market execution, and growth optimization division.',
    responsibilities:
      'Evaluate commercial opportunities, formulate acquisition strategies, and build actionable launch plans.',
    capabilities: ['market_positioning', 'gtm_strategy', 'competitive_differentiation'],
  },
  {
    id: 'div-sentry',
    name: 'Sentry Operations',
    division: 'SENTRY',
    description:
      'Monitoring, operational security, execution verification, and system health auditing division.',
    responsibilities:
      'Inspect execution runs, verify provider health, enforce access rules, and detect incomplete or failed operations.',
    capabilities: ['execution_audit', 'health_diagnostics', 'security_policy_review'],
  },
  {
    id: 'div-atlas',
    name: 'Atlas Intelligence',
    division: 'ATLAS',
    description:
      'Research, competitor analysis, market intelligence, and web inspection division.',
    responsibilities:
      'Conduct structured opportunity & competitor research, inspect live public URLs via the Browser Adapter, and archive briefs to Library.',
    capabilities: ['opportunity_research', 'competitor_analysis', 'web_page_inspection'],
  },
  {
    id: 'div-nexus',
    name: 'Nexus Integrations',
    division: 'NEXUS',
    description:
      'AI providers and external tool gateway managing GitHub repositories, email outbox, browser adapter, and model routing.',
    responsibilities:
      'Coordinate multi-provider AI execution, GitHub repository operations, gated email delivery, and browser adapter tasks.',
    capabilities: ['github_operations', 'email_dispatch', 'browser_navigation', 'provider_routing'],
  },
  {
    id: 'div-treasury',
    name: 'Treasury Ledger',
    division: 'TREASURY',
    description:
      'Financial modeling, unit economics, pricing structure, and cost projection division.',
    responsibilities:
      'Develop unit economics, pricing tiers, cost estimates, and revenue projections for ventures and initiatives.',
    capabilities: ['financial_modeling', 'pricing_analysis', 'unit_economics'],
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
    config: {
      defaultModel: 'gemini-4-hydrogen',
      fastModel: 'gemini-3.1-flash-lite',
      reasoningModel: 'gemini-4-hydrogen',
      codingModel: 'gemini-4-hydrogen',
      secretVariable: 'GEMINI_API_KEY',
    },
  },
  {
    id: 'int-groq',
    providerKey: 'groq',
    displayName: 'Groq',
    category: 'ai_provider',
    authType: 'encrypted_token',
    config: {
      baseUrl: 'https://api.groq.com/openai/v1',
      defaultModel: 'llama-3.3-70b-versatile',
      fastModel: 'llama-3.1-8b-instant',
      reasoningModel: 'llama-3.3-70b-versatile',
      codingModel: 'llama-3.3-70b-versatile',
    },
  },
  {
    id: 'int-openai',
    providerKey: 'openai',
    displayName: 'OpenAI',
    category: 'ai_provider',
    authType: 'encrypted_token',
    config: {
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-4o-mini',
      fastModel: 'gpt-4o-mini',
      reasoningModel: 'gpt-4o',
      codingModel: 'gpt-4o',
    },
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
    config: { provider: 'resend', apiUrl: 'https://api.resend.com', fromAddress: '' },
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

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  preferredProvider: 'auto',
  fallbackOrder: ['google_gemini', 'groq', 'openai'],
  preferCostEfficiency: true,
  tierModels: {
    fast: {
      google_gemini: 'gemini-3.1-flash-lite',
      groq: 'llama-3.1-8b-instant',
      openai: 'gpt-4o-mini',
    },
    reasoning: {
      google_gemini: 'gemini-4-hydrogen',
      groq: 'llama-3.3-70b-versatile',
      openai: 'gpt-4o',
    },
    coding: {
      google_gemini: 'gemini-4-hydrogen',
      groq: 'llama-3.3-70b-versatile',
      openai: 'gpt-4o',
    },
  },
};

export function syncDivisionCapabilitiesAndStatus(): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Check whether at least one AI provider is genuinely verified & connected
  const connectedAiCount = (
    db
      .prepare("SELECT COUNT(*) as count FROM integrations WHERE category = 'ai_provider' AND connection_status = 'connected'")
      .get() as { count: number }
  ).count;

  const hasVerifiedAi = connectedAiCount > 0;

  for (const div of FOUNDATIONAL_DIVISIONS) {
    const existing = db.prepare('SELECT id, status, runtime_mode FROM agents WHERE id = ?').get(div.id) as
      | { id: string; status: string; runtime_mode: string }
      | undefined;

    if (!existing) {
      db.prepare(`
        INSERT INTO agents (
          id, name, division, description, responsibilities,
          model_provider, model_name, status, runtime_mode,
          capabilities_json, config_json, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        div.id,
        div.name,
        div.division,
        div.description,
        div.responsibilities,
        hasVerifiedAi ? 'auto_routed' : 'unassigned',
        hasVerifiedAi ? 'intelligent_router' : 'none',
        hasVerifiedAi ? 'active' : 'standby',
        hasVerifiedAi ? 'ai_orchestrated' : 'architecture_only',
        JSON.stringify(div.capabilities),
        JSON.stringify({ phase2OrchestrationReady: true, autoRouted: true }),
        now,
        now
      );
    } else if (existing.status !== 'disabled') {
      // Update capabilities metadata & reflect real provider availability honestly
      db.prepare(`
        UPDATE agents
        SET capabilities_json = ?,
            runtime_mode = ?,
            status = ?,
            model_provider = CASE WHEN model_provider = 'unassigned' AND ? = 1 THEN 'auto_routed' ELSE model_provider END,
            model_name = CASE WHEN model_name = 'none' AND ? = 1 THEN 'intelligent_router' ELSE model_name END,
            updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(div.capabilities),
        hasVerifiedAi ? 'ai_orchestrated' : 'architecture_only',
        hasVerifiedAi ? 'active' : 'standby',
        hasVerifiedAi ? 1 : 0,
        hasVerifiedAi ? 1 : 0,
        now,
        div.id
      );
    }
  }
}

export function seedSystemFoundations(): void {
  const db = getDb();
  const now = new Date().toISOString();

  // Seed or sync core divisions without wiping custom agents
  syncDivisionCapabilitiesAndStatus();

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

  // Seed default workspace policy (update phaseLabel cleanly for Phase 2)
  const existingPolicy = db
    .prepare("SELECT value_json FROM system_settings WHERE key = 'workspace_policy'")
    .get() as { value_json: string } | undefined;

  if (!existingPolicy) {
    db.prepare(`
      INSERT INTO system_settings (key, value_json, updated_at)
      VALUES ('workspace_policy', ?, ?)
    `).run(
      JSON.stringify({
        requireApprovalForExternalActions: true,
        defaultIntakeMode: 'plan_and_execute',
        platformPhase: 'Phase 2: Multi-Agent Orchestration',
        executionEngineReady: true,
      }),
      now
    );
  } else {
    try {
      const parsed = JSON.parse(existingPolicy.value_json) as Record<string, unknown>;
      parsed.platformPhase = 'Phase 2: Multi-Agent Orchestration';
      parsed.executionEngineReady = true;
      db.prepare("UPDATE system_settings SET value_json = ?, updated_at = ? WHERE key = 'workspace_policy'").run(
        JSON.stringify(parsed),
        now
      );
    } catch {
      // Ignore malformed legacy policy
    }
  }

  // Seed default intelligent model routing policy if missing
  db.prepare(`
    INSERT OR IGNORE INTO system_settings (key, value_json, updated_at)
    VALUES ('routing_policy', ?, ?)
  `).run(JSON.stringify(DEFAULT_ROUTING_POLICY), now);

  // Clean expired sessions on boot
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
