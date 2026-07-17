# Deployment runbook

Exact, ordered steps to stand up snow-deploy in a Snowflake account. Run it
yourself, or hand it to a Claude Code session (see [§ Running this from a
Claude Code session](#running-this-from-a-claude-code-session)).

**Time:** ~30 minutes, most of it waiting for the compute pool.
**You need:** `ACCOUNTADMIN` (one-time provisioning only), Docker, Node 18+,
and this repo cloned. SPCS requires a non-trial account in a
[supported region](https://docs.snowflake.com/en/developer-guide/snowpark-container-services/overview).

Values you'll fill in as you go:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `<ACCOUNT>` | account identifier | `ab12345.us-east-1` |
| `<YOU>` | your Snowflake username | `KOENIGS_CLARK` |
| `<REPO_URL>` | image repository URL from step 2 | `org-acct.registry.snowflakecomputing.com/snow_deploy/core/images` |
| `<INGRESS_URL>` | public endpoint from step 4 | `gk3mzq-org-acct.snowflakecomputing.app` |

---

## Step 1 — Provision the control plane (SQL)

Run the three scripts **in order** as `ACCOUNTADMIN`, in a Snowsight worksheet
or with the [Snowflake CLI](https://docs.snowflake.com/en/developer-guide/snowflake-cli/index):

```bash
snow sql -f snowflake/01_setup.sql        # db, schema, stage, tables, roles, warehouse
snow sql -f snowflake/02_procedures.sql   # deploy lifecycle procedures
snow sql -f snowflake/03_access.sql       # per-app access control
```

Then grant yourself (and any other deployers) the role:

```sql
GRANT ROLE SNOW_DEPLOY_DEPLOYER TO USER <YOU>;
```

**Verify:** `SHOW PROCEDURES IN SCHEMA SNOW_DEPLOY.CORE;` lists
`CREATE_PROJECT`, `PROMOTE`, `GRANT_ACCESS`, etc.

## Step 2 — Compute pool + image repository

```sql
USE ROLE ACCOUNTADMIN;
USE SCHEMA SNOW_DEPLOY.CORE;

CREATE COMPUTE POOL IF NOT EXISTS SNOW_DEPLOY_POOL
  MIN_NODES = 1 MAX_NODES = 1 INSTANCE_FAMILY = CPU_X64_XS;

CREATE IMAGE REPOSITORY IF NOT EXISTS IMAGES;
SHOW IMAGE REPOSITORIES IN SCHEMA SNOW_DEPLOY.CORE;
```

Copy `repository_url` from the output — that's `<REPO_URL>`.

## Step 3 — Build and push the serving image

```bash
cd snowflake/serving

docker build --platform linux/amd64 -t <REPO_URL>/snow-deploy-serve:latest .

# Log in to the registry (host = <REPO_URL> up to the first slash):
snow spcs image-registry login
# ...or without the snow CLI:
# docker login <registry-host> -u <YOU>    # password = your Snowflake password

docker push <REPO_URL>/snow-deploy-serve:latest
```

**Verify:** `SHOW IMAGES IN IMAGE REPOSITORY SNOW_DEPLOY.CORE.IMAGES;`

## Step 4 — Create the service

Paste the contents of `snowflake/serving/service-spec.yaml` into the
specification block:

```sql
USE ROLE ACCOUNTADMIN;
USE SCHEMA SNOW_DEPLOY.CORE;

CREATE SERVICE SNOW_DEPLOY_SERVE
  IN COMPUTE POOL SNOW_DEPLOY_POOL
  FROM SPECIFICATION $$
  <contents of service-spec.yaml>
  $$;

-- Wait until status is READY (first start pulls the image; a few minutes):
SELECT SYSTEM$GET_SERVICE_STATUS('SNOW_DEPLOY_SERVE');

-- Let deployers (and app viewers) reach the endpoint:
GRANT SERVICE ROLE SNOW_DEPLOY_SERVE!ALL_ENDPOINTS_USAGE TO ROLE SNOW_DEPLOY_DEPLOYER;

-- The public URL (provisioning it can also take a few minutes):
SHOW ENDPOINTS IN SERVICE SNOW_DEPLOY_SERVE;
```

Copy `ingress_url` — that's `<INGRESS_URL>`. Store it so deployment URLs are
built correctly:

```sql
UPDATE SNOW_DEPLOY.CORE.SETTINGS
  SET VALUE = 'https://<INGRESS_URL>' WHERE KEY = 'serve_base';
```

**Verify:** open `https://<INGRESS_URL>/healthz` in a browser — after the
Snowflake login you should see `ok`.

## Step 5 — Connect the CLI and deploy the example app

```bash
npm install

node cli/bin/snowd.js login --account <ACCOUNT> --user <YOU> \
  --role SNOW_DEPLOY_DEPLOYER --warehouse SNOW_DEPLOY_WH
# (interactive password prompt; or pass --private-key for key-pair auth)

export SNOWD_SERVE_BASE="https://<INGRESS_URL>"

cd examples/hello-react
node ../../cli/bin/snowd.js init --force
node ../../cli/bin/snowd.js deploy --prod
```

**Verify:** the command prints the production URL
(`https://<INGRESS_URL>/hello-react/`) — open it; you should see the app after
the Snowflake login.

## Step 6 — (Optional) restrict an app

```bash
node cli/bin/snowd.js access grant hello-react <SOME_USER>
node cli/bin/snowd.js access ls hello-react
```

**Verify:** a user *not* on the list gets the 403 page; listed users get the
app. Denials appear in the service logs:
`SELECT SYSTEM$GET_SERVICE_LOGS('SNOW_DEPLOY_SERVE', 0, 'web', 50);`

## Step 7 — (Optional) run the dashboard

```bash
npm run dashboard:build
npm run server            # http://localhost:8787
```

The dashboard/API use the same `~/.snowdeploy` credentials as the CLI. Run it
wherever your team can reach it (a shared box, or later as a second SPCS
service).

---

## Day-to-day after setup

Developers only ever need step 5's motion, per app:

```bash
snowd init          # once per app
snowd deploy        # preview
snowd deploy --prod # ship
snowd rollback      # undo
```

No SQL, no Docker, no admin rights — just the `SNOW_DEPLOY_DEPLOYER` role.

## Running this from a Claude Code session

A Claude Code cloud session can execute this entire runbook (including the
Docker build — start the daemon with `dockerd &`) once its environment allows
it. In the environment settings at claude.ai/code:

1. **Network policy** — allow your Snowflake hosts:
   `<ACCOUNT>.snowflakecomputing.com`, the registry host from `<REPO_URL>`,
   and `<INGRESS_URL>` (or use full network access).
2. **Environment variables** — set `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, and
   `SNOWFLAKE_PASSWORD` (the CLI reads these automatically; no `snowd login`
   needed).

Then instruct the session: *"Follow docs/DEPLOY.md and deploy the platform."*

> **Credential hygiene:** the setup steps need `ACCOUNTADMIN`. Prefer a trial/
> dev account or a dedicated temporary user for the AI-driven run, review the
> session transcript, and rotate or disable the credentials afterwards.
> Day-to-day deploys need only `SNOW_DEPLOY_DEPLOYER`.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `CREATE SERVICE` fails on the volume | Stage missing `DIRECTORY`/`SNOWFLAKE_SSE` — re-run `01_setup.sql` |
| Endpoint stuck on "provisioning in progress" | Normal for a few minutes after service creation |
| App 404s right after deploy | Stage refresh lag; retry, or `ALTER STAGE SNOW_DEPLOY.CORE.ARTIFACTS REFRESH;` |
| Wrong URLs printed by CLI | `SNOWD_SERVE_BASE` and `SETTINGS.serve_base` must both be the ingress URL |
| 403 on an app you own | You're not on its access list: `snowd access ls <project>` |
| `docker push` unauthorized | Re-run registry login; user needs `READ/WRITE` on the image repository |
