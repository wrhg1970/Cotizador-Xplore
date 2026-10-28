'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from '../../../lib/api';
import { type Proposal, ProposalView } from './ProposalView';

/** Client-facing proposal, safe to share (no costs). Unauthorized versions carry the pending legend. */
export default function ProposalPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Proposal>(`/quotes/${id}/proposal`).then(setP, (e) => setError(errorText(e)));
  }, [id]);

  if (!p) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;
  return (
    <ProposalView
      p={p}
      coverSrc={`/api/v1/quotes/${id}/proposal/cover`}
      actions={<Link href={`/solicitudes/${p.request.id}`}>← Volver a la solicitud</Link>}
    />
  );
}
