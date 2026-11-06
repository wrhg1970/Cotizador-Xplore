-- Archive, then purge for good (Will, 2026-11-05). Additive column.
ALTER TABLE "travel_requests" ADD COLUMN "archived_at" TIMESTAMPTZ(3);

-- Evidence tables stay append-only, except a DELETE inside the purge transaction (SET LOCAL ee.purge = 'on').
CREATE OR REPLACE FUNCTION quote_reviews_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ee.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'quote_reviews is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION proposal_acceptances_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ee.purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'proposal_acceptances is append-only';
END;
$$ LANGUAGE plpgsql;
