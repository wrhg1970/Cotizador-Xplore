import Link from 'next/link';

export default function ReportsPage() {
  return (
    <>
      <h1>Reportes</h1>
      <div className="wcards compact">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Reporte financiero (Excel)</h2>
          <p className="muted">Costos, comisión y precio de los viajes ganados, por periodo y oficina.</p>
          <Link className="button" href="/tablero">
            Ir a descargarlo
          </Link>
        </section>
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Bitácora (CSV)</h2>
          <p className="muted">Cada cambio, autorización, envío y precio, con filtros y exportación.</p>
          <Link className="button" href="/bitacora">
            Abrir bitácora
          </Link>
        </section>
      </div>
    </>
  );
}
