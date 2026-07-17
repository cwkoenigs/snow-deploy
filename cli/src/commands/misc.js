'use strict';

const { spawn } = require('child_process');
const { getBackend } = require('../backend');
const { loadProjectConfig } = require('../lib/config');
const { log, c } = require('../lib/ui');

async function whoami(opts) {
  const backend = getBackend(opts);
  const info = backend.describe();
  if (backend.isFallback) {
    log.warn('Not logged in. Using local mock backend.');
  }
  log.brand('snow-deploy');
  log.step(`backend  ${info.kind}`);
  log.step(`target   ${info.target}`);
  await backend.close();
}

// Print (and optionally open) the production URL for a project.
async function open(projectArg, opts) {
  const backend = getBackend(opts);
  try {
    const linked = loadProjectConfig(process.cwd());
    const projectName = projectArg || (linked && linked.name);
    if (!projectName) {
      log.error('Specify a project: `snowd open <project>`');
      process.exitCode = 1;
      return;
    }
    const alias = await backend.getAlias(projectName, opts.target || 'production');
    if (!alias) {
      log.warn(`No ${opts.target || 'production'} deployment for ${projectName} yet.`);
      return;
    }
    log.raw(alias.url);
    if (opts.open !== false && process.platform !== 'linux') {
      const cmd = process.platform === 'darwin' ? 'open' : 'start';
      spawn(cmd, [alias.url], { stdio: 'ignore', detached: true }).unref();
    }
  } finally {
    await backend.close();
  }
}

module.exports = { whoami, open };
