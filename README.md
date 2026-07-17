# snow-deploy ▲

A Vercel-style platform for deploying **React apps into Snowflake**. Push a
build with one command, get an instant preview URL, promote to production, and
roll back — all backed by your own Snowflake account.

```bash
snowd deploy          # build + upload → preview URL
snowd deploy --prod   # …and promote to production
snowd rollback        # instantly revert production
```

Apps are served by a single **Snowpark Container Services** nginx container that
streams static assets straight from a Snowflake stage — no per-app Docker images,
no external hosting. Your code, deployments, and traffic never leave Snowflake.

---

## Why this exists

Snowflake is a great place to run internal React tools (dashboards, admin
consoles, data apps) because the data and auth already live there. But there's
no "just deploy it" workflow. `snow-deploy` adds one:

| Vercel concept        | snow-deploy implementation                                   |
| --------------------- | ------------------------------------------------------------ |
| Project               | Row in `PROJECTS`, plus a stage prefix `@ARTIFACTS/{slug}/`  |
| Deployment            | Immutable upload to `@ARTIFACTS/{slug}/{deploymentId}/`      |
| Preview URL           | `https://<ingress>/{slug}/~/{deploymentId}/`                 |
| Production alias      | `@ARTIFACTS/{slug}/_prod/` served at `https://<ingress>/{slug}/` |
| Promote / Rollback    | `PROMOTE` / `ROLLBACK` stored procedures (repoint the alias) |
| Edge/CDN serving      | One nginx service in SPCS, mounting the stage read-only      |
| Dashboard             | React SPA on the control-plane API                           |
| CLI                   | `snowd`                                                       |

## Architecture

```
                          ┌─────────────────────────── Snowflake ───────────────────────────┐
   $ snowd deploy         │                                                                  │
   ┌──────────┐  build    │   SNOW_DEPLOY.CORE                                               │
   │  React   │──────────▶│   ├─ PROJECTS / DEPLOYMENTS / ALIASES   (control-plane tables)   │
   │   app    │  PUT      │   ├─ Stored procs: CREATE/FINALIZE/PROMOTE/ROLLBACK              │
   └──────────┘  files    │   └─ @ARTIFACTS stage                                            │
        │                 │        {slug}/{deploymentId}/…   (every deploy, immutable)       │
        │                 │        {slug}/_prod/…            (current production)            │
        ▼                 │                    │ mounted read-only                           │
   ┌──────────┐   REST    │                    ▼                                             │
   │ dashboard│──────────▶│   SNOW_DEPLOY_SERVE  (SPCS nginx)  ──►  https://<ingress>/{slug}/│
   │  + API   │           │                                                                  │
   └──────────┘           └───────────────────────────────────────────────────────────────  ┘
```

Two data paths, one source of truth:

- **Control plane** — the `snowd` CLI and the API server call stored procedures
  to record projects/deployments and to move the production alias.
- **Data plane** — the nginx service mounts `@ARTIFACTS` and serves files. A
  promote is just a `COPY FILES` into `{slug}/_prod/` plus a stage refresh, so
  it takes effect in seconds without redeploying anything.

## Repository layout

```
cli/              snowd — the deploy CLI (Node)
  src/backend/    pluggable backend: snowflake.js (real) + mock.js (local FS)
server/           Express control-plane API; also hosts the dashboard build
dashboard/        React (Vite) dashboard — projects, deployments, promote/rollback
snowflake/
  01_setup.sql       database, schema, stage, tables, roles
  02_procedures.sql  deploy-lifecycle stored procedures
  serving/           Dockerfile + nginx.conf + SPCS service spec (see its README)
examples/hello-react/   a sample app you can deploy
```

## Quickstart

### 0. Prerequisites
- Node 18+
- A Snowflake account with `ACCOUNTADMIN` (for one-time setup) and SPCS enabled.

