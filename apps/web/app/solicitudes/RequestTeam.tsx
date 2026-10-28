'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../lib/api';

interface Member {
  kind: 'COMMERCIAL' | 'SUPPORT';
  user: { id: string; name: string };
}
interface Person {
  id: string;
  name: string;
}

/** V2 request team: one commercial executive plus support people from the same office. */
export function RequestTeam({ requestId, canManage }: { requestId: string; canManage: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const base = `/requests/${requestId}/team`;

  const reload = useCallback(() => {
    api<Member[]>(base).then(setMembers, (e) => setError(errorText(e)));
  }, [base]);
  useEffect(reload, [reload]);
  useEffect(() => {
    if (canManage) api<Person[]>(`${base}/candidates`).then(setPeople, () => setPeople([]));
  }, [base, canManage]);

  const commercial = members.find((m) => m.kind === 'COMMERCIAL')?.user.id ?? null;
  const support = members.filter((m) => m.kind === 'SUPPORT').map((m) => m.user.id);

  async function save(commercialExecutiveId: string | null, supportIds: string[]) {
    setError(null);
    // Controls stay disabled until the server answers, so a second change never builds on stale members.
    setSaving(true);
    try {
      setMembers(
        await api<Member[]>(base, {
          method: 'PUT',
          body: {
            commercialExecutiveId,
            supportIds: supportIds.filter((id) => id !== commercialExecutiveId),
          },
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="equipo">
      <h2 id="equipo">Equipo</h2>
      {!canManage ? (
        <dl className="facts">
          <dt>Ejecutivo comercial</dt>
          <dd>{members.find((m) => m.kind === 'COMMERCIAL')?.user.name ?? '—'}</dd>
          <dt>Apoyo</dt>
          <dd>
            {members
              .filter((m) => m.kind === 'SUPPORT')
              .map((m) => m.user.name)
              .join(', ') || '—'}
          </dd>
        </dl>
      ) : (
        <>
          <label>
            Ejecutivo comercial
            <select
              disabled={saving}
              value={commercial ?? ''}
              onChange={(e) => void save(e.target.value || null, support)}
            >
              <option value="">Sin asignar</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
            <legend>Apoyo</legend>
            <div className="row" style={{ alignItems: 'center' }}>
              {people
                .filter((p) => p.id !== commercial)
                .map((p) => (
                  <label key={p.id} style={{ flexDirection: 'row', alignItems: 'center', fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      disabled={saving}
                      checked={support.includes(p.id)}
                      onChange={(e) =>
                        void save(
                          commercial,
                          e.target.checked ? [...support, p.id] : support.filter((id) => id !== p.id),
                        )
                      }
                    />{' '}
                    {p.name}
                  </label>
                ))}
            </div>
          </fieldset>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
