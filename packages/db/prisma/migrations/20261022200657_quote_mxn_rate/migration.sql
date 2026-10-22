-- AlterTable
ALTER TABLE "quote_versions" ADD COLUMN     "mxn_rate" DECIMAL(20,10);

ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_mxn_rate_chk" CHECK ("mxn_rate" > 0);
