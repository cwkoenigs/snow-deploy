'use strict';

const { loadCredentials } = require('../lib/config');
const MockBackend = require('./mock');
const SnowflakeBackend = require('./snowflake');

/**
 * Resolve which backend to use.
 *
 * A backend is the single seam between the CLI/server and where deployment
 * state + artifacts live. `mock` keeps everything on the local filesystem so
 * the whole workflow can be exercised without a Snowflake account; the real
 * one talks to Snowflake via stored procedures and stage PUTs.
 *
 * @param {object} opts
 * @param {boolean} [opts.mock] force the mock backend
 * @returns {import('./mock')|import('./snowflake')}
 */
function getBackend(opts = {}) {
  const forceMock = opts.mock || process.env.SNOWD_MOCK === '1';
  if (forceMock) return new MockBackend();

  const creds = loadCredentials();
  if (!creds) {
    // No credentials configured — fall back to mock but let callers know.
    const backend = new MockBackend();
    backend.isFallback = true;
    return backend;
  }
  return new SnowflakeBackend(creds);
}

module.exports = { getBackend };
