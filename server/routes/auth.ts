import { Router } from 'express';
import type { UserProfile, UserRole } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import {
  createSession,
  deleteSession,
  extractToken,
  requireAuth,
  requireRole,
  resolveUserFromRequest,
  type AuthenticatedRequest,
} from '../services/auth.ts';
import { hashPassword, verifyPassword } from '../services/crypto.ts';
import { logEvent } from '../services/logger.ts';

export const authRouter = Router();

authRouter.get('/status', (req, res) => {
  const db = getDb();
  const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const resolved = resolveUserFromRequest(req);
  res.json({
    initialized: countRow.count > 0,
    authenticated: Boolean(resolved),
    user: resolved?.user ?? null,
  });
});

authRouter.post('/setup', (req, res) => {
  const db = getDb();
  const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (countRow.count > 0) {
    res.status(409).json({ error: 'Platform already initialized. Please sign in with an existing operator account.' });
    return;
  }

  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    res.status(400).json({ error: 'Name, valid email, and a password of at least 8 characters are required.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const userId = newId('usr');
  const now = new Date().toISOString();
  const passwordHash = hashPassword(password);

  db.prepare(`
    INSERT INTO users (id, email, name, role, password_hash, created_at)
    VALUES (?, ?, ?, 'owner', ?, ?)
  `).run(userId, normalizedEmail, name.trim(), passwordHash, now);

  const session = createSession(userId);
  const user: UserProfile = {
    id: userId,
    email: normalizedEmail,
    name: name.trim(),
    role: 'owner',
    createdAt: now,
  };

  logEvent({
    level: 'success',
    subsystem: 'AUTH',
    action: 'platform.initialized',
    message: `Initialized TAURUS primary owner account (${normalizedEmail}).`,
    entityType: 'user',
    entityId: userId,
    actorId: userId,
    actorName: user.name,
  });

  res.cookie('taurus_session', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.status(201).json({ user, sessionToken: session.token, expiresAt: session.expiresAt });
});

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email?.trim() || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const db = getDb();
  const row = db
    .prepare('SELECT id, email, name, role, password_hash, created_at FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as
    | {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        password_hash: string;
        created_at: string;
      }
    | undefined;

  if (!row || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const session = createSession(row.id);
  const user: UserProfile = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.created_at,
  };

  logEvent({
    level: 'info',
    subsystem: 'AUTH',
    action: 'operator.login',
    message: `Operator ${user.name} (${user.role}) authenticated.`,
    entityType: 'user',
    entityId: user.id,
    actorId: user.id,
    actorName: user.name,
  });

  res.cookie('taurus_session', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.json({ user, sessionToken: session.token, expiresAt: session.expiresAt });
});

authRouter.post('/logout', (req, res) => {
  const token = extractToken(req);
  if (token) {
    deleteSession(token);
  }
  res.clearCookie('taurus_session', { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

authRouter.get('/users', requireAuth, requireRole(['owner']), (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, email, name, role, created_at as createdAt FROM users ORDER BY created_at ASC')
    .all();
  res.json({ users: rows });
});

authRouter.post('/users', requireAuth, requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const { name, email, password, role } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    role?: UserRole;
  };
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    res.status(400).json({ error: 'Name, email, and password (min 8 chars) are required.' });
    return;
  }
  const targetRole: UserRole = role === 'owner' || role === 'operator' || role === 'viewer' ? role : 'operator';
  const normalizedEmail = email.trim().toLowerCase();

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An operator with this email already exists.' });
    return;
  }

  const userId = newId('usr');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, email, name, role, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, normalizedEmail, name.trim(), targetRole, hashPassword(password), now);

  logEvent({
    level: 'info',
    subsystem: 'AUTH',
    action: 'operator.created',
    message: `Created ${targetRole} operator account for ${normalizedEmail}.`,
    entityType: 'user',
    entityId: userId,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.status(201).json({
    user: { id: userId, email: normalizedEmail, name: name.trim(), role: targetRole, createdAt: now },
  });
});

authRouter.patch('/users/:id/role', requireAuth, requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const { id } = req.params;
  const { role } = req.body as { role?: UserRole };
  if (role !== 'owner' && role !== 'operator' && role !== 'viewer') {
    res.status(400).json({ error: 'Role must be owner, operator, or viewer.' });
    return;
  }
  if (id === req.user!.id && role !== 'owner') {
    res.status(400).json({ error: 'You cannot demote your own active owner session.' });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Operator account not found.' });
    return;
  }

  logEvent({
    level: 'info',
    subsystem: 'AUTH',
    action: 'operator.role_updated',
    message: `Updated role for operator ${id} to ${role}.`,
    entityType: 'user',
    entityId: id,
    actorId: req.user!.id,
    actorName: req.user!.name,
  });

  res.json({ ok: true });
});
