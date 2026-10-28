'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';
import type { RequestStatus } from '@ee/contracts';
import { fmtDate, STATUS_LABEL } from '../lib/types';
import { useMe } from '../lib/useMe';

type TaskKind = 'SUBMIT_REQUEST' | 'ASSIGN' | 'QUOTE' | 'FIX_QUOTE' | 'APPROVE' | 'SEND' | 'RECORD_OUTCOME';

interface Dashboard {
  tasks: {
    kind: TaskKind;
    requestId: string;
    folio: string;
    groupName: string;
    officeCode: string;
    dueDate: string | null;
    departureDate: string;
    quoteId: string | null;
    quoteLabel: string | null;
  }[];
  offices: { id: string; code: string; name: string; byStatus: Partial<Record<RequestStatus, number>> }[];
}

const TASK_LABEL: Record<TaskKind, string> = {
  SUBMIT_REQUEST: 'Enviar a cotización',
  ASSIGN: 'Asignar cotizador',
  QUOTE: 'Cotizar',
  FIX_QUOTE: 'Corregir cotización devuelta',
  APPROVE: 'Autorizar cotización',
  SEND: 'Enviar propuesta al cliente',
  RECORD_OUTCOME: 'Registrar respuesta del cliente',
};

// Pipeline order of the EE process; closed states go last.
const STATUSES: RequestStatus[] = ['DRAFT', 'SUBMITTED', 'QUOTING', 'SENT', 'WON', 'LOST', 'CANCELLED'];

/** Won ÷ (won + lost): only proposals the client already answered count. */
const conversion = (s: Partial<Record<RequestStatus, number>>) => {
  const won = s.WON ?? 0;
  const answered = won + (s.LOST ?? 0);
  return answered ? `${Math.round((won / answered) * 100)}%` : '—';
};

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
};

export default function DashboardPage() {
  const me = useMe();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Dashboard>('/dashboard').then(setData, (e) => setError(errorText(e)));
  }, []);

  return (
    <>
      <div className="row greeting" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{me ? `${greeting()}, ${me.name.split(' ')[0]}.` : 'Mi trabajo'}</h1>
          {data && (
            <p>
              {data.tasks.length === 0 ? (
                'No tienes pendientes por ahora.'
              ) : (
                <>
                  Tienes{' '}
                  <strong>
                    {data.tasks.length === 1 ? '1 pendiente' : `${data.tasks.length} pendientes`}
                  </strong>{' '}
                  en tus solicitudes.
                </>
              )}
            </p>
          )}
        </div>
        <Link className="button" href="/solicitudes/nueva">
          Nueva solicitud
        </Link>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <section className="card" aria-labelledby="pendientes" style={{ marginBottom: 16 }}>
            <h2 id="pendientes" style={{ marginTop: 0 }}>
              Te toca ({data.tasks.length})
            </h2>
            {data.tasks.length === 0 ? (
              <p className="muted">No tienes pendientes.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Qué hacer</th>
                      <th>Folio</th>
                      <th>Grupo</th>
                      <th>Oficina</th>
                      <th>Fecha límite</th>
                      <th>Salida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks.map((t) => (
                      <tr key={`${t.kind}-${t.quoteId ?? t.requestId}`}>
                        <td>
                          <Link
                            href={t.quoteId ? `/cotizaciones/${t.quoteId}` : `/solicitudes/${t.requestId}`}
                          >
                            {TASK_LABEL[t.kind]}
                          </Link>
                          {t.quoteLabel && <span className="muted"> · {t.quoteLabel}</span>}
                        </td>
                        <td>{t.folio}</td>
                        <td>{t.groupName}</td>
                        <td>{t.officeCode}</td>
                        <td>{fmtDate(t.dueDate)}</td>
                        <td>{fmtDate(t.departureDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="card" aria-labelledby="oficinas">
            <h2 id="oficinas" style={{ marginTop: 0 }}>
              Solicitudes por oficina
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Oficina</th>
                    {STATUSES.map((s) => (
                      <th key={s} className="num">
                        {STATUS_LABEL[s]}
                      </th>
                    ))}
                    <th className="num">Conversión</th>
                  </tr>
                </thead>
                <tbody>
                  {data.offices.map((o) => (
                    <tr key={o.id}>
                      <th scope="row">
                        {o.code} · {o.name}
                      </th>
                      {STATUSES.map((s) => (
                        <td key={s} className="num">
                          {o.byStatus[s] ? (
                            <Link href={`/solicitudes?status=${s}&officeId=${o.id}`}>{o.byStatus[s]}</Link>
                          ) : (
                            0
                          )}
                        </td>
                      ))}
                      <td className="num">{conversion(o.byStatus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
