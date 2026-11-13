-- Additive: agency catalog of Incluye / No incluye phrases and the Incluye lines picked per version/template (Will, 2026-11-13).
-- AlterTable
ALTER TABLE "quote_templates" ADD COLUMN     "extra_includes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "extra_includes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "proposal_items" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposal_items_agency_id_excluded_label_key" ON "proposal_items"("agency_id", "excluded", "label");

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Starter "No incluye" phrases for every agency (not ticked by default; admins edit or retire them).
INSERT INTO "proposal_items" ("id", "agency_id", "label", "excluded", "position", "updated_at")
SELECT gen_random_uuid(), a."id", v.label, true, v.pos, CURRENT_TIMESTAMP
FROM "agencies" a
CROSS JOIN (VALUES ('Vuelos internacionales', 1), ('Trámite de visa o permiso de viaje', 2),
  ('Gastos personales', 3), ('Propinas', 4), ('Comidas no indicadas en el itinerario', 5)) AS v(label, pos)
ON CONFLICT DO NOTHING;
