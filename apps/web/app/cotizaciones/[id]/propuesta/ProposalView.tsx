import type { CSSProperties, ReactNode } from 'react';
import { BrandColors, HEX, Logo } from '../../../Logo';
import { thousands } from '../SheetSummary';
import {
  fmtDate,
  FREE_PLACE_LABEL,
  type ItineraryDayDto,
  type PaymentDto,
  paymentLabel,
  PENDING_LEGEND,
} from '../../../lib/types';

export interface Proposal {
  id?: string;
  number: number;
  scenarioName: string;
  authorized: boolean;
  request: {
    id?: string;
    folio: string;
    groupName: string;
    city: string;
    countryCode: string;
    departureDate: string;
    returnDate: string;
    /** School and the person there who asked for the trip. */
    clientName: string | null;
    contactName: string | null;
  };
  /** Who the school talks to: the request's executive and office. */
  contact: { name: string | null; email: string | null; office: string | null } | null;
  participants: number;
  chaperones: number;
  saleCurrency: string;
  pricePerParticipant: string | null;
  pricePerParticipantMxn: string | null;
  validUntil: string | null;
  assumptions: string | null;
  includes: string[];
  /** Avión quoted apart from the course price (Sumar al curso No), in its own currency. */
  airTicket?: { pricePerParticipant: string; currency: string } | null;
  paymentSchedule: PaymentDto[] | null;
  /** Price per student by group size, when whoever quotes chose to show it. */
  volumePrices?: { participants: number; pricePerParticipant: string }[] | null;
  freePlaces: { count: number; benefit: keyof typeof FREE_PLACE_LABEL } | null;
  itinerary: ItineraryDayDto[];
  /** Public page of the linked WeTravel trip. */
  itineraryUrl?: string | null;
  exclusions: string[];
  hasCover: boolean;
  /** How many photos (0 = cover), served by position; credits of the stock ones. */
  photos?: number;
  photoCredits?: string[];
  /** WeTravel checkout, only on the winning proposal. */
  paymentUrl: string | null;
  /** The agency's brand; null fields fall back to Xplore Together. */
  brand: {
    name: string;
    logoUrl: string | null;
    footer: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  };
}

/** Calendar days of the trip, counting both ends ("25 jun – 2 jul" = 8). */
export const tripDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

const brandColor = (c: string | null) => (c && HEX.test(c) ? c : undefined);

