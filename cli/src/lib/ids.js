'use strict';

const crypto = require('crypto');

// Short, URL-safe, sortable-ish ids in the spirit of Vercel's dpl_ / prj_.
function id(prefix) {
  const rand = crypto.randomBytes(9).toString('base64url');
  return `${prefix}_${rand}`;
}

const deploymentId = () => id('dpl');
const projectId = () => id('prj');

// A normalized project slug used in stage paths and URLs.
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

module.exports = { deploymentId, projectId, slugify };
