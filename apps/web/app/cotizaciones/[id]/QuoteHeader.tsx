import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  fmtDate,
  QUOTE_STATUS_LABEL,
  STATUS_LABEL,
  type QuoteDto,
  type TravelRequestDto,
} from '../../lib/types';

const STAGES = [
  { title: 'Solicitada', hint: 'Ficha y especificaciones del colegio' },
  { title: 'Cotizada', hint: 'Hoja EE y opciones financieras' },
  { title: 'Aprobada', hint: 'Autorizada para enviar al colegio' },
  { title: 'Enviada', hint: 'Propuesta entregada y en seguimiento' },
] as const;

/** Index of the stage the version is in: drafts are being quoted, review waits on approval. */
const stageOf = (s: QuoteDto['status']) => (s === 'SENT' ? 3 : s === 'APPROVED' || s === 'IN_REVIEW' ? 2 : 1);

export type Role = 'quoter' | 'admin' | 'approver' | 'viewer';
const ROLE_TEXT: Record<Role, string> = {
  quoter: 'Cotizador responsable',
  admin: 'Coordinador de oficina',
  approver: 'Autoriza viajes',
  viewer: 'Consulta',
};

function duty(s: QuoteDto['status'], role: Role): string {
  const works = role === 'quoter' || role === 'admin';
  switch (s) {
    case 'DRAFT':
      return works
        ? 'Completa la hoja EE, revisa los tipos de cambio y envía a autorización.'
        : 'El cotizador está armando esta opción.';
    case 'RETURNED':
      return works
        ? 'Atiende los comentarios de la devolución y vuelve a enviar a autorización.'
        : 'Devuelta al cotizador con comentarios.';
    case 'IN_REVIEW':
      return role === 'approver'
        ? 'Revisa las cifras y autoriza o devuelve con comentarios.'
        : 'Espera la autorización; nadie autoriza su propia cotización.';
    case 'APPROVED':
      return works
        ? 'Genera la propuesta PDF y registra el envío al colegio.'
        : 'Autorizada; falta enviarla al colegio.';
    case 'SENT':
      return works
        ? 'Da seguimiento al colegio y registra en la solicitud si se ganó o se perdió.'
        : 'Enviada al colegio; en seguimiento.';
    default:
      return 'Esta versión fue reemplazada por una más nueva.';
  }
}

/** V2 header: who and what, quick actions, expiry alert, the 4-stage process and the next step. */
export function QuoteHeader({
  q,
  req,
  role,
  optionCount,
  eventCount,
  actions,
  expiredAction,
  nextStep,
  onStage,
}: {
  q: QuoteDto;
  req: TravelRequestDto | null;
  role: Role;
  optionCount: number;
  eventCount: number | null;
  actions: ReactNode;
  /** Button that renews the validity; null when this person can't. */
  expiredAction: ReactNode;
  nextStep: ReactNode;
  onStage: (i: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const open = !['SENT', 'SUPERSEDED'].includes(q.status);
  const expired = open && !!q.validUntil && q.validUntil < today;
  const late = open && !!req?.dueDate && req.dueDate < today;
  const current = stageOf(q.status);

  return (
    <section className="card quote-head" aria-label="Expediente">
      <div className="who">
        {req && (
          <p className="kicker">
            <Link href={`/solicitudes/${req.id}`}>{req.folio}</Link> · Solicitud {STATUS_LABEL[req.status]} ·{' '}
            {req.city}, {req.countryCode} · Entrega límite {fmtDate(req.dueDate)}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0 }}>
            {q.scenarioName} · v{q.number}
          </h1>
          <span className="badge">{QUOTE_STATUS_LABEL[q.status]}</span>
        </div>
        {req && (
          <p className="muted" style={{ margin: '6px 0 0' }}>
            <Link href={`/solicitudes/${req.id}`}>
              <strong>{req.groupName}</strong>
            </Link>
            {req.clientName && ` · ${req.clientName}`} · Solicita: {req.requester.name}
            {req.contactName && ` (colegio: ${req.contactName})`} · Ejecutivo:{' '}
            {req.assignee?.name ?? 'sin asignar'}
          </p>
        )}
      </div>
      <div className="row actions">{actions}</div>
      <p className="muted" style={{ margin: 0 }}>
        {optionCount} {optionCount === 1 ? 'opción' : 'opciones'} en la solicitud
        {eventCount !== null && ` · ${eventCount} eventos en la línea de tiempo`}
      </p>

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

      <p className="muted" style={{ margin: '4px 0 0' }}>
        Proceso comercial en 4 etapas (pulsa una etapa para ir a su sección)
      </p>
      <ol className="process">
        {STAGES.map((s, i) => (
          <li key={s.title} className={i < current ? 'done' : i === current ? 'current' : undefined}>
            <button
              type="button"
              onClick={() => onStage(i)}
              aria-current={i === current ? 'step' : undefined}
            >
              <small>
                Etapa {String(i + 1).padStart(2, '0')}
                {i < current && ' ✓'}
                {i === current && ' · etapa actual'}
              </small>
              <strong>{s.title}</strong>
              <span>{s.hint}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="rolebox act next">
        <p style={{ margin: 0 }}>
          Tu participación: <strong>{ROLE_TEXT[role]}</strong> · Etapa actual:{' '}
          <strong>
            {String(current + 1).padStart(2, '0')}. {STAGES[current]!.title}
          </strong>{' '}
          ({QUOTE_STATUS_LABEL[q.status]})
          <br />
          <strong>Tu responsabilidad en esta etapa:</strong> {duty(q.status, role)}
        </p>
        <div className="row">{nextStep}</div>
      </div>
    </section>
  );
}
