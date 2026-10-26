-- CreateTable
CREATE TABLE "concept_templates" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "category" "LineCategory" NOT NULL,
    "internal_only" BOOLEAN NOT NULL DEFAULT false,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "per_trip_day" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "concept_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "concept_templates_category_label_key" ON "concept_templates"("category", "label");


ALTER TABLE "concept_templates"
  ADD CONSTRAINT "concept_templates_label_chk" CHECK (length(trim("label")) > 0);

-- Base concepts of Finance's EE sheet (V2 prototype); reference data, admins edit it in the app.
INSERT INTO "concept_templates" ("id", "label", "category", "internal_only", "is_base", "per_trip_day", "position", "updated_at")
SELECT gen_random_uuid(), t.label, t.category::"LineCategory", t.internal_only, t.is_base, t.per_trip_day, t.position, CURRENT_TIMESTAMP
FROM (VALUES
  ('Precio neto', 'PER_PARTICIPANT', false, true, false, 10),
  ('Transfer', 'PER_PARTICIPANT', false, true, false, 20),
  ('Comidas', 'PER_PARTICIPANT', false, true, false, 30),
  ('Kit EE', 'PER_PARTICIPANT', false, true, false, 40),
  ('Seguro MSI', 'PER_PARTICIPANT', false, true, false, 50),
  ('Promoción', 'PER_PARTICIPANT', false, true, false, 60),
  ('Costo envío de kits', 'PER_PARTICIPANT', true, true, false, 70),
  ('Operación', 'PER_PARTICIPANT', true, true, false, 80),
  ('Otros gastos', 'PER_PARTICIPANT', false, true, false, 90),
  ('Comisión escuela', 'PER_PARTICIPANT', true, true, false, 100),
  ('Comisión coordinadora', 'PER_PARTICIPANT', true, true, false, 110),
  ('Costo chaperón', 'PER_STAFF', false, true, false, 10),
  ('Gastos del viaje', 'PER_STAFF', false, true, false, 20),
  ('Gastos por día', 'PER_STAFF', false, true, true, 30),
  ('Seguro', 'PER_STAFF', false, true, false, 40),
  ('Transfer', 'PER_STAFF', false, true, false, 50),
  ('Kit', 'PER_STAFF', false, true, false, 60),
  ('Costo chaperón', 'PER_CHAPERONE', false, false, false, 10),
  ('Gastos del viaje', 'PER_CHAPERONE', false, false, false, 20),
  ('Gastos por día', 'PER_CHAPERONE', false, false, true, 30),
  ('Seguro', 'PER_CHAPERONE', false, false, false, 40),
  ('Transfer', 'PER_CHAPERONE', false, false, false, 50),
  ('Kit', 'PER_CHAPERONE', false, false, false, 60),
  ('Fondo de emergencia', 'CONTINGENCY', false, true, false, 10),
  ('Chaperón extra', 'PER_GROUP', false, false, false, 10),
  ('Compensación del líder', 'PER_GROUP', false, false, false, 20)
) AS t(label, category, internal_only, is_base, per_trip_day, position);
