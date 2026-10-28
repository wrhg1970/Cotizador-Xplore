'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Logo } from '../Logo';

const ERRORS: Record<string, string> = {
  NOT_INVITED: 'Tu cuenta no ha sido invitada. Pide acceso al administrador de tu oficina.',
  DISABLED: 'Tu cuenta está desactivada.',
  DOMAIN_NOT_ALLOWED: 'Usa tu cuenta de Google de Estudiantes Embajadores.',
  EMAIL_NOT_VERIFIED: 'Tu correo de Google no está verificado.',
  ACCOUNT_MISMATCH: 'Este correo ya está vinculado a otra cuenta de Google.',
  LOGIN_EXPIRED: 'El intento de inicio de sesión expiró. Vuelve a intentarlo.',
  LOGIN_FAILED: 'No se pudo iniciar sesión. Vuelve a intentarlo.',
};

function LoginInner() {
  const error = useSearchParams().get('error');
  return (
    <div className="login">
      <section>
        <span className="brand">
          <Logo height={96} />
        </span>
        <h1>Cada viaje empieza con una buena cotización.</h1>
        <p className="lead">
          Entra con tu cuenta de Google de Estudiantes Embajadores para ver tus solicitudes, armar opciones y
          enviar propuestas autorizadas.
        </p>
        {error && (
          <p className="error" role="alert">
            {ERRORS[error] ?? ERRORS.LOGIN_FAILED}
          </p>
        )}
        <a className="button" href="/api/v1/auth/google/login">
          Entrar con Google
        </a>
      </section>
      <section className="panel" aria-hidden="true">
        <p>
          Solicitud, cotización, <span>autorización</span> y propuesta en un solo lugar.
        </p>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
