#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const pkg = require('../package.json');

const program = new Command();

program
  .name('snowd')
  .description('Deploy React apps to Snowflake, Vercel-style.')
  .version(pkg.version, '-v, --version')
  .option('--mock', 'use the local filesystem backend instead of Snowflake');

// Commander calls actions as (positional..., optionsObject, commandObject).
// Our command modules expect (positional..., mergedOptions), so drop the
// command object and fold the global flags (e.g. --mock) into the options.
function withGlobal(fn) {
  return (...args) => {
    args.pop(); // command object
    const localOpts = args.pop() || {};
    const merged = { ...program.opts(), ...localOpts };
    return fn(...args, merged);
  };
}

program
  .command('login')
  .description('Save Snowflake connection credentials')
  .option('--account <account>', 'Snowflake account identifier')
  .option('--user <user>', 'Snowflake username')
  .option('--password <password>', 'password (prefer key-pair auth)')
  .option('--private-key <path>', 'path to an unencrypted .p8 private key')
  .option('--role <role>', 'role to use')
  .option('--warehouse <wh>', 'warehouse to use')
  .option('--database <db>', 'control-plane database')
  .option('--schema <schema>', 'control-plane schema')
  .action(withGlobal(require('../src/commands/login')));

program
  .command('init')
  .description('Create snowdeploy.json for the current app')
  .option('--name <name>', 'project name')
  .option('--force', 'overwrite existing config')
  .action(withGlobal(require('../src/commands/init')));

program
  .command('deploy')
  .description('Build and deploy the current app')
  .option('--prod', 'promote this deployment to production')
  .option('--prebuilt', 'skip the build; upload the existing output directory')
  .option('--skip-install', 'skip the install command before building')
  .action(withGlobal(require('../src/commands/deploy')));

program
  .command('ls [project]')
  .alias('list')
  .description('List projects, or deployments of a project')
  .option('--limit <n>', 'max deployments to show', (v) => parseInt(v, 10), 20)
  .action(withGlobal(require('../src/commands/list')));

program
  .command('inspect <deploymentId>')
  .description('Show details for a deployment')
  .option('--logs', 'include build logs')
  .action(withGlobal(require('../src/commands/inspect')));

program
  .command('promote <deploymentId>')
  .description('Point an alias (default: production) at a deployment')
  .option('--target <target>', 'alias target', 'production')
  .action(withGlobal(require('../src/commands/promote')));

program
  .command('rollback [project]')
  .description('Revert an alias to the previous deployment')
  .option('--target <target>', 'alias target', 'production')
  .action(withGlobal(require('../src/commands/rollback')));

program
  .command('rm <project>')
  .alias('remove')
  .description('Delete a project and its deployments')
  .option('--yes', 'skip confirmation')
  .action(withGlobal(require('../src/commands/remove')));

const access = program
  .command('access')
  .description('Manage who can view an app (per-app access control)');
access
  .command('grant <project> <username>')
  .description('Allow a Snowflake user to view an app ("*" = all authenticated users)')
  .action(withGlobal(require('../src/commands/access').grant));
access
  .command('revoke <project> <username>')
  .description('Remove a user from an app’s viewer list')
  .action(withGlobal(require('../src/commands/access').revoke));
access
  .command('ls [project]')
  .alias('list')
  .description('Show an app’s viewer list')
  .action(withGlobal(require('../src/commands/access').list));

program
  .command('open [project]')
  .description('Print/open a project production URL')
  .option('--target <target>', 'alias target', 'production')
  .action(withGlobal(require('../src/commands/misc').open));

program
  .command('whoami')
  .description('Show the active backend')
  .action(withGlobal(require('../src/commands/misc').whoami));

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.stack || err.message);
  process.exit(1);
});
