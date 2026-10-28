'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import {
  fmtDateTime,
  QUOTE_STATUS_LABEL,
  type QuoteDto,
  type ScenarioDto,
  type TravelRequestDto,
} from '../../lib/types';
import { useMe } from '../../lib/useMe';
import { amount, rate } from '../format';

type Item = ScenarioDto & { preparedBy: string; policy: string };

const FREQUENCY: Record<string, string> = { MONTHLY: 'mensual', BIWEEKLY: 'quincenal', WEEKLY: 'semanal' };
const REJECTED_PREFIX = 'Rechazada: '; // same marker as the API's quotes controller

/** Effective margin over price, after Finance's rounding; null while FX is missing. */
const marginOf = (v: QuoteDto) =>
  v.totals && Number(v.totals.groupPrice) > 0
    ? Number(v.totals.groupMargin) / Number(v.totals.groupPrice)
    : null;
/** Price per student in MXN when the version has its rate, else in its sale currency. */
const mxnPrice = (v: QuoteDto) =>
  v.saleCurrency === 'MXN' ? v.totals?.pricePerParticipant : v.totals?.pricePerParticipantMxn;
const fx = (v: QuoteDto) =>
  v.saleCurrency !== 'MXN' && v.mxnRate
    ? `${v.mxnRate} (${v.saleCurrency})`
    : v.fxRates.length
      ? v.fxRates.map((f) => `${f.rate} (${f.fromCurrency})`).join(' · ')
      : '—';
const plan = (v: QuoteDto) =>
  v.paymentPlan
    ? `Inscripción + ${v.paymentPlan.installments} pago(s) (${FREQUENCY[v.paymentPlan.frequency]})`
    : 'Sin plan';
const signed = (x: number, fmt: (n: number) => string) =>
  `${x > 0 ? '+' : x < 0 ? '−' : '+'}${fmt(Math.abs(x))}`;

function Delta({ children }: { children: ReactNode }) {
  return <div className="delta">{children}</div>;
}

