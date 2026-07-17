'use strict';

const readline = require('readline');
const { saveCredentials, loadCredentials } = require('../lib/config');
const { log, c } = require('../lib/ui');

function ask(question, { silent = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (silent) {
      // Mask password input.
      const onData = () => {
        rl.output.write('[2K[200D' + question);
      };
      rl.input.on('data', onData);
      rl.question(question, (answer) => {
        rl.input.off('data', onData);
        rl.output.write('\n');
        rl.close();
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function login(opts) {
  log.brand('snow-deploy login');
  const existing = loadCredentials() || {};

  // Non-interactive path: everything provided via flags.
  const creds = {
    account: opts.account || existing.account,
    username: opts.user || existing.username,
    role: opts.role || existing.role || 'SNOW_DEPLOY_DEPLOYER',
    warehouse: opts.warehouse || existing.warehouse || 'SNOW_DEPLOY_WH',
    database: opts.database || existing.database || 'SNOW_DEPLOY',
    schema: opts.schema || existing.schema || 'CORE',
  };
  if (opts.privateKey) creds.privateKeyPath = opts.privateKey;
  if (opts.password) creds.password = opts.password;

  const interactive = process.stdin.isTTY && !opts.account;
  if (interactive) {
    creds.account = (await ask(`${c.dim('Account')} (e.g. ab12345.us-east-1): `)).trim() || creds.account;
    creds.username = (await ask(`${c.dim('User')}: `)).trim() || creds.username;
    const auth = (await ask(`${c.dim('Auth')} [password/keypair] (password): `)).trim() || 'password';
    if (auth.startsWith('key')) {
      creds.privateKeyPath = (await ask(`${c.dim('Private key path (.p8)')}: `)).trim();
    } else {
      creds.password = await ask(`${c.dim('Password')}: `, { silent: true });
    }
  }

  if (!creds.account || !creds.username) {
    log.error('Account and user are required (pass --account/--user or run interactively).');
    process.exit(1);
  }

  const savedPath = saveCredentials(creds);
  log.ok(`Saved credentials for ${c.bold(creds.username)} @ ${c.bold(creds.account)}`);
  log.step(`→ ${savedPath}`);
  log.step(`role=${creds.role} warehouse=${creds.warehouse} db=${creds.database}`);
}

module.exports = login;
