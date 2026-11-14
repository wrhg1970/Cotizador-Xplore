-- Manual rollback of migration 20261114120000_database_isolation: gives back the default database access.
-- Then: DELETE FROM _prisma_migrations WHERE migration_name = '20261114120000_database_isolation';
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
END $$;
