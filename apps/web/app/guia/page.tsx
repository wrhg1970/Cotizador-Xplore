'use client';

import { ROLE_LABEL } from '../lib/types';
import { useMe } from '../lib/useMe';
import { GUIDES } from './content';

export default function GuidePage() {
  const me = useMe();
  const mine = new Set(me?.roles.map((r) => r.role));
  // The person's own roles first, then the rest for reference.
  const ordered = [...GUIDES].sort((a, b) => Number(mine.has(b.role)) - Number(mine.has(a.role)));

  return (
    <>
      <h1>Guía de uso</h1>
      <p className="muted">Qué hace cada rol en el cotizador, paso a paso.</p>
      {ordered.map((g) => (
        <section key={g.role} className="card guide" aria-labelledby={`guia-${g.role}`}>
          <h2 id={`guia-${g.role}`}>
            {g.title} {mine.has(g.role) && <span className="badge">Tu rol</span>}
          </h2>
          <p className="muted">
            {g.summary} <small>({ROLE_LABEL[g.role]})</small>
          </p>
          <ol>
            {g.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
