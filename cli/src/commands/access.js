'use strict';

const { getBackend } = require('../backend');
const { loadProjectConfig } = require('../lib/config');
const { log, c, table, ago } = require('../lib/ui');

function resolveProject(projectArg) {
  const linked = loadProjectConfig(process.cwd());
  return projectArg || (linked && linked.name);
}

// snowd access grant <project> <user>
async function grant(projectArg, principal, opts) {
  const backend = getBackend(opts);
  try {
    const project = resolveProject(projectArg);
    const result = await backend.grantAccess(project, principal, process.env.USER || 'cli');
    if (result.error) throw new Error(result.error);
    log.brand(`Access granted`);
    log.ok(`${c.bold(principal.toUpperCase())} can now view ${c.bold(project)}`);
    log.step(`viewers: ${result.principals.join(', ')}`);
  } catch (err) {
    log.error(err.message);
    process.exitCode = 1;
  } finally {
    await backend.close();
  }
}

// snowd access revoke <project> <user>
async function revoke(projectArg, principal, opts) {
  const backend = getBackend(opts);
  try {
    const project = resolveProject(projectArg);
    const result = await backend.revokeAccess(project, principal);
    if (result.error) throw new Error(result.error);
    log.brand(`Access revoked`);
    log.ok(`${c.bold(principal.toUpperCase())} removed from ${c.bold(project)}`);
    if (result.principals.length === 0) {
      log.warn('No rules remain — the app is now open to ALL authenticated Snowflake users.');
    } else {
      log.step(`viewers: ${result.principals.join(', ')}`);
    }
  } catch (err) {
    log.error(err.message);
    process.exitCode = 1;
  } finally {
    await backend.close();
  }
}

// snowd access ls [project]
async function list(projectArg, opts) {
  const backend = getBackend(opts);
  try {
    const project = resolveProject(projectArg);
    if (!project) {
      log.error('Specify a project: `snowd access ls <project>`');
      process.exitCode = 1;
      return;
    }
    const entries = await backend.listAccess(project);
    log.brand(`Access · ${c.bold(project)}`);
    if (entries.length === 0) {
      log.info('No rules — any authenticated Snowflake user can view this app.');
      log.step(`Restrict it with: snowd access grant ${project} <username>`);
      return;
    }
    const rows = entries.map((e) => ({
      principal: c.bold(e.principal),
      grantedBy: c.dim(e.grantedBy || '–'),
      when: c.gray(ago(e.grantedAt)),
    }));
    log.raw(table(rows, [['principal', 'USER'], ['grantedBy', 'GRANTED BY'], ['when', 'WHEN']]));
  } finally {
    await backend.close();
  }
}

module.exports = { grant, revoke, list };
