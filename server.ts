import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { PORT } from './server/config.ts';
import { getDb } from './server/db/database.ts';
import { seedSystemFoundations } from './server/db/seed.ts';
import { agentsRouter } from './server/routes/agents.ts';
import { authRouter } from './server/routes/auth.ts';
import { commandsRouter } from './server/routes/commands.ts';
import { creationsRouter } from './server/routes/creations.ts';
import { foundryRouter } from './server/routes/foundry.ts';
import { integrationsRouter } from './server/routes/integrations.ts';
import { libraryRouter } from './server/routes/library.ts';
import { overviewRouter } from './server/routes/overview.ts';
import { projectsRouter } from './server/routes/projects.ts';
import { settingsRouter } from './server/routes/settings.ts';

async function startServer() {
  // Initialize SQLite database and foundational Phase 1 registries
  getDb();
  seedSystemFoundations();

  const app = express();
  app.disable('x-powered-by');

  // Parse JSON payloads for all non-binary API endpoints
  app.use((req, res, next) => {
    if (req.path === '/api/library/upload') {
      next();
      return;
    }
    express.json({ limit: '5mb' })(req, res, next);
  });

  // Public health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'taurus-platform', timestamp: new Date().toISOString() });
  });

  // Modular API routes
  app.use('/api/auth', authRouter);
  app.use('/api/overview', overviewRouter);
  app.use('/api/commands', commandsRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/foundry', foundryRouter);
  app.use('/api/creations', creationsRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/settings', settingsRouter);

  // Unknown /api/* handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Express error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[TAURUS Server Error]:', message);
    res.status(500).json({ error: message });
  });

  // Mount Vite dev middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TAURUS Operations Platform listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
