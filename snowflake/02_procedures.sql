/* =============================================================================
   snow-deploy · lifecycle stored procedures
   -----------------------------------------------------------------------------
   The write-side API of the control plane. The CLI and the control-plane server
   call these so the rules (id generation, status transitions, alias updates, and
   the stage COPY on promote) live in one place and can also be driven straight
   from a Snowflake worksheet.

   Run after 01_setup.sql, as a role that owns SNOW_DEPLOY.CORE.
   ============================================================================= */

USE DATABASE SNOW_DEPLOY;
USE SCHEMA CORE;

-- Build the public URL for a deployment/alias from the `serve_base` setting.
CREATE OR REPLACE FUNCTION SERVE_BASE()
  RETURNS STRING
  AS $$ SELECT COALESCE((SELECT VALUE FROM SNOW_DEPLOY.CORE.SETTINGS WHERE KEY = 'serve_base'),
                        'http://localhost:8080') $$;

-- ---------------------------------------------------------------------------
-- CREATE_PROJECT — idempotent by name. Returns the project object.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE CREATE_PROJECT(NAME STRING, FRAMEWORK STRING, CONFIG STRING, CREATED_BY STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
DECLARE
  existing INT;
  slug STRING;
  new_id STRING;
BEGIN
  SELECT COUNT(*) INTO :existing FROM PROJECTS WHERE NAME = :NAME;
  IF (existing = 0) THEN
    slug := REGEXP_REPLACE(REGEXP_REPLACE(LOWER(:NAME), '[^a-z0-9-]+', '-'), '^-+|-+$', '');
    new_id := 'prj_' || LEFT(REPLACE(UUID_STRING(), '-', ''), 16);
    INSERT INTO PROJECTS (ID, NAME, SLUG, FRAMEWORK, CONFIG, CREATED_BY)
      SELECT :new_id, :NAME, :slug, :FRAMEWORK, TRY_PARSE_JSON(:CONFIG), :CREATED_BY;
  END IF;
  RETURN (
    SELECT OBJECT_CONSTRUCT('id', ID, 'name', NAME, 'slug', SLUG, 'framework', FRAMEWORK,
      'config', CONFIG, 'createdBy', CREATED_BY, 'createdAt', TO_VARCHAR(CREATED_AT))
    FROM PROJECTS WHERE NAME = :NAME
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- REMOVE_PROJECT — delete project, its deployments, aliases, and artifacts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE REMOVE_PROJECT(NAME STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
DECLARE
  slug STRING;
BEGIN
  SELECT SLUG INTO :slug FROM PROJECTS WHERE NAME = :NAME;
  IF (slug IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('removed', FALSE, 'reason', 'not found');
  END IF;
  EXECUTE IMMEDIATE 'REMOVE @ARTIFACTS/' || :slug || '/';
  DELETE FROM ALIASES WHERE PROJECT_NAME = :NAME;
  DELETE FROM DEPLOYMENTS WHERE PROJECT_NAME = :NAME;
  DELETE FROM PROJECTS WHERE NAME = :NAME;
  ALTER STAGE ARTIFACTS REFRESH;
  RETURN OBJECT_CONSTRUCT('removed', TRUE, 'project', :NAME);
END;
$$;

-- ---------------------------------------------------------------------------
-- CREATE_DEPLOYMENT — register a new BUILDING deployment; returns it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE CREATE_DEPLOYMENT(PROJECT_NAME STRING, META STRING, CREATED_BY STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
DECLARE
  slug STRING;
  new_id STRING;
  url STRING;
  meta_v VARIANT;
BEGIN
  SELECT SLUG INTO :slug FROM PROJECTS WHERE NAME = :PROJECT_NAME;
  IF (slug IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('error', 'unknown project: ' || :PROJECT_NAME);
  END IF;
  meta_v := TRY_PARSE_JSON(:META);
  new_id := 'dpl_' || LEFT(REPLACE(UUID_STRING(), '-', ''), 20);
  url := SERVE_BASE() || '/' || :slug || '/~/' || :new_id || '/';
  INSERT INTO DEPLOYMENTS (ID, PROJECT_NAME, SLUG, STATUS, GIT, URL, CREATED_BY)
    SELECT :new_id, :PROJECT_NAME, :slug, 'BUILDING', :meta_v:git, :url, :CREATED_BY;
  RETURN (
    SELECT OBJECT_CONSTRUCT('id', ID, 'projectName', PROJECT_NAME, 'slug', SLUG,
      'status', STATUS, 'git', GIT, 'url', URL, 'createdBy', CREATED_BY,
      'createdAt', TO_VARCHAR(CREATED_AT))
    FROM DEPLOYMENTS WHERE ID = :new_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- FINALIZE_DEPLOYMENT — set terminal status + build stats after upload.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE FINALIZE_DEPLOYMENT(
    DEP_ID STRING, STATUS STRING, FILE_COUNT FLOAT, SIZE_BYTES FLOAT,
    FINGERPRINT STRING, BUILD_LOGS STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
BEGIN
  UPDATE DEPLOYMENTS
    SET STATUS = :STATUS,
        FILE_COUNT = :FILE_COUNT,
        SIZE_BYTES = :SIZE_BYTES,
        FINGERPRINT = COALESCE(:FINGERPRINT, FINGERPRINT),
        BUILD_LOGS = COALESCE(:BUILD_LOGS, BUILD_LOGS)
    WHERE ID = :DEP_ID;
  -- Make the newly-uploaded files visible to the directory table / mounts.
  ALTER STAGE ARTIFACTS REFRESH;
  RETURN (
    SELECT OBJECT_CONSTRUCT('id', ID, 'projectName', PROJECT_NAME, 'slug', SLUG,
      'status', STATUS, 'sizeBytes', SIZE_BYTES, 'fileCount', FILE_COUNT,
      'fingerprint', FINGERPRINT, 'url', URL, 'createdAt', TO_VARCHAR(CREATED_AT))
    FROM DEPLOYMENTS WHERE ID = :DEP_ID
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- PROMOTE — point an alias at a READY deployment. For 'production' it also
-- materializes the build under `{slug}/_prod/` so serving is a static mount.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE PROMOTE(DEP_ID STRING, TARGET STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
DECLARE
  slug STRING;
  project STRING;
  status STRING;
  prev STRING;
  url STRING;
BEGIN
  SELECT SLUG, PROJECT_NAME, STATUS INTO :slug, :project, :status
    FROM DEPLOYMENTS WHERE ID = :DEP_ID;
  IF (slug IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('error', 'unknown deployment: ' || :DEP_ID);
  END IF;
  IF (status <> 'READY') THEN
    RETURN OBJECT_CONSTRUCT('error', 'deployment ' || :DEP_ID || ' is ' || :status || ', not READY');
  END IF;

  SELECT DEPLOYMENT_ID INTO :prev FROM ALIASES WHERE PROJECT_NAME = :project AND TARGET = :TARGET;

  IF (:TARGET = 'production') THEN
    -- Replace the stable production folder with this deployment's files.
    EXECUTE IMMEDIATE 'REMOVE @ARTIFACTS/' || :slug || '/_prod/';
    EXECUTE IMMEDIATE 'COPY FILES INTO @ARTIFACTS/' || :slug || '/_prod/'
                      || ' FROM @ARTIFACTS/' || :slug || '/' || :DEP_ID || '/';
    ALTER STAGE ARTIFACTS REFRESH;
    url := SERVE_BASE() || '/' || :slug || '/';
  ELSE
    url := SERVE_BASE() || '/' || :slug || '/~/' || :DEP_ID || '/';
  END IF;

  MERGE INTO ALIASES a
    USING (SELECT :project AS PN, :TARGET AS TG) s
    ON a.PROJECT_NAME = s.PN AND a.TARGET = s.TG
    WHEN MATCHED THEN UPDATE SET
      DEPLOYMENT_ID = :DEP_ID, PREVIOUS_DEPLOYMENT_ID = :prev,
      URL = :url, UPDATED_AT = CURRENT_TIMESTAMP()
    WHEN NOT MATCHED THEN INSERT (PROJECT_NAME, TARGET, DEPLOYMENT_ID, PREVIOUS_DEPLOYMENT_ID, URL)
      VALUES (:project, :TARGET, :DEP_ID, :prev, :url);

  RETURN (
    SELECT OBJECT_CONSTRUCT('projectName', PROJECT_NAME, 'target', TARGET,
      'deploymentId', DEPLOYMENT_ID, 'previousDeploymentId', PREVIOUS_DEPLOYMENT_ID,
      'url', URL, 'updatedAt', TO_VARCHAR(UPDATED_AT))
    FROM ALIASES WHERE PROJECT_NAME = :project AND TARGET = :TARGET
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK — repoint an alias to the deployment it served previously.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE ROLLBACK(PROJECT_NAME STRING, TARGET STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
DECLARE
  prev STRING;
BEGIN
  SELECT PREVIOUS_DEPLOYMENT_ID INTO :prev
    FROM ALIASES WHERE PROJECT_NAME = :PROJECT_NAME AND TARGET = :TARGET;
  IF (prev IS NULL) THEN
    RETURN OBJECT_CONSTRUCT('error', 'no previous ' || :TARGET || ' deployment for ' || :PROJECT_NAME);
  END IF;
  -- Reuse PROMOTE for its side effects, then return the refreshed alias.
  CALL PROMOTE(:prev, :TARGET);
  RETURN (
    SELECT OBJECT_CONSTRUCT('projectName', PROJECT_NAME, 'target', TARGET,
      'deploymentId', DEPLOYMENT_ID, 'previousDeploymentId', PREVIOUS_DEPLOYMENT_ID,
      'url', URL, 'updatedAt', TO_VARCHAR(UPDATED_AT))
    FROM ALIASES WHERE PROJECT_NAME = :PROJECT_NAME AND TARGET = :TARGET
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grant execution to the deployer role.
-- ---------------------------------------------------------------------------
GRANT USAGE ON FUNCTION SERVE_BASE() TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT USAGE ON ALL PROCEDURES IN SCHEMA SNOW_DEPLOY.CORE TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT USAGE ON FUTURE PROCEDURES IN SCHEMA SNOW_DEPLOY.CORE TO ROLE SNOW_DEPLOY_DEPLOYER;

SELECT 'snow-deploy procedures installed.' AS STATUS;
