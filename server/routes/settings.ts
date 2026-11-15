import fs from 'node:fs';
import { Router } from 'express';
import { DB_PATH, STORAGE_DIR } from '../config.ts';
import { getDb } from '../db/database.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { logEvent } from '../services/logger.ts';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/', (_req, res) => {
  const db = getDb();
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

  const logs = db.prepare('SELECT * FROM execution_logs ORDER BY created_at DESC LIMIT 60').all();

  res.json({
    policy,
    policyUpdatedAt: policyRow?.updated_at ?? null,
    infrastructure: {
      nodeVersion: process.version,
      databaseEngine: 'SQLite (node:sqlite WAL)',
      databaseSizeBytes: dbSizeBytes,
      storageDirectory: 'data/storage',
      storageFileCount,
      storageTotalBytes,
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
