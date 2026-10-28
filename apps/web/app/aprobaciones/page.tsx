import { VersionList } from './VersionList';

export default function ApprovalsPage() {
  return (
    <>
      <h1>Aprobaciones</h1>
      <p className="muted">
        Cotizaciones en revisión en tus oficinas. Autoriza quien tiene «Autorizar viaje» y no la preparó.
      </p>
      <VersionList status="IN_REVIEW" />
    </>
  );
}
