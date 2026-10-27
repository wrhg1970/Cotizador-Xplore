'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from './lib/api';
import { useMe } from './lib/useMe';

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const onLogin = pathname.startsWith('/login');
  const me = useMe();

  const current = (href: string) => (pathname.startsWith(href) ? 'page' : undefined);
  const initials = me?.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  return (
    <>
      {!onLogin && (
        <header className="top">
          <div className="bar">
            <Link className="brand" href="/inicio">
              xplore<span>·</span>together
            </Link>
            <nav aria-label="Principal">
              <Link href="/inicio" aria-current={current('/inicio')}>
                Mi trabajo
              </Link>
              <Link href="/solicitudes" aria-current={current('/solicitudes')}>
                Solicitudes
              </Link>
              <Link href="/solicitudes?assignedToMe=true">Mis tareas</Link>
              {me?.roles.some((r) => r.role === 'OFFICE_ADMIN' || r.role === 'SYSTEM_ADMIN') && (
                <Link href="/usuarios" aria-current={current('/usuarios')}>
                  Usuarios
                </Link>
              )}
              {me?.roles.some((r) =>
                ['QUOTER', 'APPROVER', 'OFFICE_ADMIN', 'AUDITOR', 'SYSTEM_ADMIN'].includes(r.role),
              ) && (
                <Link href="/plantillas" aria-current={current('/plantillas')}>
                  Plantillas
                </Link>
              )}
              {me?.roles.some((r) => ['OFFICE_ADMIN', 'AUDITOR', 'SYSTEM_ADMIN'].includes(r.role)) && (
                <Link href="/bitacora" aria-current={current('/bitacora')}>
                  Bitácora
                </Link>
              )}
              {me?.roles.some((r) => r.role === 'SYSTEM_ADMIN') && (
                <Link href="/rubros" aria-current={current('/rubros')}>
                  Rubros
                </Link>
              )}
              {me?.roles.some((r) => r.role === 'SYSTEM_ADMIN') && (
                <Link href="/administracion" aria-current={current('/administracion')}>
                  Administración
                </Link>
              )}
            </nav>
            <div className="user">
              <button className="secondary" onClick={logout}>
                Cerrar sesión
              </button>
              {me && (
                <span className="avatar" role="img" title={me.name} aria-label={me.name}>
                  {initials}
                </span>
              )}
            </div>
          </div>
        </header>
      )}
      <main>{children}</main>
    </>
  );
}
