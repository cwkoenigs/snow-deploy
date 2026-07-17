/* =============================================================================
   snow-deploy · per-app access control
   -----------------------------------------------------------------------------
   Who may view which deployed app. Enforcement happens in the serving
   container: SPCS ingress authenticates every request against Snowflake and
   injects the username as the `Sf-Context-Current-User` header; nginx asks the
   auth sidecar, which checks that user against the policy for the app's slug.

   Policy model (kept deliberately simple):
     - no rows for a project  → any *authenticated* Snowflake user may view it
     - one or more rows       → only the listed usernames may view it
     - a row with PRINCIPAL '*' → explicitly open to all authenticated users

   Policies are compiled to a single JSON file in the artifact stage
   (`@ARTIFACTS/_meta/access.json`), so the serving container picks up changes
   through the same stage mount it serves apps from — no DB connection needed.

   Run after 02_procedures.sql.
   ============================================================================= */

USE DATABASE SNOW_DEPLOY;
USE SCHEMA CORE;

CREATE TABLE IF NOT EXISTS APP_ACCESS (
  PROJECT_NAME STRING NOT NULL,
  PRINCIPAL    STRING NOT NULL,           -- Snowflake username (or '*')
  GRANTED_BY   STRING,
  GRANTED_AT   TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
  CONSTRAINT PK_APP_ACCESS PRIMARY KEY (PROJECT_NAME, PRINCIPAL)
);

-- ---------------------------------------------------------------------------
-- PUBLISH_ACCESS — compile APP_ACCESS into @ARTIFACTS/_meta/access.json,
-- keyed by project slug (what the serving tier sees in URLs):
--   { "billing-app": ["ALICE","BOB"], "phi-console": ["CAROL"] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE PUBLISH_ACCESS()
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
BEGIN
  COPY INTO @ARTIFACTS/_meta/access.json
  FROM (
    SELECT COALESCE(OBJECT_AGG(SLUG, PRINCIPALS), OBJECT_CONSTRUCT())
    FROM (
      SELECT p.SLUG AS SLUG, ARRAY_AGG(a.PRINCIPAL) AS PRINCIPALS
      FROM APP_ACCESS a
      JOIN PROJECTS p ON p.NAME = a.PROJECT_NAME
      GROUP BY p.SLUG
    )
  )
  FILE_FORMAT = (TYPE = JSON, COMPRESSION = NONE)
  SINGLE = TRUE
  OVERWRITE = TRUE;

  ALTER STAGE ARTIFACTS REFRESH;
  RETURN OBJECT_CONSTRUCT('published', TRUE);
END;
$$;

-- ---------------------------------------------------------------------------
-- GRANT_ACCESS / REVOKE_ACCESS — manage a project's viewer list and republish.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE GRANT_ACCESS(PROJECT_NAME STRING, PRINCIPAL STRING, GRANTED_BY STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
DECLARE
  found INT;
BEGIN
  SELECT COUNT(*) INTO :found FROM PROJECTS WHERE NAME = :PROJECT_NAME;
  IF (found = 0) THEN
    RETURN OBJECT_CONSTRUCT('error', 'unknown project: ' || :PROJECT_NAME);
  END IF;
  MERGE INTO APP_ACCESS t
    USING (SELECT :PROJECT_NAME AS PN, UPPER(:PRINCIPAL) AS PR) s
    ON t.PROJECT_NAME = s.PN AND t.PRINCIPAL = s.PR
    WHEN NOT MATCHED THEN INSERT (PROJECT_NAME, PRINCIPAL, GRANTED_BY)
      VALUES (s.PN, s.PR, :GRANTED_BY);
  CALL PUBLISH_ACCESS();
  RETURN (
    SELECT OBJECT_CONSTRUCT('project', :PROJECT_NAME,
      'principals', ARRAY_AGG(PRINCIPAL))
    FROM APP_ACCESS WHERE PROJECT_NAME = :PROJECT_NAME
  );
END;
$$;

CREATE OR REPLACE PROCEDURE REVOKE_ACCESS(PROJECT_NAME STRING, PRINCIPAL STRING)
  RETURNS VARIANT
  LANGUAGE SQL
AS
$$
BEGIN
  DELETE FROM APP_ACCESS
    WHERE PROJECT_NAME = :PROJECT_NAME AND PRINCIPAL = UPPER(:PRINCIPAL);
  CALL PUBLISH_ACCESS();
  RETURN (
    SELECT OBJECT_CONSTRUCT('project', :PROJECT_NAME,
      'principals', COALESCE(ARRAY_AGG(PRINCIPAL), ARRAY_CONSTRUCT()))
    FROM APP_ACCESS WHERE PROJECT_NAME = :PROJECT_NAME
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- REMOVE_PROJECT — supersedes the 02_procedures.sql version so deleting a
-- project also drops its access rules and republishes the policy file.
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
  DELETE FROM APP_ACCESS WHERE PROJECT_NAME = :NAME;
  DELETE FROM ALIASES WHERE PROJECT_NAME = :NAME;
  DELETE FROM DEPLOYMENTS WHERE PROJECT_NAME = :NAME;
  DELETE FROM PROJECTS WHERE NAME = :NAME;
  CALL PUBLISH_ACCESS();
  RETURN OBJECT_CONSTRUCT('removed', TRUE, 'project', :NAME);
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE APP_ACCESS TO ROLE SNOW_DEPLOY_DEPLOYER;
GRANT USAGE ON ALL PROCEDURES IN SCHEMA SNOW_DEPLOY.CORE TO ROLE SNOW_DEPLOY_DEPLOYER;

SELECT 'snow-deploy access control installed.' AS STATUS;
