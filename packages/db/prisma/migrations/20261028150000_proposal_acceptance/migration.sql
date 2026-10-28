-- School's online acceptance through the shared link: who signed, when and from where.
CREATE TABLE "proposal_acceptances" (
    "id" UUID NOT NULL,
    "share_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "signer_name" TEXT NOT NULL,
    "signer_role" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "proposal_acceptances_version_id_key" ON "proposal_acceptances"("version_id");

ALTER TABLE "proposal_acceptances" ADD CONSTRAINT "proposal_acceptances_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES "proposal_shares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "proposal_acceptances" ADD CONSTRAINT "proposal_acceptances_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "quote_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidence of the client's signature: append-only, like the audit log.
CREATE FUNCTION proposal_acceptances_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'proposal_acceptances is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER proposal_acceptances_no_change BEFORE UPDATE OR DELETE ON "proposal_acceptances"
  FOR EACH ROW EXECUTE FUNCTION proposal_acceptances_append_only();
