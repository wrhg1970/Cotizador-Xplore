-- Official rates fetched by the daily Banxico job have no human author; source says who.
ALTER TABLE "official_rates" ALTER COLUMN "captured_by_id" DROP NOT NULL;
