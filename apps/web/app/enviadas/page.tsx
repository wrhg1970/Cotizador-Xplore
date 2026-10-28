import { VersionList } from '../aprobaciones/VersionList';

export default function SentPage() {
  return (
    <>
      <h1>Propuestas enviadas</h1>
      <p className="muted">
        Versiones enviadas al cliente en tus oficinas, con su fecha de envío y cómo va la solicitud.
      </p>
      <VersionList status="SENT" />
    </>
  );
}
