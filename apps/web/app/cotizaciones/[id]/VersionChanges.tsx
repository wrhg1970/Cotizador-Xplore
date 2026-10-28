'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Comparison {
  previous: { id: string; number: number } | null;
  fields: { field: string; label: string; from: string | number | null; to: string | number | null }[];
  lines: {
    change: 'ADDED' | 'REMOVED' | 'CHANGED';
    description: string;
    from: string | null;
    to: string | null;
  }[];
}

const CHANGE = { ADDED: 'Nuevo', REMOVED: 'Quitado', CHANGED: 'Cambió' } as const;
const show = (x: string | number | null) => (x === null || x === '' ? '—' : String(x));

/** "Comparar contra versión anterior": headline fields, totals and concepts that changed. */
export function VersionChanges({ quoteId, rowVersion }: { quoteId: string; rowVersion: number }) {
  const [c, setC] = useState<Comparison | null>(null);
  useEffect(() => {
    api<Comparison>(`/quotes/${quoteId}/compare`).then(setC, () => setC(null));
  }, [quoteId, rowVersion]);
  if (!c?.previous) return null;
  const none = !c.fields.length && !c.lines.length;
  return (
    <details className="card" style={{ marginBottom: 16 }}>
      <summary>
        Cambios contra la versión {c.previous.number}
        {none ? ' (sin cambios)' : ` (${c.fields.length + c.lines.length})`}
      </summary>
      {!none && (
        <table aria-label={`Cambios contra la versión ${c.previous.number}`}>
          <thead>
            <tr>
              <th>Qué</th>
              <th>Antes</th>
              <th>Ahora</th>
            </tr>
          </thead>
          <tbody>
            {c.fields.map((f) => (
              <tr key={f.field}>
                <td>{f.label}</td>
                <td>{show(f.from)}</td>
                <td>{show(f.to)}</td>
              </tr>
            ))}
            {c.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  {CHANGE[l.change]}: {l.description}
                </td>
                <td>{show(l.from)}</td>
                <td>{show(l.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}
