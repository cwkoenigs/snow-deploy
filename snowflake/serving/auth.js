'use strict';

/**
 * Authorization sidecar for the snow-deploy serving container.
 *
 * nginx sends an auth_request subrequest here for every app request, carrying:
 *   X-Slug — the project slug extracted from the URL
 *   X-User — the authenticated Snowflake username, taken from the
 *            Sf-Context-Current-User header that SPCS ingress injects after
 *            authenticating the visitor. Clients cannot spoof it through
 *            ingress; it is trustworthy inside the service.
 *
 * Policy comes from the compiled file the PUBLISH_ACCESS procedure writes into
 * the artifact stage (mounted at /artifacts):
 *   { "<slug>": ["ALICE", "BOB"], ... }
 *
 * Rules:
 *   - slug has no entry (or file absent) → allow any authenticated user
 *   - slug has entries → allow only listed usernames ('*' = everyone)
 *
 * Responses: 204 allow, 403 deny. Denials are logged for auditability.
 */

const fs = require('fs');
const http = require('http');

const PORT = Number(process.env.AUTH_PORT || 8081);
const ACCESS_FILE = process.env.ACCESS_FILE || '/artifacts/_meta/access.json';

// Cache the policy file, invalidated by mtime, so per-request cost is a stat().
let cache = { policies: null, mtimeMs: -1 };

function loadPolicies() {
  try {
    const st = fs.statSync(ACCESS_FILE);
    if (st.mtimeMs !== cache.mtimeMs) {
      cache = {
        policies: JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8')),
        mtimeMs: st.mtimeMs,
      };
    }
  } catch {
    cache = { policies: null, mtimeMs: -1 }; // no file yet → no restrictions
  }
  return cache.policies || {};
}

function decide(slug, user) {
  if (!slug) return { allow: false, reason: 'no slug' };
  const rules = loadPolicies()[slug];
  if (!rules || rules.length === 0) return { allow: true, reason: 'unrestricted' };
  const u = String(user || '').toUpperCase();
  if (!u) return { allow: false, reason: 'restricted app, anonymous request' };
  const allowed = rules.some((p) => p === '*' || String(p).toUpperCase() === u);
  return { allow: allowed, reason: allowed ? 'granted' : 'not in allow list' };
}

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/check') {
    res.writeHead(404).end();
    return;
  }
  const slug = req.headers['x-slug'];
  const user = req.headers['x-user'];
  const { allow, reason } = decide(slug, user);
  if (allow) {
    res.writeHead(204).end();
  } else {
    console.log(`deny slug=${slug || '-'} user=${user || '-'} (${reason})`);
    res.writeHead(403).end();
  }
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, '127.0.0.1', () => {
    console.log(`snow-deploy auth sidecar on 127.0.0.1:${PORT} (policy: ${ACCESS_FILE})`);
  });
}

module.exports = { decide, loadPolicies, handler }; // exported for tests
