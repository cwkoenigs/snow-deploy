'use strict';

const { getBackend } = require('../backend');
const { log, c } = require('../lib/ui');

async function remove(projectName, opts) {
  const backend = getBackend(opts);
  try {
    const project = await backend.getProject(projectName);
    if (!project) {
      log.error(`No such project: ${projectName}`);
      process.exitCode = 1;
      return;
    }
    if (!opts.yes) {
      log.warn(`This removes project ${c.bold(projectName)}, all its deployments, and artifacts.`);
      log.info(`Re-run with ${c.cyan('--yes')} to confirm.`);
      return;
    }
    await backend.removeProject(projectName);
    log.ok(`Removed ${c.bold(projectName)}`);
  } finally {
    await backend.close();
  }
}

module.exports = remove;
