-- Additive: a request file can belong to one proposal's expediente.
ALTER TABLE "request_attachments" ADD COLUMN "version_id" UUID;
ALTER TABLE "request_attachments" ADD CONSTRAINT "request_attachments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "request_attachments_version_id_idx" ON "request_attachments"("version_id");
