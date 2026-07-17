'use strict';

// Public entry point for the shared control-plane logic, reused by the
// control-plane API server so the CLI and dashboard talk to the exact same
// backend contract.
module.exports = {
  getBackend: require('./backend').getBackend,
  config: require('./lib/config'),
  urls: require('./lib/urls'),
};
