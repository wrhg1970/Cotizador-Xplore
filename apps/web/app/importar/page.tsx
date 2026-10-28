'use client';

import Link from 'next/link';
import { useMe } from '../lib/useMe';

export default function ImportPage() {
  const me = useMe();
  return (
    <>
      <h1>Importar XLSX / IA</h1>
      <div className="wcards compact">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Nueva solicitud desde Excel o Google Sheets</h2>
          <p className="muted">La IA lee la hoja del colegio y llena el formulario para que lo revises.</p>
          <Link className="button" href="/solicitudes/nueva">
            Importar solicitud
          </Link>
        </section>
        {me?.roles.some((r) => r.role === 'SYSTEM_ADMIN') && (
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Histórico de cotizaciones (Excel EE)</h2>
            <p className="muted">Cada Excel del año pasado entra como solicitud ganada, perdida o enviada.</p>
            <Link className="button" href="/historico">
              Importar histórico
            </Link>
          </section>
        )}
      </div>
    </>
  );
}
