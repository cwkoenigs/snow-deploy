/* =============================================================================
   snow-deploy · control-plane setup
   -----------------------------------------------------------------------------
   Creates the database, schema, artifact stage, tables, and roles that back the
   platform. Run once as ACCOUNTADMIN (or a role that can create databases,
   roles, and warehouses). Safe to re-run — everything uses IF NOT EXISTS.
   ============================================================================= */

USE ROLE ACCOUNTADMIN;

-- Warehouse used by the CLI / control plane for its (tiny) metadata queries.
CREATE WAREHOUSE IF NOT EXISTS SNOW_DEPLOY_WH
  WAREHOUSE_SIZE = 'XSMALL'
  AUTO_SUSPEND = 60
  AUTO_RESUME = TRUE
  INITIALLY_SUSPENDED = TRUE
  COMMENT = 'snow-deploy control plane';

CREATE DATABASE IF NOT EXISTS SNOW_DEPLOY COMMENT = 'snow-deploy control plane';
CREATE SCHEMA IF NOT EXISTS SNOW_DEPLOY.CORE;

USE DATABASE SNOW_DEPLOY;
USE SCHEMA CORE;

-- -----------------------------------------------------------------------------
-- Artifact stage. Holds every deployment's built static files under
-- `{slug}/{deploymentId}/...`, plus a materialized `{slug}/_prod/...` copy that
-- the serving container mounts and serves as production.
--
-- DIRECTORY + SNOWFLAKE_SSE are required so the stage can be mounted as a volume
-- by Snowpark Container Services.
-- -----------------------------------------------------------------------------
CREATE STAGE IF NOT EXISTS ARTIFACTS
  DIRECTORY = (ENABLE = TRUE)
  ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')
  COMMENT = 'Static build artifacts for deployed apps';

-- -----------------------------------------------------------------------------
-- Data model
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS PROJECTS (
  ID          STRING       NOT NULL,
  NAME        STRING       NOT NULL,
  SLUG        STRING       NOT NULL,
  FRAMEWORK   STRING,
  CONFIG      VARIANT,
  CREATED_BY  STRING,
  CREATED_AT  TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_PROJECTS PRIMARY KEY (ID),
  CONSTRAINT UQ_PROJECTS_NAME UNIQUE (NAME)
);

CREATE TABLE IF NOT EXISTS DEPLOYMENTS (
  ID           STRING       NOT NULL,
  PROJECT_NAME STRING       NOT NULL,
  SLUG         STRING       NOT NULL,
  STATUS       STRING       NOT NULL,          -- BUILDING | READY | ERROR | CANCELED
  GIT          VARIANT,
  SIZE_BYTES   NUMBER,
  FILE_COUNT   NUMBER,
  FINGERPRINT  STRING,
  URL          STRING,
  BUILD_LOGS   STRING,
  CREATED_BY   STRING,
  CREATED_AT   TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_DEPLOYMENTS PRIMARY KEY (ID)
);

-- One row per (project, target) pointing at the live deployment. `target` is
-- 'production' or any custom alias (e.g. 'staging').
CREATE TABLE IF NOT EXISTS ALIASES (
  PROJECT_NAME          STRING NOT NULL,
  TARGET                STRING NOT NULL,
  DEPLOYMENT_ID         STRING NOT NULL,
  PREVIOUS_DEPLOYMENT_ID STRING,
  URL                   STRING,
  UPDATED_AT            TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_ALIASES PRIMARY KEY (PROJECT_NAME, TARGET)
);

-- Small key/value settings table. `serve_base` is the public origin the serving
-- service is reachable at; procedures use it to build deployment URLs. Update it
-- to your SPCS ingress endpoint after the service is created (see serving/).
CREATE TABLE IF NOT EXISTS SETTINGS (
  KEY   STRING NOT NULL,
  VALUE STRING,
  CONSTRAINT PK_SETTINGS PRIMARY KEY (KEY)
);
MERGE INTO SETTINGS t USING (SELECT 'serve_base' AS KEY, 'http://localhost:8080' AS VALUE) s
  ON t.KEY = s.KEY
  WHEN NOT MATCHED THEN INSERT (KEY, VALUE) VALUES (s.KEY, s.VALUE);

-- -----------------------------------------------------------------------------
-- Deployer role: what the CLI / control-plane API authenticate as.
-- -----------------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS SNOW_DEPLOY_DEPLOYER;

GRANT USAGE ON WAREHOUSE SNOW_DEPLOY_WH TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT USAGE ON DATABASE SNOW_DEPLOY TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT USAGE ON SCHEMA SNOW_DEPLOY.CORE TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT READ, WRITE ON STAGE SNOW_DEPLOY.CORE.ARTIFACTS TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA SNOW_DEPLOY.CORE
  TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT SELECT, INSERT, UPDATE, DELETE ON FUTURE TABLES IN SCHEMA SNOW_DEPLOY.CORE
  TO ROLE SNOW_DEPLOY_DEPLOYER;

-- Grant the deployer role to yourself (edit the USER as needed).
-- GRANT ROLE SNOW_DEPLOY_DEPLOYER TO USER <YOUR_USER>;

SELECT 'snow-deploy control plane ready. Next: run 02_procedures.sql' AS STATUS;
