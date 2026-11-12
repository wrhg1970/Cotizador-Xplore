import { Suspense } from 'react';
import { SentTray } from './SentTray';

export default function SentPage() {
  return (
    <Suspense fallback={<p className="muted">Cargando…</p>}>
      <SentTray />
    </Suspense>
  );
}
