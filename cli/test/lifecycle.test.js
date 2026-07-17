'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Isolate the mock store in a temp dir for the whole suite.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'snowd-test-'));
process.env.SNOWD_MOCK = '1';
process.env.SNOWD_MOCK_DIR = TMP;

const { getBackend } = require('../src/index');

function fakeFiles() {
  // Two files with the stage-relative layout the real uploader produces.
  const dir = fs.mkdtempSync(path.join(TMP, 'build-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const index = path.join(dir, 'index.html');
  const asset = path.join(dir, 'assets', 'app.js');
  fs.writeFileSync(index, '<html>hi</html>');
  fs.writeFileSync(asset, 'console.log(1)');
  return [
    { absPath: index, relPath: 'index.html', size: 14 },
    { absPath: asset, relPath: 'assets/app.js', size: 14 },
  ];
}

test('deploy → promote → rollback lifecycle', async () => {
  const backend = getBackend({ mock: true });

  const project = await backend.createProject({ name: 'acme-web', framework: 'vite-react' });
  assert.equal(project.name, 'acme-web');
  assert.equal(project.slug, 'acme-web');

  // First deployment, promoted to production.
  const d1 = await backend.createDeployment({ projectName: 'acme-web', meta: {} });
  assert.equal(d1.status, 'BUILDING');
  await backend.uploadArtifacts(d1, fakeFiles());
  await backend.finalizeDeployment(d1.id, { status: 'READY', fileCount: 2, sizeBytes: 28 });
  const a1 = await backend.promote(d1.id, 'production');
  assert.equal(a1.deploymentId, d1.id);
  assert.match(a1.url, /\/acme-web\/$/);

  // The stable production folder was materialized.
  assert.ok(fs.existsSync(path.join(TMP, 'artifacts', 'acme-web', '_prod', 'index.html')));

  // Second deployment, promoted — previous pointer should track d1.
  const d2 = await backend.createDeployment({ projectName: 'acme-web', meta: {} });
  await backend.uploadArtifacts(d2, fakeFiles());
  await backend.finalizeDeployment(d2.id, { status: 'READY', fileCount: 2, sizeBytes: 28 });
  const a2 = await backend.promote(d2.id, 'production');
  assert.equal(a2.deploymentId, d2.id);
  assert.equal(a2.previousDeploymentId, d1.id);

  // Rollback returns production to d1.
  const back = await backend.rollback('acme-web', 'production');
  assert.equal(back.deploymentId, d1.id);

  // Listing shows both, newest first.
  const list = await backend.listDeployments('acme-web');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, d2.id);
});

test('promoting a non-READY deployment is rejected', async () => {
  const backend = getBackend({ mock: true });
  await backend.createProject({ name: 'wip', framework: 'react' });
  const d = await backend.createDeployment({ projectName: 'wip', meta: {} });
  await assert.rejects(() => backend.promote(d.id, 'production'), /not READY/);
});

test('rollback with no history is rejected', async () => {
  const backend = getBackend({ mock: true });
  await backend.createProject({ name: 'fresh', framework: 'react' });
  await assert.rejects(() => backend.rollback('fresh', 'production'), /No previous/);
});