### 1. Provision the control plane
Run the SQL (Snowsight worksheet or `snow sql -f`):
```sql
!source snowflake/01_setup.sql
!source snowflake/02_procedures.sql
-- then grant yourself the deployer role:
GRANT ROLE SNOW_DEPLOY_DEPLOYER TO USER <you>;
```

### 2. Stand up serving (once)
Follow [`snowflake/serving/README.md`](snowflake/serving/README.md): create a
compute pool + image repo, build & push the nginx image, `CREATE SERVICE`, then
save the ingress URL into `SETTINGS.serve_base`.

### 3. Log in and deploy
```bash
npm install
alias snowd="node $PWD/cli/bin/snowd.js"   # or `npm link` inside cli/

snowd login              # stores Snowflake credentials in ~/.snowdeploy
export SNOWD_SERVE_BASE="https://<your-ingress-url>"

cd examples/hello-react
snowd init               # writes snowdeploy.json (auto-detects Vite/CRA/Next)
snowd deploy --prod      # build, upload, promote
snowd open               # print the production URL
```

### 4. Manage from the dashboard
```bash
npm run dashboard:build
npm run server           # http://localhost:8787
```

## Try it with no Snowflake account (mock mode)

Every command and the API work against a local filesystem store, so you can see
the whole workflow before wiring up Snowflake:

```bash
export SNOWD_MOCK=1
cd examples/hello-react
node ../../cli/bin/snowd.js init
node ../../cli/bin/snowd.js deploy --prod
node ../../cli/bin/snowd.js ls hello-react
node ../../cli/bin/snowd.js rollback hello-react

# dashboard against the same mock store:
cd ../.. && npm run dashboard:build && SNOWD_MOCK=1 npm run server
```

## CLI reference

| Command | Description |
| --- | --- |
| `snowd login` | Save Snowflake connection credentials |
| `snowd init` | Create `snowdeploy.json` (detects framework/build settings) |
| `snowd deploy [--prod] [--prebuilt]` | Build + upload; `--prod` also promotes |
| `snowd ls [project]` | List projects, or a project's deployments |
| `snowd inspect <id> [--logs]` | Show a deployment's details and build logs |
| `snowd promote <id> [--target]` | Point an alias at a deployment |
| `snowd rollback [project]` | Revert to the previous deployment |
| `snowd rm <project> --yes` | Delete a project + its artifacts |
| `snowd open [project]` | Print/open the production URL |
| `snowd whoami` | Show the active backend |

Add `--mock` to any command to use the local store.

## Configuration

**Connection** (`snowd login`, or env vars): `SNOWFLAKE_ACCOUNT`,
`SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD` **or** `SNOWFLAKE_PRIVATE_KEY_PATH`,
`SNOWFLAKE_ROLE`, `SNOWFLAKE_WAREHOUSE`. Key-pair auth is recommended.

**Per-app** (`snowdeploy.json`): `name`, `framework`, `buildCommand`,
`outputDirectory`, `installCommand`.

**Serving origin**: `SNOWD_SERVE_BASE` (CLI links) and `SETTINGS.serve_base`
(URLs stored on deployments) should both point at the SPCS ingress URL.

## Security notes

- The CLI authenticates as `SNOW_DEPLOY_DEPLOYER`, scoped to the `SNOW_DEPLOY`
  database and the artifact stage only.
- Credentials live in `~/.snowdeploy/credentials.json` (mode `600`) and are
  git-ignored. Prefer key-pair auth in CI.
- The serving endpoint is Snowflake-authenticated by default (`public: true`
  ingress requires a Snowflake login). Front it with your own gateway for
  anonymous access.

## Notes / limitations

- Targets **static** React builds (Vite, CRA, Next static export). SSR/API
  routes would need an app container per project — a natural follow-on.
- The Snowflake SQL and SPCS steps are validated by design; the CLI, control
  plane, nginx routing, and mock backend are exercised by the checks in this
  repo (`npm test`, plus the nginx routing was tested end-to-end).

## License

MIT
