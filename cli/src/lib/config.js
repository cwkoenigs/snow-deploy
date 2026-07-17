'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ---- Global credentials (~/.snowdeploy/credentials.json) --------------------
// Stores how to connect to Snowflake. Never commit this file.
const HOME_DIR = path.join(os.homedir(), '.snowdeploy');
const CRED_PATH = path.join(HOME_DIR, 'credentials.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
}

function loadCredentials() {
  // Environment variables take precedence so CI can inject them.
  const env = process.env;
  const fromEnv = {};
  if (env.SNOWFLAKE_ACCOUNT) fromEnv.account = env.SNOWFLAKE_ACCOUNT;
  if (env.SNOWFLAKE_USER) fromEnv.username = env.SNOWFLAKE_USER;
  if (env.SNOWFLAKE_PASSWORD) fromEnv.password = env.SNOWFLAKE_PASSWORD;
  if (env.SNOWFLAKE_PRIVATE_KEY_PATH) fromEnv.privateKeyPath = env.SNOWFLAKE_PRIVATE_KEY_PATH;
  if (env.SNOWFLAKE_ROLE) fromEnv.role = env.SNOWFLAKE_ROLE;
  if (env.SNOWFLAKE_WAREHOUSE) fromEnv.warehouse = env.SNOWFLAKE_WAREHOUSE;
  const fromFile = readJson(CRED_PATH) || {};
  const merged = { ...fromFile, ...fromEnv };
  return Object.keys(merged).length ? merged : null;
}

function saveCredentials(creds) {
  writeJson(CRED_PATH, creds);
  return CRED_PATH;
}

// ---- Per-project config (snowdeploy.json next to the app) -------------------
const PROJECT_FILE = 'snowdeploy.json';

function projectConfigPath(cwd = process.cwd()) {
  return path.join(cwd, PROJECT_FILE);
}

function loadProjectConfig(cwd = process.cwd()) {
  return readJson(projectConfigPath(cwd));
}

function saveProjectConfig(config, cwd = process.cwd()) {
  writeJson(projectConfigPath(cwd), config);
  return projectConfigPath(cwd);
}

// Defaults describing a typical Vite/CRA React project.
const DEFAULT_PROJECT = {
  name: '',
  framework: 'react',
  buildCommand: 'npm run build',
  outputDirectory: 'dist',
  installCommand: 'npm install',
  nodeVersion: '20',
};

module.exports = {
  HOME_DIR,
  CRED_PATH,
  PROJECT_FILE,
  loadCredentials,
  saveCredentials,
  loadProjectConfig,
  saveProjectConfig,
  projectConfigPath,
  DEFAULT_PROJECT,
};
