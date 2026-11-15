import type { LogLevel } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';

function sanitizeLogMessage(msg: string): string {
  // Never allow API keys or Bearer tokens to persist in execution logs
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/(sk|gsk|ghp|re|AIza)[A-Za-z0-9_\-]{10,}/g, '[REDACTED_CREDENTIAL]');
}

export interface LogEntryInput {
  level: LogLevel;
  subsystem: string;
  action: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
}

export function logEvent(entry: LogEntryInput): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO execution_logs (
        id, level, subsystem, action, message,
        entity_type, entity_id, actor_id, actor_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      newId('log'),
      entry.level,
      entry.subsystem,
      entry.action,
      sanitizeLogMessage(entry.message),
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.actorId ?? null,
      entry.actorName ?? null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Failed to write execution log:', err instanceof Error ? err.message : String(err));
  }
}
