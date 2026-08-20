import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import phaseRoutes from './routes/phases.js';
import taskRoutes from './routes/tasks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ serveClient = true } = {}) {
  const app = express();

  // Vercel terminates TLS upstream; without this the secure cookie flag and req.protocol
  // are decided from the internal hop rather than the visitor's request.
  app.set('trust proxy', 1);

  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', (req, res) => res.json({ ok: true }));
  api.use('/auth', authRoutes);
  api.use('/users', userRoutes);
  api.use('/projects', projectRoutes);
  api.use('/phases', phaseRoutes);
  api.use('/tasks', taskRoutes);
  api.use((req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

  app.use('/api', api);

  // On Vercel this function only ever receives /api/* requests, but a rewrite may
  // present them with the prefix already stripped. Mounting at the root as well makes
  // the routes reachable either way; locally the prefixed mount is the only one used.
  if (process.env.VERCEL) app.use('/', api);

  if (serveClient) {
    const clientDist = path.join(__dirname, '..', 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
    }
  }

  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  return app;
}
