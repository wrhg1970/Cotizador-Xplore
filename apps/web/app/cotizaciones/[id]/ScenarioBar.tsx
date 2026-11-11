'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
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
  onRename,
}: {
  scenarios: ScenarioDto[];
  currentId: string;
  tools: ReactNode;
  actions: ReactNode;
  /** Only passed to who may work the quote; sent scenarios keep their name. */
  onRename?: (scenarioId: string, name: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const renamable = (s: ScenarioDto) =>
    !!onRename && s.id === currentId && !s.versions.some((v) => v.status === 'SENT');

  async function save(s: ScenarioDto, value: string) {
    const name = value.trim();
    if (name && name !== s.name) await onRename!(s.id, name);
    setEditing(null);
  }

  return (
    <section className="card scenario-bar" aria-label="Escenarios y acciones">
      <span className="sb-label">Escenarios</span>
      <nav className="sb-tabs" aria-label="Escenarios de la solicitud">
        {scenarios.map((s, i) => {
          const active = s.id === currentId;
          const letter = <span className="ltr">{String.fromCharCode(65 + (i % 26))}</span>;
          const rest = (
            <>
              <span className="cnt">
                {s.latest.participants} est. + {s.latest.chaperones + s.latest.staff} chap.
              </span>
              <span className={tone(s.latest.status)}>
                v{s.latest.number} · {QUOTE_STATUS_LABEL[s.latest.status]}
              </span>
            </>
          );
          if (editing === s.id)
            return (
              <span key={s.id} className="sb-tab active">
                {letter}
                <input
                  className="sb-name"
                  aria-label="Nombre del escenario"
                  defaultValue={s.name}
                  maxLength={150}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void save(s, e.currentTarget.value);
                    if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={() => setEditing(null)}
                />
                {rest}
              </span>
            );
          return (
            <Link
              key={s.id}
              href={`/cotizaciones/${s.latest.id}`}
              className={active ? 'sb-tab active' : 'sb-tab'}
              aria-current={active ? 'page' : undefined}
              title={s.name}
              onDoubleClick={renamable(s) ? () => setEditing(s.id) : undefined}
            >
              {letter}
              <span className="nm">{s.name}</span>
              {rest}
              {renamable(s) && (
                <button
                  type="button"
                  className="sb-pen"
                  aria-label="Cambiar nombre del escenario"
                  title="Cambiar nombre"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditing(s.id);
                  }}
                >
                  ✎
                </button>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="sb-group">{tools}</div>
      <span className="sb-sep" aria-hidden="true" />
      <div className="sb-group">{actions}</div>
    </section>
  );
}
