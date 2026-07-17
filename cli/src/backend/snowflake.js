'use strict';

const fs = require('fs');
const path = require('path');

// snowflake-sdk is only required lazily so the mock backend (and `snowd --help`)
// work even if the dependency has not been installed yet.
let sdk = null;
function loadSdk() {
  if (!sdk) sdk = require('snowflake-sdk');
  return sdk;
}

const DB = process.env.SNOWD_DATABASE || 'SNOW_DEPLOY';
const SCHEMA = process.env.SNOWD_SCHEMA || 'CORE';
const STAGE = process.env.SNOWD_STAGE || 'ARTIFACTS';

/**
 * Snowflake-backed implementation of the backend contract.
 *
 * Reads go through plain SELECTs; mutations go through the stored procedures in
 * `snowflake/02_procedures.sql` so the deploy-lifecycle rules (status
 * transitions, alias updates, COPY FILES on promote) live in one place and are
 * shared by the CLI, the control-plane API, and anyone calling from a worksheet.
 */
class SnowflakeBackend {
  constructor(creds) {
    this.kind = 'snowflake';
    this.creds = creds;
    this.db = creds.database || DB;
    this.schema = creds.schema || SCHEMA;
    this.stage = creds.stage || STAGE;
    this.fq = `${this.db}.${this.schema}`;
    this.stageRef = `@${this.fq}.${this.stage}`;
    this._conn = null;
  }

  describe() {
    return { kind: 'snowflake', target: `${this.creds.account}/${this.fq}` };
  }

  async _connect() {
    if (this._conn) return this._conn;
    const snowflake = loadSdk();
    const options = {
      account: this.creds.account,
      username: this.creds.username,
      role: this.creds.role,
      warehouse: this.creds.warehouse,
      database: this.db,
      schema: this.schema,
      application: 'snow-deploy',
    };
    if (this.creds.privateKeyPath) {
      options.authenticator = 'SNOWFLAKE_JWT';
      options.privateKey = fs.readFileSync(this.creds.privateKeyPath, 'utf8');
    } else {
      options.password = this.creds.password;
    }
    const conn = snowflake.createConnection(options);
    await new Promise((resolve, reject) => {
      conn.connect((err) => (err ? reject(err) : resolve()));
    });
    this._conn = conn;
    return conn;
  }

