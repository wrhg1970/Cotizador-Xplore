-- CreateTable
CREATE TABLE "proposal_shares" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_view_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proposal_shares_token_hash_key" ON "proposal_shares"("token_hash");

-- CreateIndex
CREATE INDEX "proposal_shares_version_id_idx" ON "proposal_shares"("version_id");

-- AddForeignKey
ALTER TABLE "proposal_shares" ADD CONSTRAINT "proposal_shares_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_shares" ADD CONSTRAINT "proposal_shares_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

