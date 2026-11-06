-- Additive: "Gratuidades por ratio" now free the chaperones' course (Will, 2026-11-06).
-- Versions already in review, approved, sent or superseded keep the old informative rule,
-- so a sent proposal's price and its approval hash never change.
ALTER TABLE "quote_versions" ADD COLUMN "free_course_by_ratio" BOOLEAN NOT NULL DEFAULT true;
UPDATE "quote_versions" SET "free_course_by_ratio" = false WHERE "status" NOT IN ('DRAFT', 'RETURNED');
