-- Multi-agency base (additive). Every existing row goes to Estudiantes Embajadores, whose id is fixed
-- so the API can refer to it; nothing changes for current users. Rollback: prisma/rollback/20261028190000_agencies.sql.
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agencies_code_key" ON "agencies"("code");
INSERT INTO "agencies" ("id", "code", "name", "updated_at")
VALUES ('00000000-0000-4000-8000-0000000000ee', 'EE', 'Estudiantes Embajadores', CURRENT_TIMESTAMP);

-- Offices: codes are unique per agency now.
ALTER TABLE "offices" ADD COLUMN "agency_id" UUID;
UPDATE "offices" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "offices" ALTER COLUMN "agency_id" SET NOT NULL;
DROP INDEX "offices_code_key";
CREATE UNIQUE INDEX "offices_agency_id_code_key" ON "offices"("agency_id", "code");
ALTER TABLE "offices" ADD CONSTRAINT "offices_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "agency_id" UUID;
UPDATE "users" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "users" ALTER COLUMN "agency_id" SET NOT NULL;
CREATE INDEX "users_agency_id_idx" ON "users"("agency_id");
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A user's office roles must stay inside their own agency.
CREATE FUNCTION user_office_roles_same_agency() RETURNS trigger AS $$
BEGIN
  IF (SELECT agency_id FROM users WHERE id = NEW.user_id) IS DISTINCT FROM
     (SELECT agency_id FROM offices WHERE id = NEW.office_id) THEN
    RAISE EXCEPTION 'user and office belong to different agencies';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_office_roles_same_agency
  BEFORE INSERT OR UPDATE ON "user_office_roles"
  FOR EACH ROW EXECUTE FUNCTION user_office_roles_same_agency();

ALTER TABLE "role_policies" ADD COLUMN "agency_id" UUID;
UPDATE "role_policies" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "role_policies" ALTER COLUMN "agency_id" SET NOT NULL;
ALTER TABLE "role_policies" DROP CONSTRAINT "role_policies_pkey";
ALTER TABLE "role_policies" ADD CONSTRAINT "role_policies_pkey" PRIMARY KEY ("agency_id", "role");
ALTER TABLE "role_policies" ADD CONSTRAINT "role_policies_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "official_rates" ADD COLUMN "agency_id" UUID;
UPDATE "official_rates" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "official_rates" ALTER COLUMN "agency_id" SET NOT NULL;
DROP INDEX "official_rates_from_currency_to_currency_created_at_idx";
CREATE INDEX "official_rates_agency_id_from_currency_to_currency_created__idx" ON "official_rates"("agency_id", "from_currency", "to_currency", "created_at");
ALTER TABLE "official_rates" ADD CONSTRAINT "official_rates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "concept_templates" ADD COLUMN "agency_id" UUID;
UPDATE "concept_templates" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "concept_templates" ALTER COLUMN "agency_id" SET NOT NULL;
DROP INDEX "concept_templates_category_label_key";
CREATE UNIQUE INDEX "concept_templates_agency_id_category_label_key" ON "concept_templates"("agency_id", "category", "label");
ALTER TABLE "concept_templates" ADD CONSTRAINT "concept_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "suppliers" ADD COLUMN "agency_id" UUID;
UPDATE "suppliers" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "suppliers" ALTER COLUMN "agency_id" SET NOT NULL;
DROP INDEX "suppliers_name_key";
CREATE UNIQUE INDEX "suppliers_agency_id_name_key" ON "suppliers"("agency_id", "name");
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "app_settings" ADD COLUMN "agency_id" UUID;
UPDATE "app_settings" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "app_settings" ALTER COLUMN "agency_id" SET NOT NULL;
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_pkey";
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("agency_id", "key");
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit log: agency of the entry, from its office or else its actor, unless the API gives it.
ALTER TABLE "audit_logs" ADD COLUMN "agency_id" UUID;
CREATE INDEX "audit_logs_agency_id_created_at_idx" ON "audit_logs"("agency_id", "created_at");

CREATE OR REPLACE FUNCTION audit_logs_set_office() RETURNS trigger AS $$
BEGIN
  IF NEW.office_id IS NULL THEN
    NEW.office_id := audit_logs_office_id(NEW.entity_type, NEW.entity_id, NEW.diff);
  END IF;
  IF NEW.agency_id IS NULL AND NEW.office_id IS NOT NULL THEN
    SELECT agency_id INTO NEW.agency_id FROM offices WHERE id = NEW.office_id;
  END IF;
  IF NEW.agency_id IS NULL AND NEW.actor_user_id IS NOT NULL THEN
    SELECT agency_id INTO NEW.agency_id FROM users WHERE id = NEW.actor_user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One-off backfill: until now everything was EE's. The append-only guard is lifted only for this statement.
ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_no_update_delete;
UPDATE "audit_logs" SET "agency_id" = '00000000-0000-4000-8000-0000000000ee';
ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_no_update_delete;