/** Client-facing proposal body, shared by the preview, the PDF (print) and the school's link. */
export function ProposalView({
  p,
  actions,
  coverSrc,
}: {
  p: Proposal;
  actions: ReactNode;
  /** The cover's URL; the other photos sit next to it under photos/{n}. */
  coverSrc: string;
}) {
  const extraPhotos = Array.from({ length: Math.max((p.photos ?? 0) - 1, 0) }, (_, i) =>
    coverSrc.replace(/cover$/, `photos/${i + 1}`),
  );
  const legend = !p.authorized && <p className="legend">{PENDING_LEGEND}</p>;
  const r = p.request;
  const days = tripDays(r.departureDate, r.returnDate);
  const ref = `${r.folio} · ${p.scenarioName} · versión ${p.number}`;
  const colors = {
    '--pv-navy': brandColor(p.brand.primaryColor),
    '--pv-accent': brandColor(p.brand.accentColor),
  } as CSSProperties;
  const payments = p.paymentSchedule?.filter((x) => x.number > 0).length ?? 0;

  return (
    // Unauthorized: readable on screen, never printable or downloadable (the print CSS blanks it).
    <article className={p.authorized ? 'proposal' : 'proposal unauthorized'} style={colors}>
      <BrandColors brand={p.brand} />
      <p className="no-print row">
        {actions}
        {p.authorized ? (
          <button onClick={() => window.print()}>Imprimir o guardar PDF</button>
        ) : (
          <>
            <button disabled>Imprimir o guardar PDF</button>
            <span className="muted">Disponible cuando se apruebe el viaje.</span>
          </>
        )}
      </p>
      {legend}
      <header className="hero">
        {p.hasCover && <img src={coverSrc} alt={`Foto de ${r.city}`} />}
        <div className="hero-text">
          <div className="hero-top">
            <span className="brand">
              <Logo height={52} src={p.brand.logoUrl} alt={p.brand.name} />
            </span>
            <span className="hero-ref">
              Folio {r.folio}
              <br />
              {p.scenarioName} · versión {p.number}
            </span>
          </div>
          <p className="kicker">
            Propuesta de viaje · {r.city}, {r.countryCode}
          </p>
          <h1>{r.groupName}</h1>
          {(r.clientName || r.contactName) && (
            <p className="hero-for">
              Preparada para {r.clientName && <strong>{r.clientName}</strong>}
              {r.clientName && r.contactName && ' · '}
              {r.contactName && `Atención: ${r.contactName}`}
            </p>
          )}
        </div>
      </header>

      <div className="pv-price">
        <div className="pv-price-main">
          <span className="pv-label">Precio por estudiante</span>
          <p className="price">
            {p.pricePerParticipant ? (
              <>
                {thousands(p.pricePerParticipant)} <small>{p.saleCurrency}</small>
              </>
            ) : (
              'Por definir'
            )}
          </p>
          {p.pricePerParticipantMxn && (
            <p className="muted">
              ≈ {thousands(p.pricePerParticipantMxn)} MXN aproximado, al tipo de cambio del día
            </p>
          )}
        </div>
        <div className="pv-price-aside">
          <div>
            <span className="pv-label">Propuesta válida hasta</span>
            <strong>{fmtDate(p.validUntil)}</strong>
          </div>
          {p.airTicket && (
            <div>
              <span className="pv-label">✈ Avión, aparte del precio</span>
              <strong>
                {thousands(p.airTicket.pricePerParticipant)} {p.airTicket.currency} por estudiante
              </strong>
            </div>
          )}
          {!!p.freePlaces?.count && (
            <div>
              <span className="pv-label">Gratuidades por ratio</span>
              <strong>
                {p.freePlaces.count} ({FREE_PLACE_LABEL[p.freePlaces.benefit]})
              </strong>
            </div>
          )}
        </div>
      </div>

      {(extraPhotos.length > 0 || (p.photoCredits?.length ?? 0) > 0) && (
        <figure className="pv-photos">
          {extraPhotos.length > 0 && (
            <div className="pv-photo-strip">
              {extraPhotos.map((src, i) => (
                <img key={src} src={src} alt={`Foto ${i + 2} de ${r.city}`} />
              ))}
            </div>
          )}
          {(p.photoCredits?.length ?? 0) > 0 && (
            <figcaption>
              Fotos: {p.photoCredits!.map((c) => c.replace(/ \/ Pixabay$/, '')).join(', ')} en Pixabay
            </figcaption>
          )}
        </figure>
      )}

      {p.paymentUrl && (
        <p className="pv-pay">
          <a className="button pay" href={p.paymentUrl} target="_blank" rel="noopener noreferrer">
            Pagar en línea
          </a>{' '}
          <span className="muted print-only">{p.paymentUrl}</span>
        </p>
      )}

      <dl className="pv-facts">
        <div>
          <dt>Destino</dt>
          <dd>
            {r.city}, {r.countryCode}
          </dd>
        </div>
        <div>
          <dt>Fechas · {days} días</dt>
          <dd>
            {fmtDate(r.departureDate)} – {fmtDate(r.returnDate)}
          </dd>
        </div>
        <div>
          <dt>Estudiantes</dt>
          <dd>{p.participants}</dd>
        </div>
        <div>
          <dt>Chaperones del colegio</dt>
          <dd>{p.chaperones}</dd>
        </div>
      </dl>

      {(p.includes.length > 0 || p.exclusions.length > 0) && (
        <section>
          <h2>Qué incluye tu viaje</h2>
          <div className="pv-cols">
            {p.includes.length > 0 && (
              <div className="pv-box pv-yes">
                <h3>Incluye</h3>
                <ul>
                  {p.includes.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {p.exclusions.length > 0 && (
              <div className="pv-box pv-no">
                <h3>No incluye</h3>
                <ul>
                  {p.exclusions.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {(p.itinerary.length > 0 || p.itineraryUrl) && (
        <section>
          <h2>Itinerario</h2>
          <ol className="timeline">
            {p.itinerary.map((d, i) => (
              <li key={i}>
                <span className="day" aria-hidden>
                  Día<b>{d.day}</b>
                </span>
                <div>
                  <strong>
                    <span className="sr-only">Día {d.day}: </span>
                    {d.title}
                  </strong>
                  {d.details && <p>{d.details}</p>}
                </div>
              </li>
            ))}
          </ol>
          {p.itineraryUrl && (
            <p>
              <a className="pv-wt" href={p.itineraryUrl} target="_blank" rel="noreferrer">
                Ver itinerario completo en WeTravel ↗
              </a>
            </p>
          )}
        </section>
      )}

      {p.paymentSchedule && (
        <section>
          <h2>Plan de pagos por estudiante</h2>
          <table aria-label="Plan de pagos por estudiante">
            <thead>
              <tr>
                <th>Pago</th>
                <th>Fecha límite</th>
                <th className="num">Monto ({p.saleCurrency})</th>
              </tr>
            </thead>
            <tbody>
              {p.paymentSchedule.map((x) => (
                <tr key={x.number}>
                  <td>{paymentLabel(x, payments)}</td>
                  <td>{fmtDate(x.dueDate)}</td>
                  <td className="num">{thousands(x.amount)}</td>
                </tr>
              ))}
              {p.pricePerParticipant && (
                <tr className="pv-total">
                  <td colSpan={2}>Total por estudiante</td>
                  <td className="num">{thousands(p.pricePerParticipant)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {p.volumePrices && (
        <section>
          <h2>Precio por estudiante según el tamaño del grupo</h2>
          <table aria-label="Precio por tamaño del grupo">
            <thead>
              <tr>
                <th>Estudiantes inscritos</th>
                <th className="num">Precio por estudiante ({p.saleCurrency})</th>
              </tr>
            </thead>
            <tbody>
              {p.volumePrices.map((v, i, all) => (
                <tr key={v.participants}>
                  <td>
                    {i === all.length - 1
                      ? `${v.participants} o más`
                      : `${v.participants} a ${all[i + 1]!.participants - 1}`}
                  </td>
                  <td className="num">{thousands(v.pricePerParticipant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2>Vigencia y condiciones</h2>
        <p className="pv-cond">
          Propuesta válida hasta el {fmtDate(p.validUntil)}.
          {p.pricePerParticipantMxn &&
            ' El monto en pesos es aproximado y se ajusta al tipo de cambio del día de cada pago.'}
          {p.assumptions && (
            <>
              {'\n\n'}
              {p.assumptions}
            </>
          )}
        </p>
      </section>

      {p.contact?.name && (
        <aside className="pv-contact" aria-label="Contacto">
          <span className="pv-label">Tu ejecutivo de viaje</span>
          <strong>
            {p.contact.name}
            {p.contact.office && ` · ${p.contact.office}`}
          </strong>
          {p.contact.email && <a href={`mailto:${p.contact.email}`}>{p.contact.email}</a>}
        </aside>
      )}

      {legend}
      <footer className="pv-footer">
        {p.brand.footer && <span style={{ whiteSpace: 'pre-wrap' }}>{p.brand.footer}</span>}
        <span>{ref}</span>
      </footer>
    </article>
  );
}
