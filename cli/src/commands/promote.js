'use strict';

const { getBackend } = require('../backend');
const { log, c } = require('../lib/ui');

// Point an alias (default: production) at an existing READY deployment.
async function promote(deploymentId, opts) {
  const backend = getBackend(opts);
  const target = opts.target || 'production';
  try {
    const dep = await backend.getDeployment(deploymentId);
    if (!dep) {
      log.error(`No such deployment: ${deploymentId}`);
      process.exitCode = 1;
      return;
    }
    const alias = await backend.promote(deploymentId, target);
    log.brand(`Promoted ${c.cyan(deploymentId)} → ${c.magenta(target)}`);
    log.ok(`${c.bold(dep.projectName)} ${target} now serves this deployment`);
    log.raw(`  ${c.dim('URL')} ${alias.url}`);
  } catch (err) {
    log.error(err.message);
    process.exitCode = 1;
  } finally {
    await backend.close();
  }
}

module.exports = promote;
