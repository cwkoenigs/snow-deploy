'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { deploymentId, projectId, slugify } = require('../lib/ids');
const { productionUrl, previewUrl } = require('../lib/urls');

// Where the mock stores everything. Overridable so tests get isolation.
function root() {
  return process.env.SNOWD_MOCK_DIR || path.join(os.homedir(), '.snowdeploy', 'mock');
}

/**
 * Local, filesystem-backed implementation of the backend contract. It mirrors
 * the Snowflake data model (projects / deployments / aliases) in a single JSON
 * file and copies build artifacts into a directory tree that matches the stage
 * layout `{slug}/{deploymentId}/...`. This lets `snowd deploy`, `promote`, and
 * `rollback` be run and verified end-to-end with no cloud dependency.
 */
class MockBackend {
  constructor() {
    this.kind = 'mock';
    this.dir = root();
    this.dbPath = path.join(this.dir, 'db.json');
    this.artifactsDir = path.join(this.dir, 'artifacts');
    fs.mkdirSync(this.artifactsDir, { recursive: true });
  }

  describe() {
    return { kind: 'mock', target: this.dir };
  }

  _read() {
    try {
      const db = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      db.access = db.access || {};
      return db;
    } catch {
      return { projects: {}, deployments: {}, aliases: {}, access: {} };
    }
  }

  _write(db) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.dbPath, JSON.stringify(db, null, 2));
  }

  async createProject({ name, framework = 'react', config = {}, createdBy = 'local' }) {
    const db = this._read();
    if (db.projects[name]) return db.projects[name];
    const project = {
      id: projectId(),
      name,
      slug: slugify(name),
      framework,
      config,
      createdBy,
      createdAt: new Date().toISOString(),
    };
    db.projects[name] = project;
    this._write(db);
    return project;
  }

  async getProject(name) {
    return this._read().projects[name] || null;
  }

  async listProjects() {
    return Object.values(this._read().projects).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  async removeProject(name) {
    const db = this._read();
    if (!db.projects[name]) return false;
    const slug = db.projects[name].slug;
    delete db.projects[name];
    delete db.access[name];
    for (const [id, d] of Object.entries(db.deployments)) {
      if (d.projectName === name) delete db.deployments[id];
    }
    for (const key of Object.keys(db.aliases)) {
      if (key.startsWith(`${name}:`)) delete db.aliases[key];
    }
    fs.rmSync(path.join(this.artifactsDir, slug), { recursive: true, force: true });
    this._write(db);
    this._publishAccess(db);
    return true;
  }

  async createDeployment({ projectName, meta = {}, createdBy = 'local' }) {
    const db = this._read();
    const project = db.projects[projectName];
    if (!project) throw new Error(`Unknown project: ${projectName}`);
    const dep = {
      id: deploymentId(),
      projectName,
      slug: project.slug,
      status: 'BUILDING',
      git: meta.git || { sha: null, branch: null, message: null },
      sizeBytes: null,
      fileCount: null,
      fingerprint: null,
      buildLogs: '',
      createdBy,
      createdAt: new Date().toISOString(),
      url: previewUrl(project.slug, ''),
    };
    dep.url = previewUrl(project.slug, dep.id);
    db.deployments[dep.id] = dep;
    this._write(db);
    return dep;
  }

  async uploadArtifacts(deployment, files) {
    const destRoot = path.join(this.artifactsDir, deployment.slug, deployment.id);
    fs.rmSync(destRoot, { recursive: true, force: true });
    for (const f of files) {
      const dest = path.join(destRoot, f.relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.absPath, dest);
    }
    return { uploaded: files.length, dest: destRoot };
  }

  async finalizeDeployment(id, patch) {
    const db = this._read();
    const dep = db.deployments[id];
    if (!dep) throw new Error(`Unknown deployment: ${id}`);
    Object.assign(dep, patch);
    this._write(db);
    return dep;
  }

  async getDeployment(id) {
    return this._read().deployments[id] || null;
  }

  async listDeployments(projectName, { limit = 20 } = {}) {
    return Object.values(this._read().deployments)
      .filter((d) => d.projectName === projectName)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async getAlias(projectName, target) {
    return this._read().aliases[`${projectName}:${target}`] || null;
  }

  async promote(deploymentIdArg, target = 'production') {
    const db = this._read();
    const dep = db.deployments[deploymentIdArg];
    if (!dep) throw new Error(`Unknown deployment: ${deploymentIdArg}`);
    if (dep.status !== 'READY') {
      throw new Error(`Deployment ${deploymentIdArg} is ${dep.status}, not READY`);
    }
    const key = `${dep.projectName}:${target}`;
    const prev = db.aliases[key];
    // Mirror the stage COPY FILES step: materialize the active build under a
    // stable path so the server always serves the same folder for `production`.
    if (target === 'production') {
      const src = path.join(this.artifactsDir, dep.slug, dep.id);
      const dst = path.join(this.artifactsDir, dep.slug, '_prod');
      fs.rmSync(dst, { recursive: true, force: true });
      if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
    }
    db.aliases[key] = {
      projectName: dep.projectName,
      target,
      deploymentId: dep.id,
      previousDeploymentId: prev ? prev.deploymentId : null,
      url: target === 'production' ? productionUrl(dep.slug) : dep.url,
      updatedAt: new Date().toISOString(),
    };
    this._write(db);
    return db.aliases[key];
  }

  async rollback(projectName, target = 'production') {
    const alias = await this.getAlias(projectName, target);
    if (!alias || !alias.previousDeploymentId) {
      throw new Error(`No previous ${target} deployment to roll back to for ${projectName}`);
    }
    return this.promote(alias.previousDeploymentId, target);
  }

  // ---- Per-app access control ----------------------------------------------
  // Mirrors the PUBLISH_ACCESS procedure: compile the rules into a policy file
  // in the artifact tree, keyed by slug, which the serving sidecar enforces.
  _publishAccess(db) {
    const policies = {};
    for (const [projectName, entries] of Object.entries(db.access)) {
      const project = db.projects[projectName];
      if (project && entries.length) policies[project.slug] = entries.map((e) => e.principal);
    }
    const metaDir = path.join(this.artifactsDir, '_meta');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(path.join(metaDir, 'access.json'), JSON.stringify(policies, null, 2));
  }

  async grantAccess(projectName, principal, grantedBy = 'local') {
    const db = this._read();
    if (!db.projects[projectName]) throw new Error(`Unknown project: ${projectName}`);
    const entries = (db.access[projectName] = db.access[projectName] || []);
    const upper = String(principal).toUpperCase();
    if (!entries.some((e) => e.principal === upper)) {
      entries.push({ principal: upper, grantedBy, grantedAt: new Date().toISOString() });
    }
    this._write(db);
    this._publishAccess(db);
    return { project: projectName, principals: entries.map((e) => e.principal) };
  }

  async revokeAccess(projectName, principal) {
    const db = this._read();
    const upper = String(principal).toUpperCase();
    db.access[projectName] = (db.access[projectName] || []).filter(
      (e) => e.principal !== upper,
    );
    this._write(db);
    this._publishAccess(db);
    return {
      project: projectName,
      principals: db.access[projectName].map((e) => e.principal),
    };
  }

  async listAccess(projectName) {
    return this._read().access[projectName] || [];
  }

  async close() {}
}

module.exports = MockBackend;
