import { Router } from 'express';
import type { IntegrationProviderKey, RoutingPolicy } from '../../shared/types.ts';
import { getDb } from '../db/database.ts';
import {
  clearIntegrationCredentials,
  listIntegrations,
  saveIntegrationCredentials,
  testIntegrationConnection,
} from '../services/aiProvider.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';
import { inspectWebPage } from '../services/browserAdapter.ts';
import {
  commitFileToGithubRepo,
  createGithubRepo,
  decideOutboxEmail,
  listGithubRepos,
  listOutboxEmails,
  queueEmailForApproval,
} from '../services/externalIntegrations.ts';
import { getRoutingPolicy, listRecentAiExecutions, saveRoutingPolicy } from '../services/modelRouter.ts';

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

integrationsRouter.get('/', (_req, res) => {
  res.json({ integrations: listIntegrations() });
});

integrationsRouter.post('/:providerKey/configure', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const providerKey = req.params.providerKey as IntegrationProviderKey;
  const { credential, config } = req.body as {
    credential?: string | null;
    config?: Record<string, string>;
  };

  try {
    const updated = saveIntegrationCredentials(
      providerKey,
      credential ?? null,
      config ?? {},
      req.user!.id,
      req.user!.name
    );
    res.json({ integration: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.delete('/:providerKey/credentials', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const providerKey = req.params.providerKey as IntegrationProviderKey;
  try {
    const updated = clearIntegrationCredentials(providerKey, req.user!.id, req.user!.name);
    res.json({ integration: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.post('/:providerKey/test', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const providerKey = req.params.providerKey as IntegrationProviderKey;
  try {
    const updated = await testIntegrationConnection(providerKey, req.user!.id, req.user!.name);
    res.json({ integration: updated });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Model Routing Policy & AI Audit Endpoints
integrationsRouter.get('/routing', (_req, res) => {
  res.json({ policy: getRoutingPolicy(), recentExecutions: listRecentAiExecutions(30) });
});

integrationsRouter.put('/routing', requireRole(['owner']), (req: AuthenticatedRequest, res) => {
  const updates = req.body as Partial<RoutingPolicy>;
  const policy = saveRoutingPolicy(updates, req.user!.id, req.user!.name);
  res.json({ policy });
});

// GitHub Operational Endpoints
integrationsRouter.get('/github/repos', async (req: AuthenticatedRequest, res) => {
  try {
    const repos = await listGithubRepos(req.user!.id, req.user!.name);
    res.json({ repos });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.post('/github/repos', requireRole(['owner']), async (req: AuthenticatedRequest, res) => {
  const { name, description, isPrivate } = req.body as {
    name?: string;
    description?: string;
    isPrivate?: boolean;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Repository name is required.' });
    return;
  }
  try {
    const repo = await createGithubRepo({ name, description, isPrivate }, req.user!.id, req.user!.name);
    res.status(201).json({ repo });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

integrationsRouter.post('/github/commit', requireRole(['owner']), async (req: AuthenticatedRequest, res) => {
  const { repoFullName, filePath, content, commitMessage, creationId } = req.body as {
    repoFullName?: string;
    filePath?: string;
    content?: string;
    commitMessage?: string;
    creationId?: string;
  };

  if (!repoFullName?.trim() || !filePath?.trim() || content === undefined) {
    res.status(400).json({ error: 'Repository full name, file path, and content are required.' });
    return;
  }

  try {
    const result = await commitFileToGithubRepo(
      {
        repoFullName: repoFullName.trim(),
        filePath: filePath.trim(),
        content,
        commitMessage: commitMessage?.trim() || `Publish ${filePath.trim()} from TAURUS`,
      },
      req.user!.id,
      req.user!.name
    );

    if (creationId) {
      const db = getDb();
      db.prepare('UPDATE creations SET deployed_url = ?, updated_at = ? WHERE id = ?').run(
        result.htmlUrl,
        new Date().toISOString(),
        creationId
      );
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Approval-Gated Email Outbox Endpoints
integrationsRouter.get('/email/outbox', (req: AuthenticatedRequest, res) => {
  const emails = listOutboxEmails(req.user!.id, req.user!.role === 'owner');
  res.json({ emails });
});

integrationsRouter.post('/email/queue', requireRole(['owner', 'operator']), (req: AuthenticatedRequest, res) => {
  const { toEmail, subject, bodyText, projectId } = req.body as {
    toEmail?: string;
    subject?: string;
    bodyText?: string;
    projectId?: string | null;
  };
  if (!toEmail?.trim() || !subject?.trim() || !bodyText?.trim()) {
    res.status(400).json({ error: 'Recipient email, subject, and message body are required.' });
    return;
  }
  const email = queueEmailForApproval(
    { toEmail, subject, bodyText, projectId },
    req.user!.id,
    req.user!.name
  );
  res.status(201).json({ email });
});

integrationsRouter.post('/email/:id/decision', requireRole(['owner']), async (req: AuthenticatedRequest, res) => {
  const { decision } = req.body as { decision?: 'approve_and_send' | 'reject' };
  if (decision !== 'approve_and_send' && decision !== 'reject') {
    res.status(400).json({ error: 'Decision must be approve_and_send or reject.' });
    return;
  }
  try {
    const email = await decideOutboxEmail(req.params.id, decision, req.user!.id, req.user!.name);
    res.json({ email });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Browser / URL Inspection Endpoint
integrationsRouter.post('/browser/inspect', requireRole(['owner', 'operator']), async (req: AuthenticatedRequest, res) => {
  const { url } = req.body as { url?: string };
  if (!url?.trim()) {
    res.status(400).json({ error: 'Target URL is required.' });
    return;
  }
  try {
    const inspection = await inspectWebPage(url.trim(), req.user!.id, req.user!.name);
    res.json({ inspection });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
