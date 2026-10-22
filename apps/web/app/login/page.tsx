'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

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
    <div className="card" style={{ maxWidth: 420, margin: '10vh auto' }}>
      <h1>Cotizador de Estudiantes Embajadores</h1>
      <p className="muted">Entra con tu cuenta corporativa de Google.</p>
      {error && (
        <p className="error" role="alert">
          {ERRORS[error] ?? ERRORS.LOGIN_FAILED}
        </p>
      )}
      <a className="button" href="/api/v1/auth/google/login">
        Entrar con Google
      </a>
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
