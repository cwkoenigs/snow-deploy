'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { getBackend } = require('@snow-deploy/cli');

const PORT = process.env.PORT || 8787;
const DASHBOARD_DIST = path.resolve(__dirname, '../../dashboard/dist');

const app = express();
app.use(express.json());

// One backend for the process. `SNOWD_MOCK=1` uses the local filesystem store;
// otherwise it connects to Snowflake with the same credentials the CLI uses.
const backend = getBackend({});

// Wrap async handlers so rejected promises become 500s instead of hangs.
const h = (fn) => (req, res) => fn(req, res).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: err.message });
});

const api = express.Router();

api.get('/health', h(async (_req, res) => {
  res.json({ ok: true, backend: backend.describe() });
}));

api.get('/projects', h(async (_req, res) => {
  res.json(await backend.listProjects());
}));

api.get('/projects/:name', h(async (req, res) => {
  const project = await backend.getProject(req.params.name);
  if (!project) return res.status(404).json({ error: 'not found' });
  const [deployments, production, preview] = await Promise.all([
    backend.listDeployments(req.params.name, { limit: 50 }),
    backend.getAlias(req.params.name, 'production'),
    backend.getAlias(req.params.name, 'preview'),
  ]);
  res.json({ project, deployments, aliases: { production, preview } });
}));

api.get('/deployments/:id', h(async (req, res) => {
  const dep = await backend.getDeployment(req.params.id);
  if (!dep) return res.status(404).json({ error: 'not found' });
  res.json(dep);
}));

api.post('/deployments/:id/promote', h(async (req, res) => {
  const target = (req.body && req.body.target) || 'production';
  res.json(await backend.promote(req.params.id, target));
}));

api.post('/projects/:name/rollback', h(async (req, res) => {
  const target = (req.body && req.body.target) || 'production';
  res.json(await backend.rollback(req.params.name, target));
}));

api.delete('/projects/:name', h(async (req, res) => {
  res.json(await backend.removeProject(req.params.name));
}));

app.use('/api', api);

// Serve the built dashboard (if present) as a SPA.
if (fs.existsSync(DASHBOARD_DIST)) {
  app.use(express.static(DASHBOARD_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(DASHBOARD_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res
      .type('text')
      .send('snow-deploy control plane. Build the dashboard with `npm run dashboard:build`.'),
  );
}

app.listen(PORT, () => {
  const info = backend.describe();
  // eslint-disable-next-line no-console
  console.log(`▲ snow-deploy control plane on http://localhost:${PORT} (backend: ${info.kind})`);
});
