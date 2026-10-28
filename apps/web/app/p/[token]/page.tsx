'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { fmtDateTime } from '../../lib/types';
import { type Proposal, ProposalView } from '../../cotizaciones/[id]/propuesta/ProposalView';

/** What the school opens from the shared link: no account, no costs, no internal ids. */
export default function PublicProposalPage() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = useState<(Proposal & { expiresAt: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Proposal & { expiresAt: string }>(`/public/proposals/${encodeURIComponent(token)}`).then(setP, (e) =>
      setError(errorText(e)),
    );
  }, [token]);

  if (!p)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Cargando…</p>
    );
  return (
    <ProposalView
      p={p}
      actions={<span className="muted">Liga vigente hasta {fmtDateTime(p.expiresAt)}</span>}
    />
  );
}
