'use client';

import { Fragment, useState } from 'react';
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

type Specs = NonNullable<TravelRequestDto['specifications']>;
const specKeys = (s: Specs | null | undefined) =>
  (Object.keys(SPEC_LABEL) as (keyof typeof SPEC_LABEL)[]).filter((k) => s?.[k]);

function SpecRows({ s }: { s: Specs }) {
  return (
    <dl className="facts">
      {specKeys(s).map((k) => (
        <Fragment key={k}>
          <dt>{SPEC_LABEL[k]}</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{s[k]}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function NoteTexts({ r, Heading }: { r: TravelRequestDto; Heading: 'h2' | 'h3' }) {
  return (
    <>
      {r.requirements && (
        <>
          <Heading>Requerimientos</Heading>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.requirements}</p>
        </>
      )}
      {r.commercialNotes && (
        <>
          <Heading>Comentarios comerciales</Heading>
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.commercialNotes}</p>
        </>
      )}
    </>
  );
}

/** Free-text requirements, commercial notes and trip specifications of the request. */
export function RequestNotes({ r }: { r: TravelRequestDto }) {
  return (
    <>
      <NoteTexts r={r} Heading="h2" />
      {r.specifications && (
        <>
          <h2>Especificaciones del viaje</h2>
          <SpecRows s={r.specifications} />
        </>
      )}
    </>
  );
}

type DataTab = 'datos' | 'specs' | 'notas';
const DATA_LABEL: Record<DataTab, string> = {
  datos: 'Datos',
  specs: 'Especificaciones del viaje',
  notas: 'Requerimientos y notas',
};

/** The request summary split into tabs (Datos / Especificaciones / Notas); empty tabs are left out. */
export function RequestDataTabs({ r }: { r: TravelRequestDto }) {
  const [picked, setPicked] = useState<DataTab>('datos');
  const tabs: DataTab[] = ['datos'];
  if (specKeys(r.specifications).length) tabs.push('specs');
  if (r.requirements || r.commercialNotes) tabs.push('notas');
  const tab = tabs.includes(picked) ? picked : 'datos';
  const panel = (t: DataTab) => ({
    id: `req-panel-${t}`,
    role: 'tabpanel',
    'aria-labelledby': `req-tab-${t}`,
    hidden: tab !== t,
  });
  return (
    <>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Datos de la solicitud" className="tabs">
          {tabs.map((t) => (
            <button
              key={t}
              id={`req-tab-${t}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls={`req-panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setPicked(t)}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!step) return;
                const next = tabs[(tabs.indexOf(t) + step + tabs.length) % tabs.length]!;
                setPicked(next);
                document.getElementById(`req-tab-${next}`)?.focus();
              }}
            >
              {DATA_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      <div {...panel('datos')}>
        <dl className="facts">
          <RequestFactRows r={r} />
        </dl>
      </div>
      {tabs.includes('specs') && r.specifications && (
        <div {...panel('specs')}>
          <SpecRows s={r.specifications} />
        </div>
      )}
      {tabs.includes('notas') && (
        <div {...panel('notas')}>
          <NoteTexts r={r} Heading="h3" />
        </div>
      )}
    </>
  );
}
