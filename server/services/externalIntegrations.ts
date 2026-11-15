import { getDb } from '../db/database.ts';
import { newId } from '../db/seed.ts';
import { getIntegrationRow, getProviderSecret, parseIntegrationConfig } from './aiProvider.ts';
import { logEvent } from './logger.ts';

export interface GithubRepoSummary {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  updatedAt: string;
}

export interface EmailOutboxRecord {
  id: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  status: 'awaiting_approval' | 'sent' | 'rejected' | 'failed';
  providerMessageId: string | null;
  errorMessage: string | null;
  projectId: string | null;
  runId: string | null;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

function requireVerifiedGithubToken(): string {
  const row = getIntegrationRow('github');
  if (!row || row.connection_status !== 'connected') {
    throw new Error('GitHub integration must be configured and verified in Integrations first.');
  }
  const token = getProviderSecret(row);
  if (!token) throw new Error('GitHub token unavailable.');
  return token;
}

export async function listGithubRepos(actorId: string, actorName: string): Promise<GithubRepoSummary[]> {
  const token = requireVerifiedGithubToken();
  const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=25', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Taurus-Operations-Platform',
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`GitHub API returned HTTP ${res.status} while listing repositories.`);
  }

  const repos = (await res.json()) as Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description: string | null;
    default_branch: string;
    updated_at: string;
  }>;

  logEvent({
    level: 'info',
    subsystem: 'NEXUS',
    action: 'github.repos_listed',
    message: `Retrieved ${repos.length} GitHub repositories via authenticated API.`,
    actorId,
    actorName,
  });

  return repos.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    htmlUrl: r.html_url,
    description: r.description,
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at,
  }));
}

export async function createGithubRepo(
  input: { name: string; description?: string; isPrivate?: boolean },
  actorId: string,
  actorName: string
): Promise<GithubRepoSummary> {
  const token = requireVerifiedGithubToken();
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Taurus-Operations-Platform',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name.trim(),
      description: input.description?.trim() || 'Created via TAURUS Operations Platform',
      private: input.isPrivate !== false,
      auto_init: true,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    let errText = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data.message) errText = `${errText}: ${data.message}`;
    } catch {}
    throw new Error(`Failed to create GitHub repository (${errText}).`);
  }

  const r = (await res.json()) as {
    id: number;
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    description: string | null;
    default_branch: string;
    updated_at: string;
  };

  logEvent({
    level: 'success',
    subsystem: 'NEXUS',
    action: 'github.repo_created',
    message: `Created GitHub repository ${r.full_name}.`,
    actorId,
    actorName,
  });

  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    private: r.private,
    htmlUrl: r.html_url,
    description: r.description,
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at,
  };
}

export async function commitFileToGithubRepo(
  input: { repoFullName: string; filePath: string; content: string; commitMessage: string },
  actorId: string,
  actorName: string
): Promise<{ htmlUrl: string; sha: string }> {
  const token = requireVerifiedGithubToken();
  const cleanPath = input.filePath.replace(/^\/+/, '');
  const apiUrl = `https://api.github.com/repos/${input.repoFullName}/contents/${cleanPath}`;

  // Check if file already exists to retrieve sha
  let existingSha: string | undefined;
  const checkRes = await fetch(apiUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Taurus-Operations-Platform',
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (checkRes.ok) {
    const existingData = (await checkRes.json()) as { sha?: string };
    existingSha = existingData.sha;
  }

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Taurus-Operations-Platform',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: input.commitMessage,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      ...(existingSha ? { sha: existingSha } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!putRes.ok) {
    let detail = `HTTP ${putRes.status}`;
    try {
      const errBody = (await putRes.json()) as { message?: string };
      if (errBody.message) detail = `${detail}: ${errBody.message}`;
    } catch {}
    throw new Error(`GitHub file commit failed (${detail}).`);
  }

  const out = (await putRes.json()) as { content?: { html_url?: string; sha?: string } };
  logEvent({
    level: 'success',
    subsystem: 'NEXUS',
    action: 'github.file_committed',
    message: `Committed "${cleanPath}" to GitHub repository ${input.repoFullName}.`,
    actorId,
    actorName,
  });

  return {
    htmlUrl: out.content?.html_url || `https://github.com/${input.repoFullName}/blob/main/${cleanPath}`,
    sha: out.content?.sha || '',
  };
}

