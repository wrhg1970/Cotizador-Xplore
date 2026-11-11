-- Additive: optional plane ticket ("Avión") per quote version (Will, 2026-11-11).
ALTER TABLE "quote_versions" ADD COLUMN "flight" JSONB;
