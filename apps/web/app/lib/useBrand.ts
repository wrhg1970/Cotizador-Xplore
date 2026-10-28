'use client';

import { useEffect, useState } from 'react';
import type { AgencyBrand } from '@ee/contracts';
import { api } from './api';

export type PublicBrand = Omit<AgencyBrand, 'proposalFooter' | 'mailFromName'>;

/** Signed-in pages show the user's agency; public ones the agency of the hostname (EE by default). */
export function useBrand(isPublic: boolean) {
  const [brand, setBrand] = useState<PublicBrand | null>(null);
  useEffect(() => {
    api<PublicBrand>(isPublic ? '/branding' : '/agency/brand').then(setBrand, () => undefined);
  }, [isPublic]);
  return brand;
}

export const brandName = (b: { brandName: string | null; name: string } | null) =>
  b?.brandName ?? b?.name ?? 'Estudiantes Embajadores';
