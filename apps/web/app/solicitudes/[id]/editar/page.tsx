'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorText } from '../../../lib/api';
import type { TravelRequestDto } from '../../../lib/types';
import { RequestForm } from '../../RequestForm';

export default function EditRequestPage() {
  const { id } = useParams<{ id: string }>();
  const [r, setR] = useState<TravelRequestDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<TravelRequestDto>(`/requests/${id}`).then(setR, (e) => setError(errorText(e)));
  }, [id]);
  return (
    <>
      <h1>Editar {r?.folio}</h1>
      {error && <p className="error">{error}</p>}
      {r && <RequestForm existing={r} />}
    </>
  );
}
