-- AlterTable
ALTER TABLE "travel_requests" ADD COLUMN     "wetravel_link_id" TEXT,
ADD COLUMN     "wetravel_url" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "travel_requests_wetravel_link_id_key" ON "travel_requests"("wetravel_link_id");
