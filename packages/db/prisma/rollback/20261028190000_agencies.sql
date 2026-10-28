-- Manual rollback of migration 20261028190000_agencies, only while a single agency (EE) exists.
-- Run in one transaction, then: DELETE FROM _prisma_migrations WHERE migration_name = '20261028190000_agencies';
-- and deploy the previous image. Data created meanwhile is kept (it all belongs to EE).
BEGIN;
DO $$ BEGIN
  IF (SELECT count(*) FROM agencies) > 1 THEN RAISE EXCEPTION 'more than one agency: rollback would mix their data'; END IF;
END $$;

ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_no_update_delete;
ALTER TABLE "audit_logs" DROP COLUMN "agency_id";
ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_no_update_delete;
CREATE OR REPLACE FUNCTION audit_logs_set_office() RETURNS trigger AS $$
BEGIN
  IF NEW.office_id IS NULL THEN
    NEW.office_id := audit_logs_office_id(NEW.entity_type, NEW.entity_id, NEW.diff);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_pkey";
ALTER TABLE "app_settings" DROP COLUMN "agency_id";
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");

ALTER TABLE "suppliers" DROP COLUMN "agency_id";
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");

ALTER TABLE "concept_templates" DROP COLUMN "agency_id";
CREATE UNIQUE INDEX "concept_templates_category_label_key" ON "concept_templates"("category", "label");

ALTER TABLE "official_rates" DROP COLUMN "agency_id";
CREATE INDEX "official_rates_from_currency_to_currency_created_at_idx" ON "official_rates"("from_currency", "to_currency", "created_at");

ALTER TABLE "role_policies" DROP CONSTRAINT "role_policies_pkey";
ALTER TABLE "role_policies" DROP COLUMN "agency_id";
ALTER TABLE "role_policies" ADD CONSTRAINT "role_policies_pkey" PRIMARY KEY ("role");

DROP TRIGGER user_office_roles_same_agency ON "user_office_roles";
DROP FUNCTION user_office_roles_same_agency();
ALTER TABLE "users" DROP COLUMN "agency_id";
ALTER TABLE "offices" DROP COLUMN "agency_id";
CREATE UNIQUE INDEX "offices_code_key" ON "offices"("code");
DROP TABLE "agencies";
COMMIT;
