'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { isSystemAdmin, useMe } from './lib/useMe';

const ADMINS = ['OFFICE_ADMIN', 'SYSTEM_ADMIN'];
const QUOTING = ['QUOTER', 'APPROVER', 'OFFICE_ADMIN', 'AUDITOR', 'SYSTEM_ADMIN'];

/** Tabs of Administración (/administracion?t=…); the first is the default. */
export const ADMIN_TABS = [
  ['permisos', 'Permisos'],
  ['oficinas', 'Oficinas'],
  ['tipos', 'Tipos de cambio'],
  ['reglas', 'Autorización y alertas'],
  ['metas', 'Metas'],
  ['marca', 'Marca'],
  ['integraciones', 'Integraciones'],
  ['agencias', 'Agencias'],
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number][0];

const admin = (t: AdminTab) => {
  const [key, label] = ADMIN_TABS.find(([k]) => k === t)!;
  return { key, label, href: `/administracion?t=${key}`, sys: true };
};

/** Will's order (2026-11-11): people, catalogs, rules, agency. A divider separates each group. */
const GROUPS = [
  [
    { key: 'usuarios', label: 'Usuarios', href: '/usuarios', roles: ADMINS },
    admin('permisos'),
    admin('oficinas'),
  ],
  [
    { key: 'plantillas', label: 'Plantillas', href: '/plantillas', roles: QUOTING },
    { key: 'rubros', label: 'Rubros', href: '/rubros', sys: true },
    { key: 'incluye', label: 'Incluye / No incluye', href: '/incluye', sys: true },
    admin('tipos'),
  ],
  [admin('reglas'), admin('metas')],
  [admin('marca'), admin('integraciones'), { ...admin('agencias'), platform: true }],
];

/** One row of tabs shared by Configuración, Usuarios, Plantillas and Rubros; each person sees theirs. */
export function ConfigTabs({ current, children }: { current: string; children?: ReactNode }) {
  const me = useMe();
  const sys = isSystemAdmin(me);
  const has = (roles: string[]) => !!me?.roles.some((r) => roles.includes(r.role));
  const groups = GROUPS.map((g) =>
    g.filter((t) =>
      'platform' in t ? !!me?.platformAdmin : 'sys' in t ? sys : 'roles' in t ? has(t.roles) : true,
    ),
  ).filter((g) => g.length);
  return (
    <div className="cfg">
      <p className="eyebrow">Configuración</p>
      <h1>{groups.flat().find((t) => t.key === current)?.label ?? 'Configuración'}</h1>
      <nav className="tabs cfg-tabs" aria-label="Configuración">
        {groups.map((g, i) => (
          <span key={i} className="cfg-group">
            {g.map((t) => (
              <Link key={t.key} href={t.href} aria-current={t.key === current ? 'page' : undefined}>
                {t.label}
              </Link>
            ))}
          </span>
        ))}
      </nav>
      {children}
    </div>
  );
}
