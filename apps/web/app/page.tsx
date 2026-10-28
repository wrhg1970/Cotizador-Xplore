'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from './Logo';

const STEPS = [
  [
    'Solicitud por oficina',
    'Folio automático, fechas, grupo, especificaciones del viaje y archivos del colegio en un solo expediente.',
  ],
  [
    'Cotización con la hoja EE',
    'Conceptos por estudiante y gastos de chaperones, comisión o precio final, varias opciones lado a lado.',
  ],
  [
    'Autorización obligatoria',
    'Nadie autoriza su propio trabajo; si cambia un costo después de autorizar, hay que volver a autorizar.',
  ],
  [
    'Propuesta al colegio',
    'PDF o liga sin costos ni comisiones, registro del envío y resultado: ganada o perdida.',
  ],
] as const;

const TRUST = [
  'Solo cuentas de Google de Estudiantes Embajadores, por invitación.',
  'Cada quien ve las solicitudes de su oficina, según su rol.',
  'Bitácora de cada cambio, autorización, envío y precio.',
  'Montos exactos por moneda; los tipos de cambio se guardan con fecha y fuente.',
] as const;

/** Public landing (V2): what the tool does and the way in. Signed-in people go straight to their work. */
export default function Landing() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch('/api/v1/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? router.replace('/inicio') : setChecked(true)))
      .catch(() => setChecked(true));
  }, [router]);

  if (!checked) return null;
  return (
    <div className="landing">
      <header>
        <Logo height={56} />
        <a className="button" href="/login">
          Entrar
        </a>
      </header>
      <section className="hero">
        <p className="kicker">Estudiantes Embajadores · Xplore Together</p>
        <h1>Del pedido del colegio a la propuesta autorizada, sin hojas sueltas.</h1>
        <p className="lead">
          El cotizador de viajes grupales de EE: cada oficina registra la solicitud, cotiza con la hoja
          oficial, la manda a autorizar y comparte una propuesta limpia con el colegio.
        </p>
        <a className="button" href="/api/v1/auth/google/login">
          Entrar con Google
        </a>
      </section>
      <section aria-labelledby="proceso">
        <h2 id="proceso">Cómo funciona</h2>
        <ol className="steps">
          {STEPS.map(([title, text], i) => (
            <li key={title}>
              <span className="num">0{i + 1}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="seguridad" className="trust">
        <h2 id="seguridad">Seguro por diseño</h2>
        <ul>
          {TRUST.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="muted">Conectado con WeTravel para las ligas de pago; Wissify, próximamente.</p>
      </section>
    </div>
  );
}
