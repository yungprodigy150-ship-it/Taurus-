import { Router } from 'express';
import type { IntegrationProviderKey } from '../../shared/types.ts';
import {
  clearIntegrationCredentials,
  listIntegrations,
  saveIntegrationCredentials,
  testIntegrationConnection,
} from '../services/aiProvider.ts';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../services/auth.ts';

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
