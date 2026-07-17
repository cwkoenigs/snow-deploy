'use strict';

const { getBackend } = require('../backend');
const { log, c, humanBytes, ago } = require('../lib/ui');

async function inspect(deploymentId, opts) {
  const backend = getBackend(opts);
  try {
    const d = await backend.getDeployment(deploymentId);
    if (!d) {
      log.error(`No such deployment: ${deploymentId}`);
      process.exitCode = 1;
      return;
    }
    log.brand(`Deployment ${c.cyan(d.id)}`);
    const row = (k, v) => log.raw(`  ${c.dim(k.padEnd(12))} ${v}`);
    row('project', d.projectName);
    row('status', d.status);
    row('url', d.url);
    row('size', `${humanBytes(d.sizeBytes)} · ${d.fileCount ?? '?'} files`);
    row('fingerprint', d.fingerprint || '–');
    if (d.git) {
      row('branch', d.git.branch || '–');
      row('commit', d.git.sha ? `${d.git.sha.slice(0, 7)} ${d.git.message || ''}` : '–');
    }
    row('created', `${ago(d.createdAt)} by ${d.createdBy || '?'}`);
    if (opts.logs && d.buildLogs) {
      log.raw('');
      log.info('Build logs:');
      log.raw(d.buildLogs);
    }
  } finally {
    await backend.close();
  }
}

module.exports = inspect;
