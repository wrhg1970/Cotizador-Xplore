'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { Me, RolePolicy } from './types';

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>('/me').then(setMe, () => undefined);
  }, []);
  return me;
}

const isSystemAdmin = (me: Me | null) => !!me?.roles.some((r) => r.role === 'SYSTEM_ADMIN');

/** Mirrors the API (authz.ts): grants acting in the office, local or national by role policy. */
const policiesIn = (me: Me | null, officeId: string): RolePolicy[] =>
  (me?.roles ?? [])
    .map((r) => ({ r, p: me?.policies?.[r.role] }))
    .filter(({ r, p }) => r.role !== 'SYSTEM_ADMIN' && p && (r.officeId === officeId || p.allOffices))
    .map(({ p }) => p!);

export const isOfficeAdmin = (me: Me | null, officeId: string) =>
  isSystemAdmin(me) ||
  !!me?.roles.some(
    (r) => r.role === 'OFFICE_ADMIN' && (r.officeId === officeId || me.policies?.OFFICE_ADMIN?.allOffices),
  );

/** Internal costs are visible only to roles whose policy allows it. */
export const canSeeQuotes = (me: Me | null, officeId: string) =>
  isSystemAdmin(me) || policiesIn(me, officeId).some((p) => p.viewInternalCosts);

/** "Crear" / "Editar" / "Borrar" from the role matrix (authz.ts canDo). */
export const can = (me: Me | null, officeId: string, action: 'canCreate' | 'canEdit' | 'canDelete') =>
  isSystemAdmin(me) || policiesIn(me, officeId).some((p) => p.canView && p[action]);

export const canExportXlsx = (me: Me | null, officeId: string) =>
  isSystemAdmin(me) || policiesIn(me, officeId).some((p) => p.exportInternalXlsx);
