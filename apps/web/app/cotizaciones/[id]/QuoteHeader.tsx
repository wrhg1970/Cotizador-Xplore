import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtDate, QUOTE_STATUS_LABEL, type QuoteDto, type TravelRequestDto } from '../../lib/types';

const STAGES = ['Solicitada', 'Cotizada', 'Aprobada', 'Enviada'] as const;

/** Index of the stage the version is in: drafts are being quoted, review waits on approval. */
const stageOf = (s: QuoteDto['status']) => (s === 'SENT' ? 3 : s === 'APPROVED' || s === 'IN_REVIEW' ? 2 : 1);

/** Header in three lines like the request's ficha (Will, 2026-11-25): title, summary, stepper, then authorization. */
export function QuoteHeader({
  q,
  req,
  authStrip,
  expiredAction,
}: {
  q: QuoteDto;
  req: TravelRequestDto | null;
  /** Authorization state, last step and the person's buttons, kept on top. */
  authStrip: ReactNode;
  /** Button that renews the validity; null when this person can't. */
  expiredAction: ReactNode;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const open = !['SENT', 'SUPERSEDED'].includes(q.status);
  const expired = open && !!q.validUntil && q.validUntil < today;
  const late = open && !!req?.dueDate && req.dueDate < today;
  const current = stageOf(q.status);

  return (
    <section className="card quote-head" aria-label="Expediente">
      <div>
        <div className="row" style={{ gap: 10 }}>
          <h1 style={{ margin: 0 }}>
            {req && (
              <>
                <Link href={`/solicitudes/${req.id}`}>{req.folio}</Link> ·{' '}
              </>
            )}
            {q.scenarioName} · v{q.number}
          </h1>
          <span className="badge">{QUOTE_STATUS_LABEL[q.status]}</span>
        </div>
        {req && (
          <p className="muted ficha-sum">
            <span>
              <Link href={`/solicitudes/${req.id}`}>
                <b>{req.groupName}</b>
              </Link>
            </span>
            <span>
              {req.city}, {req.countryCode}
            </span>
            {req.clientName && <span>{req.clientName}</span>}
            {req.contactName && <span>Contacto: {req.contactName}</span>}
            <span>
              Cotiza: <b>{req.assignee?.name ?? 'sin asignar'}</b>
            </span>
            <span>Solicita: {req.requester.name}</span>
            <span>
              Entrega: <b>{fmtDate(req.dueDate)}</b>
            </span>
            {q.validUntil && <span>Vigencia: {fmtDate(q.validUntil)}</span>}
          </p>
        )}
        <ol className="stepper" aria-label="Avance de la cotización">
          {STAGES.map((name, i) => (
            <li
              key={name}
              className={i < current ? 'done' : i === current ? 'current' : undefined}
              aria-current={i === current ? 'step' : undefined}
            >
              {i < current ? '✓ ' : ''}
              {name}
            </li>
          ))}
        </ol>
      </div>

      {(expired || late) && (
        <div className="sla" role="alert">
          <p>
            {expired && (
              <>
                <strong>Cotización vencida:</strong> la vigencia ({fmtDate(q.validUntil)}) ya pasó. Renueva la
                vigencia y actualiza los tipos de cambio antes de enviarla al colegio.{' '}
              </>
            )}
            {late && (
              <>
                <strong>Entrega atrasada:</strong> la fecha límite de la solicitud ({fmtDate(req!.dueDate)})
                ya pasó.
              </>
            )}
          </p>
          {expired && expiredAction}
        </div>
      )}

      {authStrip}
    </section>
  );
}
