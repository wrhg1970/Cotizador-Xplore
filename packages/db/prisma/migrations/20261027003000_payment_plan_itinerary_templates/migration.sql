-- CreateEnum
CREATE TYPE "FreePlaceBenefit" AS ENUM ('CHAPERONE', 'STUDENT');

-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "free_place_benefit" "FreePlaceBenefit",
ADD COLUMN     "itinerary" JSONB,
ADD COLUMN     "payment_plan" JSONB,
ADD COLUMN     "students_per_free_place" INTEGER;

-- CreateTable
CREATE TABLE "quote_templates" (
    "id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sale_currency" CHAR(3) NOT NULL,
    "target_margin_rate" DECIMAL(7,6) NOT NULL,
    "lines" JSONB NOT NULL,
    "students_per_free_place" INTEGER,
    "free_place_benefit" "FreePlaceBenefit",
    "itinerary" JSONB,
    "exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assumptions" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_templates_office_id_active_idx" ON "quote_templates"("office_id", "active");

-- AddForeignKey
ALTER TABLE "quote_templates" ADD CONSTRAINT "quote_templates_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "offices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_templates" ADD CONSTRAINT "quote_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_free_place_chk" CHECK ("students_per_free_place" IS NULL OR "students_per_free_place" BETWEEN 1 AND 100);

ALTER TABLE "quote_templates"
  ADD CONSTRAINT "quote_templates_name_chk" CHECK (length(trim("name")) > 0);
