import { Suspense } from 'react';
import { SoldTray } from './SoldTray';

export default function SoldPage() {
  return (
    <Suspense fallback={<p className="muted">Cargando…</p>}>
      <SoldTray />
    </Suspense>
  );
}
