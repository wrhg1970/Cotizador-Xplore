-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'IN_PERSON', 'OTHER');

-- CreateTable
CREATE TABLE "proposal_deliveries" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "sent_by_id" UUID NOT NULL,
    "recipients" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "sent_on" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_deliveries_version_id_idx" ON "proposal_deliveries"("version_id");

-- AddForeignKey
ALTER TABLE "proposal_deliveries" ADD CONSTRAINT "proposal_deliveries_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_deliveries" ADD CONSTRAINT "proposal_deliveries_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "proposal_deliveries"
  ADD CONSTRAINT "proposal_deliveries_recipients_chk" CHECK (length(trim("recipients")) > 0);
