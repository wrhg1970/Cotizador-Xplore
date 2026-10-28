-- Destination photo on the client proposal: an image attachment of the same request.
ALTER TABLE "quote_versions" ADD COLUMN "cover_attachment_id" UUID;

ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_cover_attachment_id_fkey" FOREIGN KEY ("cover_attachment_id") REFERENCES "request_attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
