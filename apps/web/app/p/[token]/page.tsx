'use client';

import { useParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { fmtDateTime } from '../../lib/types';
import { type Proposal, ProposalView } from '../../cotizaciones/[id]/propuesta/ProposalView';

type Shared = Proposal & {
  expiresAt: string;
  canAccept: boolean;
  acceptance: { signerName: string; signerRole: string; acceptedAt: string } | null;
};

/** What the school opens from the shared link: no account, no costs, no internal ids. */
export default function PublicProposalPage() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = useState<Shared | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Shared>(`/public/proposals/${encodeURIComponent(token)}`).then(setP, (e) => setError(errorText(e)));
  }, [token, sent]);

  async function accept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const r = await api<{ acceptedAt: string }>(`/public/proposals/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: {
          signerName: String(f.get('signerName')).trim(),
          signerRole: String(f.get('signerRole')).trim(),
          accepted: f.get('accepted') === 'on',
        },
      });
      setSent(r.acceptedAt);
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!p)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Cargando…</p>
    );
  return (
    <>
      <ProposalView
        p={p}
        coverSrc={`/api/v1/public/proposals/${encodeURIComponent(token)}/cover`}
        actions={<span className="muted">Liga vigente hasta {fmtDateTime(p.expiresAt)}</span>}
      />
      <section className="proposal-accept no-print" aria-labelledby="aceptar">
        {p.acceptance ? (
          <p className="card" role="status">
            Propuesta aceptada por {p.acceptance.signerName} ({p.acceptance.signerRole}) el{' '}
            {fmtDateTime(p.acceptance.acceptedAt)}. ¡Gracias! Tu ejecutivo te contactará para los siguientes
            pasos.
          </p>
        ) : p.canAccept ? (
          <form onSubmit={accept} className="card">
            <h2 id="aceptar">Aceptar la propuesta</h2>
            <label>
              Nombre completo
              <input name="signerName" required maxLength={150} autoComplete="name" />
            </label>
            <label>
              Cargo en el colegio
              <input name="signerRole" required maxLength={150} autoComplete="organization-title" />
            </label>
            <label className="inline">
              <input type="checkbox" name="accepted" required /> Acepto esta propuesta en nombre del colegio
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button>Aceptar propuesta</button>
          </form>
        ) : null}
      </section>
    </>
  );
}
