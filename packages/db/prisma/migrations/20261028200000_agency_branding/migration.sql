-- Branding per agency (additive; all null = the current Xplore Together look).
ALTER TABLE "agencies"
  ADD COLUMN "brand_name" TEXT,
  ADD COLUMN "primary_color" CHAR(7),
  ADD COLUMN "accent_color" CHAR(7),
  ADD COLUMN "proposal_footer" TEXT,
  ADD COLUMN "mail_from_name" TEXT,
  ADD COLUMN "custom_domain" TEXT,
  ADD COLUMN "logo" BYTEA,
  ADD COLUMN "logo_mime" TEXT,
  ADD COLUMN "logo_updated_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "agencies_custom_domain_key" ON "agencies"("custom_domain");
ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_colors_chk" CHECK (
    ("primary_color" IS NULL OR "primary_color" ~ '^#[0-9a-fA-F]{6}$') AND
    ("accent_color" IS NULL OR "accent_color" ~ '^#[0-9a-fA-F]{6}$')),
  ADD CONSTRAINT "agencies_logo_chk" CHECK (
    ("logo" IS NULL) = ("logo_mime" IS NULL) AND ("logo" IS NULL OR octet_length("logo") <= 524288));
