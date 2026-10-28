'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import {
  ACTION_LABEL,
  fmtDate,
  fmtDateTime,
  PRIORITY_LABEL,
  STATUS_LABEL,
  type TravelRequestDto,
} from '../../lib/types';
import { canSeeQuotes, isOfficeAdmin, useMe } from '../../lib/useMe';
import { type ProposalRow, Proposals } from '../Proposals';
import { Scenarios } from '../Scenarios';

interface Timeline {
  events: { action: string; actor: { id: string; name: string } | null; at: string }[];
  comments: { id: string; body: string; author: { id: string; name: string }; createdAt: string }[];
}
interface Quoter {
  id: string;
  name: string;
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [r, setR] = useState<TravelRequestDto | null>(null);
  const [tl, setTl] = useState<Timeline | null>(null);
  const [quoters, setQuoters] = useState<Quoter[]>([]);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [req, timeline] = await Promise.all([
        api<TravelRequestDto>(`/requests/${id}`),
        api<Timeline>(`/requests/${id}/timeline`),
      ]);
      setR(req);
      setTl(timeline);
    } catch (e) {
      setError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const admin = !!r && isOfficeAdmin(me, r.office.id);
  useEffect(() => {
    if (admin && r) api<Quoter[]>(`/offices/${r.office.id}/quoters`).then(setQuoters, () => undefined);
  }, [admin, r]);

  const answered = r?.status === 'SENT' || r?.status === 'WON';
  useEffect(() => {
    if (answered) api<ProposalRow[]>(`/requests/${id}/proposals`).then(setProposals, () => undefined);
  }, [answered, id]);

  async function act(path: string, body: object) {
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      setR(
        await api<TravelRequestDto>(`/requests/${r.id}/${path}`, {
          method: 'POST',
          body: { ...body, version: r.version },
        }),
      );
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function wetravel() {
    if (!r?.wonVersionId) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/quotes/${r.wonVersionId}/wetravel`, { method: 'POST' });
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function comment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body') ?? '').trim();
    if (!body) return;
    try {
      await api(`/requests/${id}/comments`, { method: 'POST', body: { body } });
      form.reset();
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!r) return error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>;

  const isRequester = me?.id === r.requester.id;
  const editable = ['DRAFT', 'SUBMITTED', 'QUOTING'].includes(r.status);
  const canEdit = editable && (isRequester || admin || me?.id === r.assignee?.id);
  const canSubmit = r.status === 'DRAFT' && (isRequester || admin);
  const canAssign = admin && (r.status === 'SUBMITTED' || r.status === 'QUOTING');
  const canCancel = admin && !['WON', 'LOST', 'CANCELLED'].includes(r.status);
  const canRecordOutcome = r.status === 'SENT' && (admin || me?.id === r.assignee?.id);
  const sent = proposals.filter((p) => p.sent);
  const winner = proposals.find((p) => p.versionId === r.wonVersionId);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>
          {r.folio} · {r.groupName}
        </h1>
        <span className="badge">{STATUS_LABEL[r.status]}</span>
      </div>
      <p className="muted">
        Responsable: {r.assignee?.name ?? 'sin asignar'} · Solicitante: {r.requester.name}
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="row" style={{ marginBottom: 16 }}>
        {canEdit && (
          <Link className="button secondary" href={`/solicitudes/${r.id}/editar`}>
            Editar
          </Link>
        )}
        {canSubmit && (
          <button disabled={busy} onClick={() => act('submit', {})}>
            Enviar a cotización
          </button>
        )}
        {canAssign && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void act('assign', { assigneeId: String(new FormData(e.currentTarget).get('assigneeId')) });
            }}
          >
            <label>
              Cotizador
              <select name="assigneeId" required defaultValue={r.assignee?.id ?? ''}>
                <option value="" disabled>
                  Selecciona…
                </option>
                {quoters.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy}>{r.assignee ? 'Reasignar' : 'Asignar'}</button>
          </form>
        )}
        {canRecordOutcome && (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void act('outcome', {
                outcome: 'WON',
                versionId: String(new FormData(e.currentTarget).get('versionId')),
              });
            }}
          >
            <label>
              Propuesta aceptada
              {/* Remount once proposals load so the single sent option is preselected. */}
              <select
                key={sent.length}
                name="versionId"
                required
                defaultValue={sent.length === 1 ? sent[0]!.versionId : ''}
              >
                <option value="" disabled>
                  Selecciona…
                </option>
                {sent.map((p) => (
                  <option key={p.versionId} value={p.versionId}>
                    {p.scenarioName} · v{p.number}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy}>Ganada</button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('¿Por qué no aceptó el cliente? (obligatorio)')?.trim();
                if (reason) void act('outcome', { outcome: 'LOST', reason });
              }}
            >
              Perdida
            </button>
          </form>
        )}
        {canCancel && (
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Motivo de la cancelación (obligatorio):')?.trim();
              if (reason) void act('cancel', { reason });
            }}
          >
            Cancelar solicitud
          </button>
        )}
      </div>

      <section className="card" aria-labelledby="datos">
        <h2 id="datos" style={{ marginTop: 0 }}>
          Datos
        </h2>
        <dl className="facts">
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
          <dt>Prioridad</dt>
          <dd>{PRIORITY_LABEL[r.priority]}</dd>
          <dt>Fecha límite</dt>
          <dd>{fmtDate(r.dueDate)}</dd>
          {r.status === 'WON' && (
            <>
              <dt>Propuesta ganadora</dt>
              <dd>{winner ? `${winner.scenarioName} · v${winner.number}` : 'Registrada'}</dd>
              <dt>Liga de pago WeTravel</dt>
              <dd>
                {r.wetravelUrl ? (
                  <a href={r.wetravelUrl} target="_blank" rel="noopener noreferrer">
                    {r.wetravelUrl}
                  </a>
                ) : admin || me?.id === r.assignee?.id ? (
                  <button type="button" className="secondary" disabled={busy} onClick={() => void wetravel()}>
                    Crear liga de pago en WeTravel
                  </button>
                ) : (
                  'Sin crear'
                )}
              </dd>
            </>
          )}
          {r.lostReason && (
            <>
              <dt>Motivo (perdida)</dt>
              <dd>{r.lostReason}</dd>
            </>
          )}
          {r.cancelReason && (
            <>
              <dt>Motivo de cancelación</dt>
              <dd>{r.cancelReason}</dd>
            </>
          )}
        </dl>
        {r.requirements && (
          <>
            <h2>Requerimientos</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.requirements}</p>
          </>
        )}
      </section>

      {r.status !== 'DRAFT' && !canSeeQuotes(me, r.office.id) && <Proposals requestId={r.id} />}
      {r.status !== 'DRAFT' && canSeeQuotes(me, r.office.id) && (
        <Scenarios
          requestId={r.id}
          officeId={r.office.id}
          canWork={r.status === 'QUOTING' && (admin || me?.id === r.assignee?.id)}
        />
      )}

      <section aria-labelledby="comentarios">
        <h2 id="comentarios">Comentarios</h2>
        {tl?.comments.length === 0 && <p className="muted">Sin comentarios.</p>}
        <ol className="timeline">
          {tl?.comments.map((c) => (
            <li key={c.id}>
              <strong>{c.author.name}</strong> <span className="muted">{fmtDateTime(c.createdAt)}</span>
              <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{c.body}</p>
            </li>
          ))}
        </ol>
        <form onSubmit={comment} className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>
            Nuevo comentario
            <textarea name="body" maxLength={2000} required />
          </label>
          <button>Comentar</button>
        </form>
      </section>

      <section aria-labelledby="historial">
        <h2 id="historial">Historial</h2>
        <ol className="timeline">
          {tl?.events.map((e, i) => (
            <li key={i}>
              {ACTION_LABEL[e.action] ?? e.action} · {e.actor?.name ?? 'Sistema'}{' '}
              <span className="muted">{fmtDateTime(e.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
