'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PENDING_LEGEND } from '../lib/types';

export interface ProposalRow {
  versionId: string;
  scenarioName: string;
  number: number;
  authorized: boolean;
  sent: boolean;
  participants: number;
  saleCurrency: string;
  pricePerParticipant: string | null;
}

/** What advisors see of the quotes: prices to share, never costs (US-095). */
export function Proposals({ requestId }: { requestId: string }) {
  const [rows, setRows] = useState<ProposalRow[]>([]);
  useEffect(() => {
    api<ProposalRow[]>(`/requests/${requestId}/proposals`).then(setRows, () => undefined);
  }, [requestId]);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="propuestas">
      <h2 id="propuestas">Propuestas</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Escenario</th>
              <th>Estudiantes</th>
              <th>Precio / estudiante</th>
              <th>Autorización</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.versionId}>
                <td>
                  <Link href={`/cotizaciones/${p.versionId}/propuesta`}>
                    {p.scenarioName} · v{p.number}
                  </Link>
                </td>
                <td>{p.participants}</td>
                <td>{p.pricePerParticipant ? `${p.pricePerParticipant} ${p.saleCurrency}` : '—'}</td>
                <td>{p.authorized ? 'Autorizado' : <strong className="error">{PENDING_LEGEND}</strong>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
