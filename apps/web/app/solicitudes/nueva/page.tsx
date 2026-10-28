'use client';

import type { RequestDraft } from '@ee/contracts';
import { useState } from 'react';
import { RequestForm } from '../RequestForm';
import { RequestImport } from '../RequestImport';

export default function NewRequestPage() {
  const [draft, setDraft] = useState<{ n: number; fields: RequestDraft }>({ n: 0, fields: {} });
  return (
    <>
      <RequestImport onDraft={(fields) => setDraft((d) => ({ n: d.n + 1, fields }))} />
      {/* Remount so the uncontrolled inputs pick up the imported defaults. */}
      <RequestForm key={draft.n} draft={draft.fields} />
    </>
  );
}
