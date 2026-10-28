-- Additive: opt-in price-per-group-size table on the client's proposal.
ALTER TABLE "quote_versions" ADD COLUMN "show_volume_prices" BOOLEAN NOT NULL DEFAULT false;
