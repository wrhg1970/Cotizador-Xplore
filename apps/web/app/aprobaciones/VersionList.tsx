'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import { CHANNEL_LABEL, fmtDate, fmtDateTime, STATUS_LABEL } from '../lib/types';

interface Row {
  id: string;
  label: string;
  request: {
    id: string;
    folio: string;
    groupName: string;
    status: keyof typeof STATUS_LABEL;
    officeCode: string;
    departureDate: string;
  };
  participants: number;
  price: string | null;
  currency: string;
  preparedBy: string;
  updatedAt: string;
  sentOn: string | null;
  channel: keyof typeof CHANNEL_LABEL | null;
  canApprove: boolean;
}

/** V2 "Aprobaciones" / "Propuestas enviadas": versions across the user's offices, client price only. */
export function VersionList({ status }: { status: 'IN_REVIEW' | 'SENT' }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Row[]>(`/reports/versions?status=${status}`).then(setRows, (e) => setError(errorText(e)));
  }, [status]);

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!rows) return <p className="muted">Cargando…</p>;
  if (!rows.length)
    return (
      <p className="muted">{status === 'IN_REVIEW' ? 'Nada espera autorización.' : 'Aún no hay envíos.'}</p>
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Folio</th>
            <th>Grupo</th>
            <th>Propuesta</th>
            <th>Salida</th>
            <th className="num">Precio por estudiante</th>
            {status === 'IN_REVIEW' ? (
              <>
                <th>Preparó</th>
                <th>En revisión desde</th>
                <th />
              </>
            ) : (
              <>
                <th>Enviada</th>
                <th>Solicitud</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id}>
              <th scope="row">
                <Link href={`/solicitudes/${v.request.id}`}>{v.request.folio}</Link>
              </th>
              <td>
                {v.request.groupName} <span className="muted">· {v.request.officeCode}</span>
              </td>
              <td>
                <Link href={`/cotizaciones/${v.id}`}>{v.label}</Link>
              </td>
              <td>{fmtDate(v.request.departureDate)}</td>
              <td className="num">{v.price ? `${v.price} ${v.currency}` : '—'}</td>
              {status === 'IN_REVIEW' ? (
                <>
                  <td>{v.preparedBy}</td>
                  <td>{fmtDateTime(v.updatedAt)}</td>
                  <td>
                    {v.canApprove && (
                      <Link className="button" href={`/cotizaciones/${v.id}`}>
                        Revisar y autorizar →
                      </Link>
                    )}
                  </td>
                </>
              ) : (
                <>
                  <td>
                    {fmtDate(v.sentOn)}
                    {v.channel && <span className="muted"> · {CHANNEL_LABEL[v.channel]}</span>}
                  </td>
                  <td>
                    <span className="badge">{STATUS_LABEL[v.request.status]}</span>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
