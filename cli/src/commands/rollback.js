'use strict';

const { getBackend } = require('../backend');
const { loadProjectConfig } = require('../lib/config');
const { log, c } = require('../lib/ui');

// Revert an alias to the deployment that was live before the current one.
async function rollback(projectArg, opts) {
  const backend = getBackend(opts);
  const target = opts.target || 'production';
  try {
    const linked = loadProjectConfig(process.cwd());
    const projectName = projectArg || (linked && linked.name);
    if (!projectName) {
      log.error('Specify a project: `snowd rollback <project>`');
      process.exitCode = 1;
      return;
    }
    const alias = await backend.rollback(projectName, target);
    log.brand(`Rolled back ${c.bold(projectName)} ${c.magenta(target)}`);
    log.ok(`Now serving ${c.cyan(alias.deploymentId)}`);
    log.raw(`  ${c.dim('URL')} ${alias.url}`);
  } catch (err) {
    log.error(err.message);
    process.exitCode = 1;
  } finally {
    await backend.close();
  }
}

module.exports = rollback;
