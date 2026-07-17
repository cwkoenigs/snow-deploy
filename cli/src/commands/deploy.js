'use strict';

const path = require('path');
const { getBackend } = require('../backend');
const { loadProjectConfig } = require('../lib/config');
const { buildProject, collectArtifacts } = require('../lib/build');
const { gitMeta } = require('../lib/git');
const { log, c, humanBytes, fail } = require('../lib/ui');

async function deploy(opts) {
  const cwd = process.cwd();
  const config = loadProjectConfig(cwd);
  if (!config) fail('No snowdeploy.json found. Run `snowd init` first.');

  const backend = getBackend(opts);
  const target = opts.prod ? 'production' : 'preview';
  log.brand(`Deploying ${c.bold(config.name)} ${c.dim(`→ ${target}`)}`);
  if (backend.isFallback) {
    log.warn('No Snowflake credentials found — using local mock backend. Run `snowd login` to connect.');
  }
  const info = backend.describe();
  log.step(`backend ${info.kind} (${info.target})`);

  const started = Date.now();
  try {
    // 1. Ensure the project exists in the control plane.
    const project = await backend.createProject({
      name: config.name,
      framework: config.framework,
      config,
      createdBy: process.env.USER || 'cli',
    });

    // 2. Build (unless artifacts were built already).
    let outDir = path.resolve(cwd, config.outputDirectory);
    let buildLogs = '';
    if (opts.prebuilt) {
      log.step(`using prebuilt output in ${config.outputDirectory}/`);
    } else {
      log.info('Building…');
      const res = buildProject(config, cwd, { skipInstall: opts.skipInstall });
      buildLogs = res.logs;
    }

    // 3. Collect artifacts.
    const { files, sizeBytes, fileCount, fingerprint } = collectArtifacts(outDir);
    if (fileCount === 0) fail(`No files found in ${config.outputDirectory}/ — did the build succeed?`);
    log.step(`collected ${fileCount} files (${humanBytes(sizeBytes)})`);

    // 4. Register the deployment (status BUILDING).
    const deployment = await backend.createDeployment({
      projectName: project.name,
      meta: { git: gitMeta(cwd), fingerprint },
      createdBy: process.env.USER || 'cli',
    });
    log.step(`deployment ${c.cyan(deployment.id)}`);

    // 5. Upload artifacts to the stage.
    log.info('Uploading…');
    const up = await backend.uploadArtifacts(deployment, files);
    log.step(`uploaded ${up.uploaded} files`);

    // 6. Mark READY.
    const ready = await backend.finalizeDeployment(deployment.id, {
      status: 'READY',
      fileCount,
      sizeBytes,
      fingerprint,
      buildLogs: buildLogs.slice(-16000), // keep the tail
    });

    // 7. Promote if requested.
    let alias = null;
    if (opts.prod) {
      log.info('Promoting to production…');
      alias = await backend.promote(deployment.id, 'production');
    }

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log.raw('');
    log.ok(`${c.green('Deployed')} in ${secs}s`);
    log.raw(`  ${c.dim('Preview')}    ${ready.url}`);
    if (alias) {
      log.raw(`  ${c.dim('Production')} ${alias.url}`);
    } else {
      log.raw(`  ${c.dim('Promote')}    snowd promote ${deployment.id}`);
    }
  } catch (err) {
    log.error(err.message);
    if (err.logs) log.step('See build logs above.');
    process.exitCode = 1;
  } finally {
    await backend.close();
  }
}

module.exports = deploy;
