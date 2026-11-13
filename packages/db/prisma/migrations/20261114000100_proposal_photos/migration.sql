-- Additive: up to 5 destination photos per proposal and the stock photo credit (Will, 2026-11-13).
-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "photo_ids" UUID[] DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "request_attachments" ADD COLUMN     "credit" TEXT;

