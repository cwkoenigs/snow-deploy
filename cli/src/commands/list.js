'use strict';

const { getBackend } = require('../backend');
const { loadProjectConfig } = require('../lib/config');
const { log, c, table, humanBytes, ago } = require('../lib/ui');

const STATUS_COLOR = {
  READY: c.green,
  BUILDING: c.yellow,
  ERROR: c.red,
  CANCELED: c.gray,
};

function statusTag(s) {
  return (STATUS_COLOR[s] || ((x) => x))(s || '?');
}

// `snowd ls [project]` — projects when no arg, deployments when given one
// (or when run inside a linked directory).
async function list(projectArg, opts) {
  const backend = getBackend(opts);
  try {
    const linked = loadProjectConfig(process.cwd());
    const projectName = projectArg || (linked && linked.name);

    if (!projectName) {
      const projects = await backend.listProjects();
      if (projects.length === 0) {
        log.info('No projects yet. Run `snowd deploy` in a React app.');
        return;
      }
      log.brand('Projects');
      const rows = projects.map((p) => ({
        name: c.bold(p.name),
        framework: c.dim(p.framework),
        created: c.gray(ago(p.createdAt)),
      }));
      log.raw(table(rows, [['name', 'NAME'], ['framework', 'FRAMEWORK'], ['created', 'CREATED']]));
      return;
    }

    const [deployments, prod] = await Promise.all([
      backend.listDeployments(projectName, { limit: opts.limit || 20 }),
      backend.getAlias(projectName, 'production'),
    ]);
    if (deployments.length === 0) {
      log.info(`No deployments for ${projectName}.`);
      return;
    }
    log.brand(`Deployments · ${c.bold(projectName)}`);
    const rows = deployments.map((d) => ({
      id: c.cyan(d.id),
      status: statusTag(d.status),
      prod: prod && prod.deploymentId === d.id ? c.magenta('● prod') : '',
      size: c.dim(humanBytes(d.sizeBytes)),
      branch: c.dim((d.git && d.git.branch) || '–'),
      age: c.gray(ago(d.createdAt)),
    }));
    log.raw(
      table(rows, [
        ['id', 'DEPLOYMENT'],
        ['status', 'STATUS'],
        ['prod', ''],
        ['size', 'SIZE'],
        ['branch', 'BRANCH'],
        ['age', 'AGE'],
      ]),
    );
  } finally {
    await backend.close();
  }
}

module.exports = list;
