'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, type QuoteDto, type ScenarioDto } from '../lib/types';

/** The request's approved (or sent) quote, on top of its ficha (Will, 2026-11-10). */
export function ApprovedQuote({
  requestId,
  canExport,
  wonVersionId,
}: {
  requestId: string;
  canExport: boolean;
  /** Set once sold: that version is shown and labelled "vendida". */
  wonVersionId: string | null;
}) {
  const [q, setQ] = useState<QuoteDto | null>(null);

  useEffect(() => {
    void (async () => {
      const items = await api<ScenarioDto[]>(`/requests/${requestId}/scenarios`);
      // Only one scenario can be approved or sent; its newest such version is the one that counts.
      const picked = items
        .flatMap((s) =>
          s.versions.filter((v) => v.status === 'APPROVED' || v.status === 'SENT').map((v) => ({ s, v })),
        )
        .sort(
          (a, b) =>
            Number(b.v.id === wonVersionId) - Number(a.v.id === wonVersionId) || b.v.number - a.v.number,
        )[0];
      if (!picked) return setQ(null);
      setQ(
        picked.s.latest.id === picked.v.id ? picked.s.latest : await api<QuoteDto>(`/quotes/${picked.v.id}`),
      );
    })().catch(() => setQ(null));
  }, [requestId, wonVersionId]);

  if (!q) return null;
  const t = q.totals;
  const cur = q.saleCurrency;
  const sent = q.status === 'SENT';
  const state = q.id === wonVersionId ? 'vendida' : sent ? 'enviada' : null;
  return (
    <section className="card approved-quote" aria-labelledby="cotizacion-aprobada">
      <div>
        <span className="picked-tag">
          ✓ {state === 'vendida' ? 'Propuesta vendida' : `Cotización ${state ?? 'aprobada'}`}
        </span>
        <h2 id="cotizacion-aprobada">
          {q.scenarioName} · v{q.number}
        </h2>
        <p className="muted">
          {q.participants} est. · {q.chaperones} chap. · {q.staff} EE
          {q.validUntil ? ` · Vigente hasta ${fmtDate(q.validUntil)}` : ''}
        </p>
      </div>
      {t && (
        <>
          <div className="price">
            Precio por estudiante
            <strong>
              {t.pricePerParticipant} {cur}
            </strong>
            {t.pricePerParticipantMxn && <>≈ {t.pricePerParticipantMxn} MXN</>}
          </div>
          <div className="group-total" role="group" aria-label="Total del grupo">
            <span className="group-total-label">Total del grupo</span>
            <strong className="group-total-value">
              {t.groupPrice} {cur}
            </strong>
            <span>
              {t.pricePerParticipant} × {q.participants} estudiantes
            </span>
          </div>
        </>
      )}
      <div className="row acts">
        <Link className="button" href={`/cotizaciones/${q.id}/propuesta`}>
          {state ? `Ver propuesta ${state}` : 'Vista previa'}
        </Link>
        <Link className="button secondary" href={`/cotizaciones/${q.id}`}>
          {sent ? 'Abrir cotización' : 'Abrir cotización y enviar al colegio'}
        </Link>
        {/* Plain link: same-origin download carries the session cookie. */}
        {canExport && (
          <a className="button secondary" href={`/api/v1/quotes/${q.id}/export.xlsx`}>
            Excel interno
          </a>
        )}
      </div>
    </section>
  );
}
