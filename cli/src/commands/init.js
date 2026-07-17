'use strict';

const fs = require('fs');
const path = require('path');
const {
  loadProjectConfig,
  saveProjectConfig,
  DEFAULT_PROJECT,
} = require('../lib/config');
const { slugify } = require('../lib/ids');
const { log, c } = require('../lib/ui');

// Guess sensible build settings from the app's package.json.
function detectFramework(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const detected = { ...DEFAULT_PROJECT, name: pkg.name || path.basename(cwd) };

  if (deps.vite) {
    detected.framework = 'vite-react';
    detected.outputDirectory = 'dist';
  } else if (deps['react-scripts']) {
    detected.framework = 'create-react-app';
    detected.outputDirectory = 'build';
  } else if (deps.next) {
    detected.framework = 'next';
    detected.outputDirectory = 'out'; // static export
    detected.buildCommand = 'npm run build && npm run export || next build';
  }
  return detected;
}

async function init(opts) {
  const cwd = process.cwd();
  if (loadProjectConfig(cwd) && !opts.force) {
    log.warn('snowdeploy.json already exists. Use --force to overwrite.');
    return;
  }

  const config = detectFramework(cwd);
  if (opts.name) config.name = opts.name;
  config.name = config.name || path.basename(cwd);
  config.slug = slugify(config.name);

  const savedPath = saveProjectConfig(config, cwd);
  log.brand(`Linked ${c.bold(config.name)}`);
  log.ok(`Wrote ${path.relative(cwd, savedPath)}`);
  log.step(`framework   ${config.framework}`);
  log.step(`build       ${config.buildCommand}`);
  log.step(`output      ${config.outputDirectory}`);
  log.raw('');
  log.info(`Deploy a preview with ${c.cyan('snowd deploy')}`);
  log.info(`Ship to production with ${c.cyan('snowd deploy --prod')}`);
}

module.exports = init;
