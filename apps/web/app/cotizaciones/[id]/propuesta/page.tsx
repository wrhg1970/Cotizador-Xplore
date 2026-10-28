'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from '../../../lib/api';
import { Logo } from '../../../Logo';
import { PaymentSchedule } from '../ProposalContent';
import {
  fmtDate,
  FREE_PLACE_LABEL,
  type ItineraryDayDto,
  type PaymentDto,
  PENDING_LEGEND,
} from '../../../lib/types';

interface Proposal {
  id: string;
  number: number;
  scenarioName: string;
  authorized: boolean;
  request: {
    id: string;
    folio: string;
    groupName: string;
    city: string;
    countryCode: string;
    departureDate: string;
    returnDate: string;
  };
  participants: number;
  chaperones: number;
  saleCurrency: string;
  pricePerParticipant: string | null;
  pricePerParticipantMxn: string | null;
  validUntil: string | null;
  assumptions: string | null;
  includes: string[];
  paymentSchedule: PaymentDto[] | null;
  freePlaces: { count: number; benefit: keyof typeof FREE_PLACE_LABEL } | null;
  itinerary: ItineraryDayDto[];
  exclusions: string[];
}

/** Client-facing proposal, safe to share (no costs). Unauthorized versions carry the pending legend. */
export default function ProposalPage() {
  const { id } = useParams<{ id: string }>();
  const [p, setP] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Proposal>(`/quotes/${id}/proposal`).then(setP, (e) => setError(errorText(e)));
  }, [id]);

  if (!p) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;
  const legend = !p.authorized && <p className="legend">{PENDING_LEGEND}</p>;

  return (
    <article className="proposal">
      <p className="no-print row">
        <Link href={`/solicitudes/${p.request.id}`}>← Volver a la solicitud</Link>
        <button onClick={() => window.print()}>Imprimir o guardar PDF</button>
      </p>
      {legend}
      <span className="brand">
        <Logo height={72} />
      </span>
      <p className="kicker">Propuesta de viaje</p>
      <h1>{p.request.groupName}</h1>
      <p className="muted">
        {p.request.folio} · {p.scenarioName} · versión {p.number}
      </p>
      <p>
        <span className="price">
          {p.pricePerParticipant ? `${p.pricePerParticipant} ${p.saleCurrency}` : 'Por definir'}
        </span>{' '}
        <span className="muted">
          por estudiante
          {p.pricePerParticipantMxn && ` · aprox. ${p.pricePerParticipantMxn} MXN`}
        </span>
      </p>
      <dl className="facts">
        <dt>Destino</dt>
        <dd>
          {p.request.city}, {p.request.countryCode}
        </dd>
        <dt>Fechas</dt>
        <dd>
          {fmtDate(p.request.departureDate)} – {fmtDate(p.request.returnDate)}
        </dd>
        <dt>Grupo</dt>
        <dd>
          {p.participants} estudiantes
          {p.chaperones ? ` · ${p.chaperones} chaperones de la escuela` : ''}
        </dd>
        {!!p.freePlaces?.count && (
          <>
            <dt>Lugares liberados</dt>
            <dd>
              {p.freePlaces.count} ({FREE_PLACE_LABEL[p.freePlaces.benefit]})
            </dd>
          </>
        )}
        <dt>Vigencia</dt>
        <dd>{fmtDate(p.validUntil)}</dd>
      </dl>
      {p.paymentSchedule && (
        <>
          <h2>Plan de pagos por estudiante</h2>
          <PaymentSchedule q={{ paymentSchedule: p.paymentSchedule, saleCurrency: p.saleCurrency }} />
        </>
      )}
      {p.itinerary.length > 0 && (
        <>
          <h2>Itinerario</h2>
          <ol className="timeline">
            {p.itinerary.map((d, i) => (
              <li key={i}>
                <strong>
                  Día {d.day}: {d.title}
                </strong>
                {d.details && <p style={{ margin: '4px 0 0' }}>{d.details}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
      {p.includes.length > 0 && (
        <>
          <h2>Incluye</h2>
          <ul>
            {p.includes.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </>
      )}
      {p.exclusions.length > 0 && (
        <>
          <h2>No incluye</h2>
          <ul>
            {p.exclusions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </>
      )}
      {p.assumptions && (
        <>
          <h2>Condiciones</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.assumptions}</p>
        </>
      )}
      {legend}
    </article>
  );
}
