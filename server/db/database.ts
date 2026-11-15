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

function migrateSchema(db: DatabaseSync): void {
  db.exec(`
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
      runtime_mode TEXT NOT NULL CHECK(runtime_mode IN ('architecture_only', 'intake_assisted', 'autonomous_pending')) DEFAULT 'architecture_only',
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
      status TEXT NOT NULL CHECK(status IN ('queued', 'analyzing', 'planned', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'queued',
      progress_percent INTEGER NOT NULL DEFAULT 0,
      progress_stage TEXT NOT NULL DEFAULT 'Recorded in intake queue',
      execution_note TEXT NOT NULL DEFAULT '',
      plan_json TEXT NOT NULL DEFAULT '[]',
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
      target_market TEXT NOT NULL DEFAULT '',
      product_type TEXT NOT NULL DEFAULT '',
      revenue_model TEXT NOT NULL DEFAULT '',
      constraints TEXT NOT NULL DEFAULT '',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('draft', 'architected', 'ready_for_phase_2')) DEFAULT 'draft',
      blueprint_markdown TEXT NOT NULL DEFAULT '',
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
      content_type TEXT NOT NULL CHECK(content_type IN ('html', 'markdown', 'json', 'text', 'file')),
      content_body TEXT NOT NULL DEFAULT '',
      library_file_id TEXT REFERENCES library_files(id) ON DELETE SET NULL,
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
}
