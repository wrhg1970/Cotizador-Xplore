-- CreateEnum
CREATE TYPE "QuoteVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RETURNED', 'APPROVED', 'SENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "LineCategory" AS ENUM ('PER_PARTICIPANT', 'PER_CHAPERONE', 'PER_STAFF', 'PER_GROUP', 'CONTINGENCY');

-- CreateTable
CREATE TABLE "quote_scenarios" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_versions" (
    "id" UUID NOT NULL,
    "scenario_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "QuoteVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "sale_currency" CHAR(3) NOT NULL,
    "target_margin_rate" DECIMAL(7,6) NOT NULL DEFAULT 0,
    "participants" INTEGER NOT NULL,
    "chaperones" INTEGER NOT NULL,
    "staff" INTEGER NOT NULL,
    "valid_until" DATE,
    "assumptions" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "category" "LineCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "internal_only" BOOLEAN NOT NULL DEFAULT false,
    "cost_source" TEXT,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_fx_rates" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "rate_date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "captured_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_scenarios_request_id_idx" ON "quote_scenarios"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_versions_scenario_id_number_key" ON "quote_versions"("scenario_id", "number");

-- CreateIndex
CREATE INDEX "quote_lines_version_id_position_idx" ON "quote_lines"("version_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "quote_fx_rates_version_id_from_currency_key" ON "quote_fx_rates"("version_id", "from_currency");

-- AddForeignKey
ALTER TABLE "quote_scenarios" ADD CONSTRAINT "quote_scenarios_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "travel_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_scenarios" ADD CONSTRAINT "quote_scenarios_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "quote_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_fx_rates" ADD CONSTRAINT "quote_fx_rates_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_fx_rates" ADD CONSTRAINT "quote_fx_rates_captured_by_id_fkey" FOREIGN KEY ("captured_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants enforced in the database too.
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_counts_chk" CHECK ("participants" >= 1 AND "chaperones" >= 0 AND "staff" >= 0),
  ADD CONSTRAINT "quote_versions_number_chk" CHECK ("number" >= 1),
  ADD CONSTRAINT "quote_versions_margin_chk" CHECK ("target_margin_rate" >= 0 AND "target_margin_rate" < 1);
ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_amounts_chk" CHECK ("quantity" >= 0 AND "unit_cost" >= 0);
ALTER TABLE "quote_fx_rates"
  ADD CONSTRAINT "quote_fx_rates_rate_chk" CHECK ("rate" > 0),
  ADD CONSTRAINT "quote_fx_rates_pair_chk" CHECK ("from_currency" <> "to_currency");
