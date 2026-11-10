import Link from 'next/link';
import type { ReactNode } from 'react';
import { QUOTE_STATUS_LABEL, type ScenarioDto } from '../../lib/types';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h12v12H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  columns: 'M3 4h18v16H3zM12 4v16',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  upload: 'M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  download: 'M12 4v11M7 10l5 5 5-5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  renew: 'M20 12a8 8 0 1 1-2.4-5.7L20 8.5M20 3.5v5h-5',
} as const;

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

const tone = (s: ScenarioDto['latest']['status']) =>
  s === 'APPROVED' || s === 'SENT' ? 'st ok' : s === 'IN_REVIEW' ? 'st rev' : 'st';

/** One row at the top of the quote: the request's scenarios with their tools, then the quote actions. */
export function ScenarioBar({
  scenarios,
  currentId,
  tools,
  actions,
}: {
  scenarios: ScenarioDto[];
  currentId: string;
  tools: ReactNode;
  actions: ReactNode;
}) {
  return (
    <section className="card scenario-bar" aria-label="Escenarios y acciones">
      <span className="sb-label">Escenarios</span>
      <nav className="sb-tabs" aria-label="Escenarios de la solicitud">
        {scenarios.map((s, i) => (
          <Link
            key={s.id}
            href={`/cotizaciones/${s.latest.id}`}
            className={s.id === currentId ? 'sb-tab active' : 'sb-tab'}
            aria-current={s.id === currentId ? 'page' : undefined}
            title={s.name}
          >
            <span className="ltr">{String.fromCharCode(65 + (i % 26))}</span>
            {s.latest.participants} est. + {s.latest.chaperones + s.latest.staff} chap.
            <span className={tone(s.latest.status)}>
              v{s.latest.number} · {QUOTE_STATUS_LABEL[s.latest.status]}
            </span>
          </Link>
        ))}
      </nav>
      <div className="sb-group">{tools}</div>
      <span className="sb-sep" aria-hidden="true" />
      <div className="sb-group">{actions}</div>
    </section>
  );
}
