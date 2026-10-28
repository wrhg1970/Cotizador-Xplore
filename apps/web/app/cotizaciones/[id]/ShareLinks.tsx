'use client';

import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../lib/api';
import { fmtDateTime } from '../../lib/types';

interface Share {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewAt: string | null;
  createdAt: string;
  createdBy: { name: string };
  acceptance?: { signerName: string; signerRole: string; acceptedAt: string; ip: string | null };
}

/** V2 "portal": a link the school opens without an account. The full URL is shown only once. */
export function ShareLinks({
  quoteId,
  canShare,
  canRevoke,
}: {
  quoteId: string;
  canShare: boolean;
  canRevoke: boolean;
}) {
  const [shares, setShares] = useState<Share[]>([]);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/quotes/${quoteId}/shares`;

  const reload = useCallback(() => {
    api<Share[]>(base).then(setShares, (e) => setError(errorText(e)));
  }, [base]);
  useEffect(reload, [reload]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const days = Number(new FormData(e.currentTarget).get('days'));
      const s = await api<{ token: string }>(base, { method: 'POST', body: { days } });
      setUrl(`${window.location.origin}/p/${s.token}`);
      reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await api(`${base}/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  if (!canShare && shares.length === 0) return null;
  const now = new Date();
  return (
    <section aria-labelledby="liga-colegio">
      <h3 id="liga-colegio">Liga para el colegio</h3>
      <p className="muted">
        El colegio ve la propuesta sin costos y sin cuenta. La liga deja de funcionar al caducar, al revocarla
        o si la versión deja de estar autorizada.
      </p>
      {canShare && (
        <form className="row" onSubmit={create}>
          <label>
            Vigencia (días)
            <input name="days" type="number" min={1} max={90} defaultValue={30} required />
          </label>
          <button className="secondary" disabled={busy}>
            Crear liga
          </button>
        </form>
      )}
      {url && (
        <p role="status" className="row">
          <input aria-label="Liga creada" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <button className="secondary" onClick={() => void navigator.clipboard?.writeText(url)}>
            Copiar
          </button>
          <span className="muted">Cópiala ahora: por seguridad no se vuelve a mostrar.</span>
        </p>
      )}
      {shares.length > 0 && (
        <ul>
          {shares.map((s) => {
            const live = !s.revokedAt && new Date(s.expiresAt) > now;
            return (
              <li key={s.id}>
                {s.revokedAt
                  ? `Revocada ${fmtDateTime(s.revokedAt)}`
                  : `${live ? 'Vigente' : 'Caducó'} hasta ${fmtDateTime(s.expiresAt)}`}{' '}
                <span className="muted">
                  · {s.viewCount} {s.viewCount === 1 ? 'vista' : 'vistas'}
                  {s.lastViewAt && `, última ${fmtDateTime(s.lastViewAt)}`} · creó {s.createdBy.name}
                </span>{' '}
                {s.acceptance && (
                  <strong>
                    Aceptada en línea por {s.acceptance.signerName} ({s.acceptance.signerRole}) el{' '}
                    {fmtDateTime(s.acceptance.acceptedAt)}
                    {s.acceptance.ip && ` desde ${s.acceptance.ip}`}
                  </strong>
                )}{' '}
                {canRevoke && live && (
                  <button className="secondary" onClick={() => void revoke(s.id)}>
                    Revocar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
