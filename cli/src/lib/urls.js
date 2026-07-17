'use strict';

// Public URL scheme served by the SPCS nginx service.
//   production:  {base}/{slug}/
//   preview:     {base}/{slug}/~/{deploymentId}/
//
// `base` is the SPCS ingress endpoint (or a local mock host). It is stored on
// the deployment/alias records so the dashboard and CLI can link to a running
// app without re-deriving it.
function serveBase() {
  return process.env.SNOWD_SERVE_BASE || 'http://localhost:8080';
}

function productionUrl(slug, base = serveBase()) {
  return `${base.replace(/\/$/, '')}/${slug}/`;
}

function previewUrl(slug, deploymentId, base = serveBase()) {
  return `${base.replace(/\/$/, '')}/${slug}/~/${deploymentId}/`;
}

module.exports = { serveBase, productionUrl, previewUrl };
