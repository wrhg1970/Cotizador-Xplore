-- Google Workspace domains per agency (additive). EE keeps ALLOWED_GOOGLE_DOMAINS from the environment.
ALTER TABLE "agencies" ADD COLUMN "allowed_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
