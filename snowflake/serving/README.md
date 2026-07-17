# Serving layer (Snowpark Container Services)

A single container serves **every** deployed app straight from the
`ARTIFACTS` stage — you build and push this image once, not per app. It runs
two processes:

- **nginx** — static serving with SPA fallback and immutable `/assets/` caching
- **auth sidecar** (`auth.js`) — per-app access control (see below)

```
/artifacts/{slug}/_prod/…          → https://<ingress>/{slug}/           (production)
/artifacts/{slug}/{deploymentId}/… → https://<ingress>/{slug}/~/{id}/    (preview)
```

`snowd deploy` uploads files to `{slug}/{deploymentId}/`; `snowd promote`
(via the `PROMOTE` procedure) copies them into `{slug}/_prod/`.

## Per-app access control

Every request to an app path triggers an nginx `auth_request` to the sidecar:

1. SPCS ingress authenticates the visitor against Snowflake and injects their
   username as the `Sf-Context-Current-User` header. Clients cannot forge this
   through ingress — it is set after authentication.
2. nginx forwards the app slug + that username to the sidecar.
3. The sidecar checks them against `/artifacts/_meta/access.json`, the policy
   file the `GRANT_ACCESS`/`REVOKE_ACCESS`/`PUBLISH_ACCESS` procedures
   (03_access.sql) compile from the `APP_ACCESS` table.

Policy semantics: **no entry for an app → any authenticated Snowflake user may
view it; entries present → only the listed usernames** (`*` = everyone).
Previews are protected the same as production. Denials return a 403 page and
are logged to the container's stdout for audit. Policy changes propagate
through the stage mount within seconds — no restart.

> Trust note: the check relies on requests entering through SPCS ingress. Do
> not expose the container's port by any other path, and keep the `_meta/`
> prefix block in nginx.conf (it stops the policy file from being served).

## One-time setup

Run `01_setup.sql`, `02_procedures.sql`, and `03_access.sql` first, then as
`ACCOUNTADMIN`:

```sql
USE ROLE ACCOUNTADMIN;
USE SCHEMA SNOW_DEPLOY.CORE;

-- Compute pool the service runs on.
CREATE COMPUTE POOL IF NOT EXISTS SNOW_DEPLOY_POOL
  MIN_NODES = 1 MAX_NODES = 1 INSTANCE_FAMILY = CPU_X64_XS;

-- Image registry for the serving image.
CREATE IMAGE REPOSITORY IF NOT EXISTS IMAGES;
SHOW IMAGE REPOSITORIES;   -- note the repository_url
```

## Build & push the image

```bash
cd snowflake/serving
REPO_URL=<repository_url from SHOW IMAGE REPOSITORIES>

docker build --platform linux/amd64 -t "$REPO_URL/snow-deploy-serve:latest" .
snow spcs image-registry login          # or: docker login <registry-host>
docker push "$REPO_URL/snow-deploy-serve:latest"
```

## Create the service

```sql
USE ROLE ACCOUNTADMIN;
USE SCHEMA SNOW_DEPLOY.CORE;

CREATE SERVICE SNOW_DEPLOY_SERVE
  IN COMPUTE POOL SNOW_DEPLOY_POOL
  FROM SPECIFICATION $$
<paste the contents of service-spec.yaml here>
  $$;

-- Grant the ingress endpoint to whoever should reach the apps.
GRANT SERVICE ROLE SNOW_DEPLOY_SERVE!ALL_ENDPOINTS_USAGE TO ROLE SNOW_DEPLOY_DEPLOYER;

-- Get the public URL, then store it so deployment URLs are correct.
SHOW ENDPOINTS IN SERVICE SNOW_DEPLOY_SERVE;   -- copy ingress_url
UPDATE SNOW_DEPLOY.CORE.SETTINGS
  SET VALUE = 'https://<ingress_url>' WHERE KEY = 'serve_base';
```

Point the CLI at the same origin so it prints working links:

```bash
export SNOWD_SERVE_BASE="https://<ingress_url>"
```

## How updates propagate

The stage is a mounted volume. After each upload/promote the procedures run
`ALTER STAGE ARTIFACTS REFRESH`, so new files appear to the container within
seconds — no redeploy of the service needed. Because the serving image is app
agnostic, you only rebuild it if you change `nginx.conf`.

## Access control

`endpoints[].public: true` gives a Snowflake-authenticated ingress URL (users
log in with Snowflake). For fully public apps or a custom domain, front the
service with your own gateway, or see Snowflake's docs on service ingress.
