import { Suspense } from 'react';
import { ApprovalTray } from './ApprovalTray';

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<p className="muted">Cargando…</p>}>
      <ApprovalTray />
    </Suspense>
  );
}
