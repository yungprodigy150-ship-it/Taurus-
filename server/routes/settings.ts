import fs from 'node:fs';
import { Router } from 'express';
import { DB_PATH, STORAGE_DIR } from '../config.ts';
import { getDb } from '../db/database.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';
import { getRoutingPolicy, listRecentAiExecutions } from '../services/modelRouter.ts';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const isOwner = req.user!.role === 'owner';

  const policyRow = db.prepare('SELECT value_json, updated_at FROM system_settings WHERE key = ?').get('workspace_policy') as
    | { value_json: string; updated_at: string }
    | undefined;

  let policy: Record<string, unknown> = {};
  try {
    policy = JSON.parse(policyRow?.value_json || '{}') as Record<string, unknown>;
  } catch {
    policy = {};
  }

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = fs.statSync(DB_PATH).size;
  } catch {
    dbSizeBytes = 0;
  }

  let storageFileCount = 0;
  let storageTotalBytes = 0;
  try {
    const entries = fs.readdirSync(STORAGE_DIR);
    storageFileCount = entries.length;
    for (const file of entries) {
      const st = fs.statSync(`${STORAGE_DIR}/${file}`);
      if (st.isFile()) storageTotalBytes += st.size;
    }
  } catch {
    storageFileCount = 0;
  }

  const logs = isOwner
    ? db.prepare('SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 60').all()
    : db
        .prepare('SELECT * FROM execution_logs WHERE actor_id = ? OR actor_id IS NULL ORDER BY created_at DESC LIMIT 60')
        .all(req.user!.id);

  res.json({
    policy,
    policyUpdatedAt: policyRow?.updated_at ?? null,
    routingPolicy: getRoutingPolicy(),
    aiExecutions: listRecentAiExecutions(25),
    infrastructure: {
      nodeVersion: process.version,
      databaseEngine: 'SQLite (node:sqlite WAL)',
      databaseSizeBytes: dbSizeBytes,
      storageDirectory: 'data/storage',
      storageFileCount,
      storageTotalBytes,
      storageDurability: 'local_container_disk',
      durabilityNotice:
        'Local SQLite and container filesystem are active. In ephemeral Cloud Run deployments without a persistent volume or external database, container redeploys reset local disk. Use Export Backup to archive workspace state.',
      encryptionAlgorithm: 'AES-256-GCM',
    },
    logs,
  });
});

settingsRouter.patch('/policy', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const { requireApprovalForExternalActions, defaultIntakeMode } = req.body as {
    requireApprovalForExternalActions?: boolean;
    defaultIntakeMode?: string;
  };

  const db = getDb();
  const existingRow = db.prepare('SELECT value_json FROM system_settings WHERE key = ?').get('workspace_policy') as
    | { value_json: string }
    | undefined;

  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(existingRow?.value_json || '{}') as Record<string, unknown>;
  } catch {
    current = {};
  }

  const updated = {
    ...current,
    ...(typeof requireApprovalForExternalActions === 'boolean' ? { requireApprovalForExternalActions } : {}),
    ...(defaultIntakeMode ? { defaultIntakeMode } : {}),
  };

  const now = new Date().toISOString();
  db.prepare('UPDATE system_settings SET value_json = ?, updated_at = ? WHERE key = ?').run(
    JSON.stringify(updated),
    now,
    'workspace_policy'
  );

  logEvent({
    level: 'info',
    subsystem: 'SENTRY',
    action: 'policy.updated',
    message: 'Updated workspace operational governance policy.',
    entityType: 'system_settings',
    entityId: 'workspace_policy',
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.json({ policy: updated, updatedAt: now });
});

// Owner-only workspace JSON backup export (strictly excludes password hashes, session tokens, and encrypted secrets)
settingsRouter.get('/backup', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const snapshot = {
    exportedAt: new Date().toISOString(),
    exportedBy: req.user!.email,
    platform: 'TAURUS Phase 2',
    projects: db.prepare('SELECT * FROM projects').all(),
    agents: db.prepare('SELECT * FROM agents').all(),
    commands: db.prepare('SELECT * FROM commands').all(),
    tasks: db.prepare('SELECT * FROM tasks').all(),
    ventures: db.prepare('SELECT * FROM ventures').all(),
    creations: db.prepare('SELECT * FROM creations').all(),
    libraryFilesMetadata: db.prepare('SELECT id, original_name, category, mime_type, size_bytes, sha256, project_id, description, uploaded_by, created_at FROM library_files').all(),
    executionRuns: db.prepare('SELECT * FROM execution_runs').all(),
    executionSteps: db.prepare('SELECT * FROM execution_steps').all(),
    aiExecutions: db.prepare('SELECT * FROM ai_executions').all(),
  };

  logEvent({
    level: 'info',
    subsystem: 'SENTRY',
    action: 'workspace.backup_exported',
    message: `Exported sanitized workspace JSON backup.`,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="taurus-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(snapshot, null, 2));
});
