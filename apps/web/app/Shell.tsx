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

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/login');
  }

  return (
    <>
      {!onLogin && (
        <header className="top">
          <nav aria-label="Principal">
            <strong>Cotizador EE</strong>
            <Link href="/solicitudes">Solicitudes</Link>
            <Link href="/solicitudes?assignedToMe=true">Mis tareas</Link>
          </nav>
          <div className="row">
            {me && <span className="muted">{me.name}</span>}
            <button className="secondary" onClick={logout}>
              Cerrar sesión
            </button>
          </div>
        </header>
      )}
      <main>{children}</main>
    </>
  );
}
