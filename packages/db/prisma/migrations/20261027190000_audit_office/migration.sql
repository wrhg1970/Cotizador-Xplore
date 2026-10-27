-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "office_id" UUID;

-- CreateIndex
CREATE INDEX "audit_logs_office_id_created_at_idx" ON "audit_logs"("office_id", "created_at");


-- Office of the audited entity, so office admins and auditors can read their own office's log.
CREATE FUNCTION audit_logs_office_id(entity_type TEXT, entity_id TEXT, diff JSONB) RETURNS UUID AS $$
DECLARE
  id UUID;
BEGIN
  IF entity_id !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN NULL;
  END IF;
  CASE entity_type
    WHEN 'TravelRequest' THEN
      SELECT office_id INTO id FROM travel_requests WHERE travel_requests.id = entity_id::uuid;
    WHEN 'QuoteVersion' THEN
      SELECT r.office_id INTO id FROM quote_versions v
        JOIN quote_scenarios s ON s.id = v.scenario_id
        JOIN travel_requests r ON r.id = s.request_id
        WHERE v.id = entity_id::uuid;
    WHEN 'QuoteTemplate' THEN
      SELECT office_id INTO id FROM quote_templates WHERE quote_templates.id = entity_id::uuid;
    WHEN 'Office' THEN
      id := entity_id::uuid;
    WHEN 'User' THEN
      -- Role grants and revocations carry the office in the diff.
      IF diff ? 'officeId' AND diff->>'officeId' ~ '^[0-9a-fA-F-]{36}$' THEN
        id := (diff->>'officeId')::uuid;
      END IF;
    ELSE
      id := NULL;
  END CASE;
  RETURN id;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION audit_logs_set_office() RETURNS trigger AS $$
BEGIN
  IF NEW.office_id IS NULL THEN
    NEW.office_id := audit_logs_office_id(NEW.entity_type, NEW.entity_id, NEW.diff);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_office
  BEFORE INSERT ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_set_office();

-- One-off backfill of existing rows; the append-only guard is lifted only for this statement.
ALTER TABLE "audit_logs" DISABLE TRIGGER audit_logs_no_update_delete;
UPDATE "audit_logs" SET "office_id" = audit_logs_office_id("entity_type", "entity_id", "diff");
ALTER TABLE "audit_logs" ENABLE TRIGGER audit_logs_no_update_delete;
