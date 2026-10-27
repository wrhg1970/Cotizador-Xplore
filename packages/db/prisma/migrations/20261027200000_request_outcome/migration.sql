-- AlterTable
ALTER TABLE "travel_requests" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "lost_reason" TEXT,
ADD COLUMN     "won_version_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "travel_requests_won_version_id_key" ON "travel_requests"("won_version_id");

-- AddForeignKey
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_won_version_id_fkey" FOREIGN KEY ("won_version_id") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Outcome invariants (PRD F-06): a won request names its winning version; a lost one says why.
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_won_has_version"
  CHECK (("status" = 'WON') = ("won_version_id" IS NOT NULL));
ALTER TABLE "travel_requests" ADD CONSTRAINT "travel_requests_lost_has_reason"
  CHECK ("status" <> 'LOST' OR "lost_reason" IS NOT NULL);
