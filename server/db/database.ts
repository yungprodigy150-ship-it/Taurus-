import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, ensureDataDirectories } from '../config.ts';

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;

  ensureDataDirectories();
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  migrateSchema(db);
  dbInstance = db;
  return db;
}

function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function migrateSchema(db: DatabaseSync): void {
  // Base Phase 1 tables (created if fresh DB)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'operator', 'viewer')),
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'General',
      status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed', 'archived')) DEFAULT 'active',
      owner_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      division TEXT NOT NULL CHECK(division IN ('COMMAND', 'FORGE', 'VANGUARD', 'SENTRY', 'ATLAS', 'NEXUS', 'TREASURY')),
      description TEXT NOT NULL DEFAULT '',
      responsibilities TEXT NOT NULL DEFAULT '',
      model_provider TEXT NOT NULL DEFAULT 'unassigned',
      model_name TEXT NOT NULL DEFAULT 'none',
      status TEXT NOT NULL CHECK(status IN ('standby', 'configured', 'active', 'disabled')) DEFAULT 'standby',
      runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('architecture_only', 'intake_assisted', 'ai_orchestrated', 'autonomous_pending')) DEFAULT 'architecture_only',
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      config_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      assigned_division TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'analyzing', 'planned', 'clarification_needed', 'awaiting_approval', 'running', 'partial', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      progress_stage TEXT NOT NULL DEFAULT 'Recorded in intake queue',
      execution_note TEXT NOT NULL DEFAULT '',
      plan_json TEXT NOT NULL DEFAULT '[]',
      clarification_json TEXT NOT NULL DEFAULT '[]',
      latest_run_id TEXT,
      error_message TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      command_id TEXT REFERENCES commands(id) ON DELETE CASCADE,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      division TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'awaiting_approval', 'in_progress', 'completed', 'rejected', 'failed')) DEFAULT 'pending',
      priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
      requires_approval INTEGER NOT NULL DEFAULT 0,
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      result_notes TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_files (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      storage_name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK(category IN ('source_code', 'documents', 'images', 'videos', 'business_assets', 'research', 'project_files', 'generated_materials')),
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ventures (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_idea TEXT NOT NULL DEFAULT '',
      target_market TEXT NOT NULL DEFAULT '',
      product_type TEXT NOT NULL DEFAULT '',
      revenue_model TEXT NOT NULL DEFAULT '',
      constraints TEXT NOT NULL DEFAULT '',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'idea_generated',
      blueprint_markdown TEXT NOT NULL DEFAULT '',
      structured_spec_json TEXT,
      approved_by TEXT REFERENCES users(id),
      approved_at TEXT,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS creations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('website', 'application', 'business', 'document', 'design', 'media', 'other')),
      description TEXT NOT NULL DEFAULT '',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      command_id TEXT REFERENCES commands(id) ON DELETE SET NULL,
      execution_run_id TEXT,
      content_type TEXT NOT NULL CHECK(content_type IN ('html', 'markdown', 'json', 'text', 'file')),
      content_body TEXT NOT NULL DEFAULT '',
      library_file_id TEXT REFERENCES library_files(id) ON DELETE SET NULL,
      deployed_url TEXT,
      is_interactive INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('draft', 'ready', 'archived')) DEFAULT 'ready',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      provider_key TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      category TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      connection_status TEXT NOT NULL CHECK(connection_status IN ('not_configured', 'configured_untested', 'connected', 'error')) DEFAULT 'not_configured',
      encrypted_credentials TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      account_label TEXT,
      last_tested_at TEXT,
      last_latency_ms INTEGER,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS execution_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL CHECK(level IN ('info', 'success', 'warn', 'error')),
      subsystem TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      actor_id TEXT,
      actor_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Safe Phase 2 additive migration for existing Phase 1 databases
  const applied = db
    .prepare("SELECT version FROM schema_migrations WHERE version = 'v2_phase2_orchestration'")
    .get() as { version: string } | undefined;

  if (!applied) {
    // Ensure new columns exist on existing Phase 1 tables
    ensureColumn(db, 'commands', 'clarification_json', "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn(db, 'commands', 'latest_run_id', 'TEXT');
    ensureColumn(db, 'ventures', 'source_idea', "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, 'ventures', 'structured_spec_json', 'TEXT');
    ensureColumn(db, 'ventures', 'approved_by', 'TEXT');
    ensureColumn(db, 'ventures', 'approved_at', 'TEXT');
    ensureColumn(db, 'creations', 'execution_run_id', 'TEXT');
    ensureColumn(db, 'creations', 'deployed_url', 'TEXT');
    ensureColumn(db, 'creations', 'is_interactive', 'INTEGER NOT NULL DEFAULT 0');

    // Safely widen CHECK constraints on existing Phase 1 tables (agents, commands, ventures) without losing any rows
    const agentsSqlRow = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agents'")
      .get() as { sql: string } | undefined;

    if (agentsSqlRow && !agentsSqlRow.sql.includes('ai_orchestrated')) {
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE agents_v2 (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          division TEXT NOT NULL CHECK(division IN ('COMMAND', 'FORGE', 'VANGUARD', 'SENTRY', 'ATLAS', 'NEXUS', 'TREASURY')),
          description TEXT NOT NULL DEFAULT '',
          responsibilities TEXT NOT NULL DEFAULT '',
          model_provider TEXT NOT NULL DEFAULT 'unassigned',
          model_name TEXT NOT NULL DEFAULT 'none',
          status TEXT NOT NULL CHECK(status IN ('standby', 'configured', 'active', 'disabled')) DEFAULT 'standby',
          runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('architecture_only', 'intake_assisted', 'ai_orchestrated', 'autonomous_pending')) DEFAULT 'architecture_only',
          capabilities_json TEXT NOT NULL DEFAULT '[]',
          config_json TEXT NOT NULL DEFAULT '{}',
          created_by TEXT REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO agents_v2 SELECT id, name, division, description, responsibilities, model_provider, model_name, status, runtime_mode, capabilities_json, config_json, created_by, created_at, updated_at FROM agents;
        DROP TABLE agents;
        ALTER TABLE agents_v2 RENAME TO agents;
        COMMIT;
      `);
      db.exec('PRAGMA foreign_keys = ON;');
    }

    const commandsSqlRow = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commands'")
      .get() as { sql: string } | undefined;

    if (commandsSqlRow && !commandsSqlRow.sql.includes('clarification_needed')) {
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE commands_v2 (
          id TEXT PRIMARY KEY,
          prompt TEXT NOT NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          assigned_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
          assigned_division TEXT,
          status TEXT NOT NULL CHECK(status IN ('queued', 'analyzing', 'planned', 'clarification_needed', 'awaiting_approval', 'running', 'partial', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
          progress_percent INTEGER NOT NULL DEFAULT 0,
          progress_stage TEXT NOT NULL DEFAULT 'Recorded in intake queue',
          execution_note TEXT NOT NULL DEFAULT '',
          plan_json TEXT NOT NULL DEFAULT '[]',
          clarification_json TEXT NOT NULL DEFAULT '[]',
          latest_run_id TEXT,
          error_message TEXT,
          created_by TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO commands_v2 (id, prompt, project_id, assigned_agent_id, assigned_division, status, progress_percent, progress_stage, execution_note, plan_json, clarification_json, latest_run_id, error_message, created_by, created_at, updated_at)
        SELECT id, prompt, project_id, assigned_agent_id, assigned_division, status, progress_percent, progress_stage, execution_note, plan_json, COALESCE(clarification_json, '[]'), latest_run_id, error_message, created_by, created_at, updated_at FROM commands;
        DROP TABLE commands;
        ALTER TABLE commands_v2 RENAME TO commands;
        COMMIT;
      `);
      db.exec('PRAGMA foreign_keys = ON;');
    }

    const venturesSqlRow = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ventures'")
      .get() as { sql: string } | undefined;

    if (venturesSqlRow && venturesSqlRow.sql.includes("CHECK(status IN ('draft'")) {
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE ventures_v2 (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          source_idea TEXT NOT NULL DEFAULT '',
          target_market TEXT NOT NULL DEFAULT '',
          product_type TEXT NOT NULL DEFAULT '',
          revenue_model TEXT NOT NULL DEFAULT '',
          constraints TEXT NOT NULL DEFAULT '',
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'idea_generated',
          blueprint_markdown TEXT NOT NULL DEFAULT '',
          structured_spec_json TEXT,
          approved_by TEXT REFERENCES users(id),
          approved_at TEXT,
          created_by TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO ventures_v2 (id, name, source_idea, target_market, product_type, revenue_model, constraints, project_id, status, blueprint_markdown, structured_spec_json, approved_by, approved_at, created_by, created_at, updated_at)
        SELECT id, name, COALESCE(source_idea, ''), target_market, product_type, revenue_model, constraints, project_id, status, blueprint_markdown, structured_spec_json, approved_by, approved_at, created_by, created_at, updated_at FROM ventures;
        DROP TABLE ventures;
        ALTER TABLE ventures_v2 RENAME TO ventures;
        COMMIT;
      `);
      db.exec('PRAGMA foreign_keys = ON;');
    }

    // Create Phase 2 execution monitoring, AI audit, and email outbox tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS execution_runs (
        id TEXT PRIMARY KEY,
        command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        original_instruction TEXT NOT NULL,
        interpreted_objective TEXT NOT NULL DEFAULT '',
        assigned_divisions_json TEXT NOT NULL DEFAULT '[]',
        current_stage TEXT NOT NULL DEFAULT 'Initializing',
        status TEXT NOT NULL CHECK(status IN ('planning', 'clarification_needed', 'awaiting_approval', 'running', 'completed', 'partial', 'failed', 'cancelled')) DEFAULT 'planning',
        final_report TEXT,
        remaining_work TEXT,
        error_message TEXT,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_by TEXT NOT NULL REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS execution_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES execution_runs(id) ON DELETE CASCADE,
        step_index INTEGER NOT NULL,
        division TEXT NOT NULL,
        agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        task_category TEXT NOT NULL DEFAULT 'general',
        complexity TEXT NOT NULL DEFAULT 'medium',
        provider_key TEXT,
        model_name TEXT,
        routing_reason TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'awaiting_approval', 'waiting_ai', 'running', 'completed', 'failed', 'skipped')) DEFAULT 'pending',
        requires_approval INTEGER NOT NULL DEFAULT 0,
        approved_by TEXT REFERENCES users(id),
        approved_at TEXT,
        input_summary TEXT NOT NULL DEFAULT '',
        output_summary TEXT NOT NULL DEFAULT '',
        output_creation_id TEXT,
        output_file_id TEXT,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS ai_executions (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        step_id TEXT,
        division TEXT NOT NULL,
        task_category TEXT NOT NULL,
        complexity TEXT NOT NULL,
        provider_key TEXT NOT NULL,
        model_name TEXT NOT NULL,
        routing_reason TEXT NOT NULL,
        fallback_used INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('success', 'error')),
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_outbox (
        id TEXT PRIMARY KEY,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_text TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('awaiting_approval', 'sent', 'rejected', 'failed')) DEFAULT 'awaiting_approval',
        provider_message_id TEXT,
        error_message TEXT,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        run_id TEXT,
        created_by TEXT NOT NULL REFERENCES users(id),
        approved_by TEXT REFERENCES users(id),
        approved_at TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL
      );
    `);

    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      'v2_phase2_orchestration',
      new Date().toISOString()
    );
  }
}
