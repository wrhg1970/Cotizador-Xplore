-- AlterTable
ALTER TABLE "travel_requests" ADD COLUMN     "specifications" JSONB;

-- CreateTable
CREATE TABLE "official_rates" (
    "id" UUID NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "rate_date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "captured_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "official_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "official_rates_from_currency_to_currency_created_at_idx" ON "official_rates"("from_currency", "to_currency", "created_at");

-- AddForeignKey
ALTER TABLE "official_rates" ADD CONSTRAINT "official_rates_captured_by_id_fkey" FOREIGN KEY ("captured_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Official rates are a history: a new rate is a new row, never an edit.
ALTER TABLE "official_rates"
  ADD CONSTRAINT "official_rates_rate_chk" CHECK ("rate" > 0),
  ADD CONSTRAINT "official_rates_pair_chk" CHECK ("from_currency" <> "to_currency");
CREATE FUNCTION official_rates_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'official_rates is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER official_rates_no_update_delete
  BEFORE UPDATE OR DELETE ON "official_rates"
  FOR EACH ROW EXECUTE FUNCTION official_rates_append_only();
