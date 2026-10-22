'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { Me } from './types';

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>('/me').then(setMe, () => undefined);
  }, []);
  return me;
}

export const isOfficeAdmin = (me: Me | null, officeId: string) =>
  !!me?.roles.some(
    (r) => r.role === 'SYSTEM_ADMIN' || (r.officeId === officeId && r.role === 'OFFICE_ADMIN'),
  );

/** Mirrors the API: internal costs are visible to the quoting side of the office only. */
export const canSeeQuotes = (me: Me | null, officeId: string) =>
  !!me?.roles.some(
    (r) =>
      r.role === 'SYSTEM_ADMIN' ||
      (r.officeId === officeId && ['QUOTER', 'APPROVER', 'OFFICE_ADMIN', 'AUDITOR'].includes(r.role)),
  );