export function queueEmailForApproval(
  input: {
    toEmail: string;
    subject: string;
    bodyText: string;
    projectId?: string | null;
    runId?: string | null;
  },
  actorId: string,
  actorName: string
): EmailOutboxRecord {
  const db = getDb();
  const id = newId('eml');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO email_outbox (
      id, to_email, subject, body_text, status, project_id, run_id, created_by, created_at
    ) VALUES (?, ?, ?, ?, 'awaiting_approval', ?, ?, ?, ?)
  `).run(
    id,
    input.toEmail.trim(),
    input.subject.trim(),
    input.bodyText.trim(),
    input.projectId || null,
    input.runId || null,
    actorId,
    now
  );

  logEvent({
    level: 'info',
    subsystem: 'NEXUS',
    action: 'email.queued_for_approval',
    message: `Queued outbound email to ${input.toEmail.trim()} ("${input.subject.trim()}") awaiting owner approval.`,
    entityType: 'email_outbox',
    entityId: id,
    actorId,
    actorName,
  });

  return getEmailById(id)!;
}

function mapEmailRow(r: Record<string, unknown>): EmailOutboxRecord {
  return {
    id: String(r.id),
    toEmail: String(r.to_email),
    subject: String(r.subject),
    bodyText: String(r.body_text),
    status: r.status as EmailOutboxRecord['status'],
    providerMessageId: r.provider_message_id ? String(r.provider_message_id) : null,
    errorMessage: r.error_message ? String(r.error_message) : null,
    projectId: r.project_id ? String(r.project_id) : null,
    runId: r.run_id ? String(r.run_id) : null,
    createdBy: String(r.created_by),
    approvedBy: r.approved_by ? String(r.approved_by) : null,
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    sentAt: r.sent_at ? String(r.sent_at) : null,
    createdAt: String(r.created_at),
  };
}

export function getEmailById(id: string): EmailOutboxRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM email_outbox WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapEmailRow(row) : null;
}

export function listOutboxEmails(userId: string, isOwner: boolean): EmailOutboxRecord[] {
  const db = getDb();
  const rows = (
    isOwner
      ? db.prepare('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 40').all()
      : db.prepare('SELECT * FROM email_outbox WHERE created_by = ? ORDER BY created_at DESC LIMIT 40').all(userId)
  ) as Array<Record<string, unknown>>;
  return rows.map(mapEmailRow);
}

export async function decideOutboxEmail(
  emailId: string,
  decision: 'approve_and_send' | 'reject',
  actorId: string,
  actorName: string
): Promise<EmailOutboxRecord> {
  const db = getDb();
  const existing = getEmailById(emailId);
  if (!existing) throw new Error('Email outbox item not found.');
  if (existing.status !== 'awaiting_approval') {
    throw new Error(`Email is already in status "${existing.status}".`);
  }

  const now = new Date().toISOString();

  if (decision === 'reject') {
    db.prepare(`
      UPDATE email_outbox SET status = 'rejected', approved_by = ?, approved_at = ? WHERE id = ?
    `).run(actorId, now, emailId);

    logEvent({
      level: 'warn',
      subsystem: 'NEXUS',
      action: 'email.rejected',
      message: `Rejected outbound email to ${existing.toEmail} ("${existing.subject}").`,
      entityType: 'email_outbox',
      entityId: emailId,
      actorId,
      actorName,
    });

    return getEmailById(emailId)!;
  }

  const emailRow = getIntegrationRow('email_services');
  if (!emailRow || emailRow.connection_status !== 'connected') {
    throw new Error('Email Services integration must be verified and connected before sending.');
  }
  const token = getProviderSecret(emailRow);
  if (!token) throw new Error('Email service API key unavailable.');
  const config = parseIntegrationConfig(emailRow);
  const fromAddress = config.fromAddress?.trim() || 'Taurus Operations <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [existing.toEmail],
      subject: existing.subject,
      text: existing.bodyText,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody.message) detail = `${detail}: ${errBody.message}`;
    } catch {}
    db.prepare(`
      UPDATE email_outbox
      SET status = 'failed', approved_by = ?, approved_at = ?, error_message = ?
      WHERE id = ?
    `).run(actorId, now, detail, emailId);

    logEvent({
      level: 'error',
      subsystem: 'NEXUS',
      action: 'email.send_failed',
      message: `Failed sending approved email to ${existing.toEmail}: ${detail}`,
      entityType: 'email_outbox',
      entityId: emailId,
      actorId,
      actorName,
    });
    return getEmailById(emailId)!;
  }

  const sentData = (await res.json()) as { id?: string };
  db.prepare(`
    UPDATE email_outbox
    SET status = 'sent', approved_by = ?, approved_at = ?, sent_at = ?, provider_message_id = ?, error_message = NULL
    WHERE id = ?
  `).run(actorId, now, now, sentData.id || null, emailId);

  logEvent({
    level: 'success',
    subsystem: 'NEXUS',
    action: 'email.sent',
    message: `Sent approved email to ${existing.toEmail} (ID: ${sentData.id || 'confirmed'}).`,
    entityType: 'email_outbox',
    entityId: emailId,
    actorId,
    actorName,
  });

  return getEmailById(emailId)!;
}
