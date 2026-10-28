import { VersionList } from '../aprobaciones/VersionList';

export default function QuotesPage() {
  return (
    <>
      <h1>Cotizaciones</h1>
      <p className="muted">
        Todas las versiones vigentes de tus oficinas, la más reciente primero. Para cotizar, entra a la
        solicitud.
      </p>
      <VersionList />
    </>
  );
}
