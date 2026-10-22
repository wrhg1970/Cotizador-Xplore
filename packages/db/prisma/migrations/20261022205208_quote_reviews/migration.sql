-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'RETURNED');

-- CreateTable
CREATE TABLE "quote_reviews" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "calculation_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quote_reviews_version_id_created_at_idx" ON "quote_reviews"("version_id", "created_at");

-- AddForeignKey
ALTER TABLE "quote_reviews" ADD CONSTRAINT "quote_reviews_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_reviews" ADD CONSTRAINT "quote_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviews are evidence: no edits, no deletes.
ALTER TABLE "quote_reviews"
  ADD CONSTRAINT "quote_reviews_return_comment_chk" CHECK ("decision" <> 'RETURNED' OR length(trim("comment")) > 0);
CREATE FUNCTION quote_reviews_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'quote_reviews is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER quote_reviews_no_update_delete
  BEFORE UPDATE OR DELETE ON "quote_reviews"
  FOR EACH ROW EXECUTE FUNCTION quote_reviews_append_only();
