'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api, isPublicPath } from './lib/api';
import type { Me } from './lib/types';
import { BrandColors, Logo } from './Logo';
import { brandName, useBrand } from './lib/useBrand';
import { isSystemAdmin, useMe } from './lib/useMe';
import { SimulatePicker, SimulationBar } from './SimulateUser';
import { Welcome } from './Welcome';
import { WorkNotifier } from './WorkNotifier';

const LEADS: string[] = ['OFFICE_ADMIN', 'AUDITOR', 'SYSTEM_ADMIN'];
const QUOTING: string[] = ['QUOTER', 'APPROVER', 'OFFICE_ADMIN', 'AUDITOR', 'SYSTEM_ADMIN'];
const ADMINS: string[] = ['OFFICE_ADMIN', 'SYSTEM_ADMIN'];
const PLATFORM: string[] = ['SYSTEM_ADMIN'];

interface Item {
  label: string;
  href: string;
  /** Hidden unless the person holds one of these roles; the API enforces the same rule. */
  roles?: string[];
  sub?: boolean;
}

/** The three blocks Will asked for (2026-10-28), in his order. */
const groups = (me: Me | null): Item[][] => {
  const has = (roles: string[]) => !!me?.roles.some((r) => roles.includes(r.role));
  const settings = has(PLATFORM) ? '/administracion' : has(ADMINS) ? '/usuarios' : '/plantillas';
  return [
    [
      { label: 'Inicio', href: '/inicio' },
      { label: 'Mi Dashboard', href: '/mi-dashboard' },
      { label: 'Dashboard ejecutivo', href: '/tablero', roles: LEADS },
      { label: 'Solicitudes', href: '/solicitudes' },
      { label: 'Cotizaciones', href: '/cotizaciones' },
      { label: 'Aprobaciones', href: '/aprobaciones' },
      { label: 'Propuestas enviadas', href: '/enviadas' },
      { label: 'Reportes', href: '/reportes', roles: LEADS },
    ],
    [
      { label: 'Clientes', href: '/colegios' },
      { label: 'Proveedores', href: '/proveedores', roles: QUOTING },
    ],
    [
      { label: 'Configuración', href: settings, roles: QUOTING },
      { label: 'Usuarios', href: '/usuarios', roles: ADMINS, sub: true },
      { label: 'Plantillas', href: '/plantillas', roles: QUOTING, sub: true },
      { label: 'Rubros', href: '/rubros', roles: PLATFORM, sub: true },
      { label: 'Integraciones', href: '/administracion#integraciones', roles: PLATFORM },
      { label: 'Importar XLSX / IA', href: '/importar' },
    ],
  ]
    .map((g) => g.filter((i) => !i.roles || has(i.roles)))
    .filter((g) => g.length);
};

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = isPublicPath(pathname);
  const me = useMe();
  const brand = useBrand(bare);
  // Phones and tablets: the side menu folds behind "Menú".
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  // "Configuración" stays lit on its sub-pages; Integraciones is an anchor inside Administración.
  const current = (i: Item) => {
    const path = i.href.split('#')[0]!;
    if (i.href.includes('#') || i.label === 'Configuración') return pathname === path ? 'page' : undefined;
    return pathname.startsWith(path) ? 'page' : undefined;
  };
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

  if (bare)
    return (
      <>
        <BrandColors brand={brand} />
        <main className="bare">{children}</main>
      </>
    );
  return (
    <div className="app">
      <BrandColors brand={brand} />
      <aside className="side">
        <div className="side-head">
          <Link className="brand" href="/inicio">
            <span className="brand-chip">
              <Logo height={44} src={brand?.logoUrl} alt={brandName(brand)} />
            </span>
          </Link>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="menu-principal"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            Menú
          </button>
        </div>
        <nav id="menu-principal" aria-label="Principal" className={menuOpen ? 'open' : undefined}>
          {groups(me).map((g, n) => (
            <ul key={n}>
              {g.map((i) => (
                <li key={i.label} className={i.sub ? 'sub' : undefined}>
                  <Link href={i.href} aria-current={current(i)}>
                    {i.label}
                  </Link>
                </li>
              ))}
            </ul>
          ))}
        </nav>
      </aside>
      <div className="content">
        {me?.simulatedBy && <SimulationBar me={me} />}
        <header className="top">
          <div className="user">
            {me && !me.simulatedBy && isSystemAdmin(me) && <SimulatePicker />}
            {me && <WorkNotifier />}
            <Link href="/guia" aria-current={pathname.startsWith('/guia') ? 'page' : undefined}>
              Ayuda
            </Link>
            <button className="secondary" onClick={logout}>
              Cerrar sesión
            </button>
            {me && (
              <span className="avatar" role="img" title={me.name} aria-label={me.name}>
                {initials}
              </span>
            )}
          </div>
        </header>
        {me && <Welcome me={me} />}
        <main>{children}</main>
      </div>
    </div>
  );
}
