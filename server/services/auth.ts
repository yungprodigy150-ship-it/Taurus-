import type { NextFunction, Request, Response } from 'express';
import type { UserProfile, UserRole } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { generateSessionToken, hashSessionToken } from './crypto.ts';

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  sessionTokenHash?: string;
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function createSession(userId: string): { token: string; expiresAt: string } {
  const db = getDb();
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, userId, expiresAt, now.toISOString());

  return { token, expiresAt };
}

export function deleteSession(token: string): void {
  const db = getDb();
  const tokenHash = hashSessionToken(token);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.taurus_session) return cookies.taurus_session;
  return null;
}

export function resolveUserFromRequest(req: Request): { user: UserProfile; tokenHash: string } | null {
  const token = extractToken(req);
  if (!token) return null;

  const db = getDb();
  const tokenHash = hashSessionToken(token);
  const now = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT u.id, u.email, u.name, u.role, u.created_at, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `)
    .get(tokenHash) as
    | {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        created_at: string;
        expires_at: string;
      }
    | undefined;

  if (!row) return null;

  if (row.expires_at < now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  return {
    tokenHash,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
    },
  };
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const resolved = resolveUserFromRequest(req);
  if (!resolved) {
    res.status(401).json({ error: 'Authentication required. Please sign in to access TAURUS.' });
    return;
  }
  req.user = resolved.user;
  req.sessionTokenHash = resolved.tokenHash;
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}. Current role: ${req.user.role}.`,
      });
      return;
    }
    next();
  };
}
