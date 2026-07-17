'use strict';

const { spawnSync } = require('child_process');

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) return null;
  return res.stdout.trim();
}

// Best-effort git metadata for a deployment. Returns nulls outside a repo.
function gitMeta(cwd = process.cwd()) {
  const inside = git(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside !== 'true') return { sha: null, branch: null, message: null, dirty: null };
  return {
    sha: git(['rev-parse', 'HEAD'], cwd),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    message: git(['log', '-1', '--pretty=%s'], cwd),
    dirty: git(['status', '--porcelain'], cwd) ? true : false,
  };
}

module.exports = { gitMeta };
