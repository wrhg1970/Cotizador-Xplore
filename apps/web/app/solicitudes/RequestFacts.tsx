import { Fragment } from 'react';
import { fmtDate, PRIORITY_LABEL, SPEC_LABEL, type TravelRequestDto } from '../lib/types';

/** What the requester captured when opening the request; rows for a `<dl className="facts">`. */
export function RequestFactRows({ r }: { r: TravelRequestDto }) {
  return (
    <>
      <dt>Oficina</dt>
      <dd>{r.office.name}</dd>
      <dt>Destino</dt>
      <dd>
        {r.city}, {r.countryCode}
      </dd>
      <dt>Fechas</dt>
      <dd>
        {fmtDate(r.departureDate)} – {fmtDate(r.returnDate)}
      </dd>
      <dt>Participantes</dt>
      <dd>
        {r.participants} participantes · {r.chaperones} chaperones · {r.staff} staff
      </dd>
      <dt>Presupuesto</dt>
      <dd>
        {r.budget
          ? `${r.budget.amount} ${r.budget.currency} ${r.budget.basis === 'TOTAL' ? 'total del grupo' : 'por participante'}`
          : 'No indicado'}
      </dd>
      {r.clientName && (
        <>
          <dt>Escuela / cliente</dt>
          <dd>{r.clientName}</dd>
        </>
      )}
      {r.program && (
        <>
          <dt>Programa</dt>
          <dd>{r.program}</dd>
        </>
      )}
      {(r.contactName || r.contactEmail) && (
        <>
          <dt>Contacto en la escuela</dt>
          <dd>{[r.contactName, r.contactEmail].filter(Boolean).join(' · ')}</dd>
        </>
      )}
      <dt>Prioridad</dt>
      <dd>{PRIORITY_LABEL[r.priority]}</dd>
      <dt>Fecha límite</dt>
      <dd>{fmtDate(r.dueDate)}</dd>
    </>
  );
}

/** Free-text requirements, commercial notes and trip specifications of the request. */
export function RequestNotes({ r }: { r: TravelRequestDto }) {
  return (
    <>
      {r.requirements && (
        <>
          <h2>Requerimientos</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.requirements}</p>
        </>
      )}
      {r.commercialNotes && (
        <>
          <h2>Comentarios comerciales</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.commercialNotes}</p>
        </>
      )}
      {r.specifications && (
        <>
          <h2>Especificaciones del viaje</h2>
          <dl className="facts">
            {(Object.keys(SPEC_LABEL) as (keyof typeof SPEC_LABEL)[])
              .filter((k) => r.specifications?.[k])
              .map((k) => (
                <Fragment key={k}>
                  <dt>{SPEC_LABEL[k]}</dt>
                  <dd style={{ whiteSpace: 'pre-wrap' }}>{r.specifications?.[k]}</dd>
                </Fragment>
              ))}
          </dl>
        </>
      )}
    </>
  );
}
