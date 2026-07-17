'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Run a shell command, streaming output, and capture it for the build log.
function runCommand(command, cwd) {
  const chunks = [];
  const child = spawnSync(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (child.stdout) chunks.push(child.stdout.toString());
  if (child.stderr) chunks.push(child.stderr.toString());
  const output = chunks.join('');
  process.stdout.write(output);
  return { code: child.status ?? 1, output };
}

// Build the app: install (optional) then build. Returns { logs }.
function buildProject(projectConfig, cwd, { skipInstall = false } = {}) {
  const logs = [];
  const record = (label, res) => {
    logs.push(`$ ${label}\n${res.output}`);
    if (res.code !== 0) {
      const err = new Error(`Command failed (${res.code}): ${label}`);
      err.logs = logs.join('\n');
      throw err;
    }
  };

  if (!skipInstall && projectConfig.installCommand) {
    record(projectConfig.installCommand, runCommand(projectConfig.installCommand, cwd));
  }
  if (projectConfig.buildCommand) {
    record(projectConfig.buildCommand, runCommand(projectConfig.buildCommand, cwd));
  }
  return { logs: logs.join('\n') };
}

// Recursively list every file under dir, returning
// [{ absPath, relPath, size, hash }] plus rolled-up totals.
function collectArtifacts(dir) {
  if (!fs.existsSync(dir)) {
    const err = new Error(`Output directory not found: ${dir}`);
    err.code = 'NO_OUTPUT';
    throw err;
  }
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        const buf = fs.readFileSync(abs);
        files.push({
          absPath: abs,
          relPath: path.relative(dir, abs).split(path.sep).join('/'),
          size: buf.length,
          hash: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12),
        });
      }
    }
  };
  walk(dir);
  const sizeBytes = files.reduce((sum, f) => sum + f.size, 0);
  // A content hash for the whole deployment (dedupe / immutability check).
  const fingerprint = crypto
    .createHash('sha1')
    .update(files.map((f) => `${f.relPath}:${f.hash}`).sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
  return { files, sizeBytes, fileCount: files.length, fingerprint };
}

module.exports = { buildProject, collectArtifacts, runCommand };