/** V2 "Dictaminar": committee comparison of a request's options, then approve / ask changes / reject each one. */
export default function DecisionPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [req, setReq] = useState<TravelRequestDto | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(
    () =>
      Promise.all([api<TravelRequestDto>(`/requests/${id}`), api<Item[]>(`/requests/${id}/scenarios`)]).then(
        ([r, s]) => {
          setReq(r);
          setItems(s.filter((x) => x.latest.status !== 'DRAFT'));
        },
        (e) => setError(errorText(e)),
      ),
    [id],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  // Same rule as the server (assertReviewer): office approver who neither quotes nor built it.
  const approver =
    !!req &&
    !!me?.roles.some(
      (r) => r.role === 'SYSTEM_ADMIN' || (r.officeId === req.office.id && r.role === 'APPROVER'),
    ) &&
    me.id !== req.assignee?.id;

  async function decide(v: QuoteDto, kind: 'approve' | 'changes' | 'reject') {
    const ask =
      kind === 'approve'
        ? 'Comentario para el registro (opcional):'
        : kind === 'changes'
          ? '¿Qué cambios necesita? (obligatorio)'
          : 'Motivo del rechazo (obligatorio):';
    const comment = window.prompt(ask)?.trim();
    if (comment === undefined || (kind !== 'approve' && !comment)) return;
    setError(null);
    setNotice(null);
    try {
      await api(`/quotes/${v.id}/${kind === 'approve' ? 'approve' : 'return'}`, {
        method: 'POST',
        body: {
          rowVersion: v.rowVersion,
          ...(comment ? { comment } : {}),
          ...(kind === 'reject' ? { reject: true } : {}),
        },
      });
      setNotice(
        kind === 'approve'
          ? `${v.scenarioName} v${v.number}: firma registrada`
          : `${v.scenarioName} v${v.number} regresó a cotización`,
      );
      await reload();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (error && !items)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!items || !req) return <p className="muted">Cargando…</p>;
  const base = items[0]?.latest;

  return (
    <>
      <p>
        <Link href="/aprobaciones">← Aprobaciones</Link>
      </p>
      <h1>
        Dictamen · {req.folio} · {req.clientName ? `${req.clientName} — ${req.groupName}` : req.groupName}
      </h1>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!base ? (
        <p className="muted">Esta solicitud no tiene opciones enviadas a autorización.</p>
      ) : (
        <>
          <section className="card" aria-labelledby="comparador">
            <h2 id="comparador" style={{ marginTop: 0 }}>
              Comparador de diferencias destacadas (Δ) para comité de aprobación
            </h2>
            <p className="muted">
              Contrasta de un vistazo el aforo, margen, precio final, tipo de cambio y plan de pagos frente a{' '}
              {items[0]!.name}.
            </p>
            <div className="table-wrap">
              <table className="tray">
                <thead>
                  <tr>
                    <th>Opción / escenario</th>
                    <th className="num">Aforo (Δ)</th>
                    <th className="num">TC aplicado</th>
                    <th className="num">Comisión / margen (Δ)</th>
                    <th className="num">Precio / alumno MXN (Δ)</th>
                    <th className="num">Utilidad total grupo</th>
                    <th>Plan de pagos configurado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((s, i) => {
                    const v = s.latest;
                    const m = marginOf(v);
                    const bm = marginOf(base);
                    const p = mxnPrice(v);
                    const bp = mxnPrice(base);
                    const pCur =
                      v.saleCurrency === 'MXN' || v.totals?.pricePerParticipantMxn ? 'MXN' : v.saleCurrency;
                    return (
                      <tr key={s.id}>
                        <th scope="row">
                          {s.name}
                          <div className="muted fine">
                            v{v.number} · {QUOTE_STATUS_LABEL[v.status]}
                          </div>
                        </th>
                        <td className="num">
                          <strong>{v.participants} alum.</strong>
                          {i > 0 && (
                            <Delta>
                              {signed(v.participants - base.participants, String)} vs {items[0]!.name}
                            </Delta>
                          )}
                        </td>
                        <td className="num">{fx(v)}</td>
                        <td className="num ok">
                          {m === null ? '—' : rate(String(m))}
                          {i > 0 && m !== null && bm !== null && (
                            <Delta>{signed((m - bm) * 100, (x) => `${x.toFixed(2)}%`)}</Delta>
                          )}
                        </td>
                        <td className="num strong">
                          {amount(p ?? v.totals?.pricePerParticipant, pCur)}
                          {i > 0 && p && bp && (
                            <Delta>{signed(Number(p) - Number(bp), (x) => amount(String(x), ''))}</Delta>
                          )}
                        </td>
                        <td className="num ok">
                          {v.totals?.groupMarginMxn
                            ? amount(v.totals.groupMarginMxn, 'MXN')
                            : amount(v.totals?.groupMargin, v.saleCurrency)}
                        </td>
                        <td>{plan(v)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {items.map((s) => {
            const v = s.latest;
            const m = marginOf(v);
            return (
              <section key={s.id} className="card decision" aria-label={`${s.name} v${v.number}`}>
                <div className="decision-head">
                  <div>
                    <div className="muted fine">
                      Versión actual: v{v.number} · Elaboró: {s.preparedBy} ({req.office.name}) · Política
                      aplicable: <strong>{s.policy}</strong>
                    </div>
                    <h2>
                      <Link href={`/cotizaciones/${v.id}`}>{s.name}</Link>: {v.participants} participantes +{' '}
                      {v.chaperones} chaperones — Estado:{' '}
                      <span className="state">{QUOTE_STATUS_LABEL[v.status]}</span>
                    </h2>
                    <div className="muted fine">
                      Precio/alumno: {amount(v.totals?.pricePerParticipant, v.saleCurrency)} · Total grupo:{' '}
                      {amount(v.totals?.groupPrice, v.saleCurrency)} · Margen:{' '}
                      {m === null ? '—' : rate(String(m))}
                    </div>
                  </div>
                  {approver && v.status === 'IN_REVIEW' && (
                    <div className="row">
                      <button className="approve" onClick={() => void decide(v, 'approve')}>
                        Aprobar v{v.number}
                      </button>
                      <button className="changes" onClick={() => void decide(v, 'changes')}>
                        Solicitar cambios
                      </button>
                      <button className="danger" onClick={() => void decide(v, 'reject')}>
                        Rechazar
                      </button>
                    </div>
                  )}
                </div>
                <h3>Registro de decisiones de aprobación</h3>
                {v.reviews.length === 0 ? (
                  <p className="muted fine">Sin decisiones todavía.</p>
                ) : (
                  <ol className="decision-log">
                    {v.reviews.map((r) => {
                      const rejected = r.decision === 'RETURNED' && r.comment?.startsWith(REJECTED_PREFIX);
                      const label =
                        r.decision === 'APPROVED' ? 'Aprobar' : rejected ? 'Rechazar' : 'Solicitar cambios';
                      const comment = rejected ? r.comment!.slice(REJECTED_PREFIX.length) : r.comment;
                      return (
                        <li key={r.at}>
                          <span>
                            <strong>{label}</strong> (v{v.number}) por <strong>{r.reviewer}</strong>
                            {comment && ` · ${comment}`}
                          </span>
                          <span className="muted fine">{fmtDateTime(r.at)}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
