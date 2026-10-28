-- Approvals given by an Administración rule (auto-authorization) have no human reviewer; the comment names the rule.
ALTER TABLE "quote_reviews" ALTER COLUMN "reviewer_id" DROP NOT NULL;
