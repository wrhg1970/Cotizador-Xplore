-- CreateTable
CREATE TABLE "role_policies" (
    "role" "Role" NOT NULL,
    "all_offices" BOOLEAN NOT NULL DEFAULT false,
    "view_internal_costs" BOOLEAN NOT NULL DEFAULT false,
    "export_internal_xlsx" BOOLEAN NOT NULL DEFAULT false,
    "approval_limit_mxn" DECIMAL(14,2),
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "role_policies_pkey" PRIMARY KEY ("role")
);

-- AddForeignKey
ALTER TABLE "role_policies" ADD CONSTRAINT "role_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "role_policies"
  ADD CONSTRAINT "role_policies_not_system_admin_chk" CHECK ("role" <> 'SYSTEM_ADMIN'),
  ADD CONSTRAINT "role_policies_export_needs_costs_chk" CHECK (NOT "export_internal_xlsx" OR "view_internal_costs"),
  ADD CONSTRAINT "role_policies_limit_chk" CHECK ("approval_limit_mxn" IS NULL OR "approval_limit_mxn" >= 0);

-- Defaults reproduce the fixed rules before Sprint C: the quoting side sees costs, nobody is national, no limits.
INSERT INTO "role_policies" ("role", "all_offices", "view_internal_costs", "export_internal_xlsx", "updated_at") VALUES
  ('ADVISOR', false, false, false, CURRENT_TIMESTAMP),
  ('QUOTER', false, true, true, CURRENT_TIMESTAMP),
  ('APPROVER', false, true, true, CURRENT_TIMESTAMP),
  ('OFFICE_ADMIN', false, true, true, CURRENT_TIMESTAMP),
  ('AUDITOR', false, true, true, CURRENT_TIMESTAMP);