  _exec(sqlText, binds = []) {
    return new Promise((resolve, reject) => {
      this._conn.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows || [])),
      });
    });
  }

  async exec(sqlText, binds = []) {
    await this._connect();
    return this._exec(sqlText, binds);
  }

  // Procedures return a single-column VARIANT/JSON row; unwrap it.
  async call(proc, args = []) {
    const placeholders = args.map(() => '?').join(', ');
    const rows = await this.exec(`CALL ${this.fq}.${proc}(${placeholders})`, args);
    const value = rows.length ? Object.values(rows[0])[0] : null;
    return typeof value === 'string' ? safeJson(value) : value;
  }

  // ---- Projects -------------------------------------------------------------
  async createProject({ name, framework = 'react', config = {}, createdBy }) {
    return this.call('CREATE_PROJECT', [name, framework, JSON.stringify(config), createdBy || null]);
  }

  async getProject(name) {
    const rows = await this.exec(
      `SELECT OBJECT_CONSTRUCT('id',ID,'name',NAME,'slug',SLUG,'framework',FRAMEWORK,
        'config',CONFIG,'createdBy',CREATED_BY,'createdAt',TO_VARCHAR(CREATED_AT)) AS J
       FROM ${this.fq}.PROJECTS WHERE NAME = ?`,
      [name],
    );
    return rows.length ? safeJson(rows[0].J) : null;
  }

  async listProjects() {
    const rows = await this.exec(
      `SELECT OBJECT_CONSTRUCT('id',ID,'name',NAME,'slug',SLUG,'framework',FRAMEWORK,
        'createdBy',CREATED_BY,'createdAt',TO_VARCHAR(CREATED_AT)) AS J
       FROM ${this.fq}.PROJECTS ORDER BY NAME`,
    );
    return rows.map((r) => safeJson(r.J));
  }

  async removeProject(name) {
    return this.call('REMOVE_PROJECT', [name]);
  }

  // ---- Deployments ----------------------------------------------------------
  async createDeployment({ projectName, meta = {}, createdBy }) {
    return this.call('CREATE_DEPLOYMENT', [projectName, JSON.stringify(meta), createdBy || null]);
  }

  async uploadArtifacts(deployment, files) {
    await this._connect();
    // Group by destination directory so each PUT ships a whole folder at once.
    const byDir = new Map();
    for (const f of files) {
      const dir = path.posix.dirname(f.relPath);
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push(f);
    }
    let uploaded = 0;
    for (const [dir, group] of byDir) {
      const stageDir =
        `${this.stageRef}/${deployment.slug}/${deployment.id}` +
        (dir === '.' ? '' : `/${dir}`);
      for (const f of group) {
        const local = f.absPath.replace(/\\/g, '/');
        await this._exec(
          `PUT 'file://${local}' '${stageDir}/' ` +
            `AUTO_COMPRESS=FALSE SOURCE_COMPRESSION=NONE OVERWRITE=TRUE`,
        );
        uploaded += 1;
      }
    }
    return { uploaded };
  }

  async finalizeDeployment(id, patch) {
    return this.call('FINALIZE_DEPLOYMENT', [
      id,
      patch.status,
      patch.fileCount ?? null,
      patch.sizeBytes ?? null,
      patch.fingerprint ?? null,
      patch.buildLogs ?? null,
    ]);
  }

  async getDeployment(id) {
    const rows = await this.exec(
      `SELECT OBJECT_CONSTRUCT('id',ID,'projectName',PROJECT_NAME,'slug',SLUG,'status',STATUS,
        'git',GIT,'sizeBytes',SIZE_BYTES,'fileCount',FILE_COUNT,'fingerprint',FINGERPRINT,
        'url',URL,'createdBy',CREATED_BY,'createdAt',TO_VARCHAR(CREATED_AT),'buildLogs',BUILD_LOGS) AS J
       FROM ${this.fq}.DEPLOYMENTS WHERE ID = ?`,
      [id],
    );
    return rows.length ? safeJson(rows[0].J) : null;
  }

  async listDeployments(projectName, { limit = 20 } = {}) {
    const rows = await this.exec(
      `SELECT OBJECT_CONSTRUCT('id',ID,'projectName',PROJECT_NAME,'slug',SLUG,'status',STATUS,
        'git',GIT,'sizeBytes',SIZE_BYTES,'fileCount',FILE_COUNT,'url',URL,
        'createdBy',CREATED_BY,'createdAt',TO_VARCHAR(CREATED_AT)) AS J
       FROM ${this.fq}.DEPLOYMENTS WHERE PROJECT_NAME = ?
       ORDER BY CREATED_AT DESC LIMIT ?`,
      [projectName, limit],
    );
    return rows.map((r) => safeJson(r.J));
  }

  async getAlias(projectName, target) {
    const rows = await this.exec(
      `SELECT OBJECT_CONSTRUCT('projectName',PROJECT_NAME,'target',TARGET,
        'deploymentId',DEPLOYMENT_ID,'previousDeploymentId',PREVIOUS_DEPLOYMENT_ID,
        'url',URL,'updatedAt',TO_VARCHAR(UPDATED_AT)) AS J
       FROM ${this.fq}.ALIASES WHERE PROJECT_NAME = ? AND TARGET = ?`,
      [projectName, target],
    );
    return rows.length ? safeJson(rows[0].J) : null;
  }

  async promote(deploymentId, target = 'production') {
    return this.call('PROMOTE', [deploymentId, target]);
  }

  async rollback(projectName, target = 'production') {
    return this.call('ROLLBACK', [projectName, target]);
  }

  async close() {
    if (this._conn) {
      await new Promise((resolve) => this._conn.destroy(() => resolve()));
      this._conn = null;
    }
  }
}

function safeJson(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

module.exports = SnowflakeBackend;
