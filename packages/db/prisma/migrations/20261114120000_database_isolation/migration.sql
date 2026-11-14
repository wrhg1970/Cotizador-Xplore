-- Staging and production share one Cloud SQL instance, and every built-in Cloud SQL user belongs to
-- cloudsqlsuperuser, which owns databases created with gcloud: each environment's user could open the
-- other environment's database. Each migrate job runs as its own environment's user, so this makes that
-- user the owner and removes the access everyone else had by default. Data is not touched.
DO $$
BEGIN
  BEGIN
    EXECUTE format('ALTER DATABASE %I OWNER TO %I', current_database(), current_user);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'database isolation: could not take ownership of %, see docs/DEPLOYMENT.md, Seguridad', current_database();
  END;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  -- The admin account used from Cloud SQL Studio / Cloud Shell keeps access.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') AND current_user <> 'postgres' THEN
    EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO postgres', current_database());
  END IF;
END $$;
