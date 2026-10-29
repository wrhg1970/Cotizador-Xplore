import { RequestInbox } from '../solicitudes/RequestInbox';
import { VersionList } from '../aprobaciones/VersionList';

export default function QuotesPage() {
  return (
    <>
      <RequestInbox
        basePath="/cotizaciones"
        title="Administrador de Solicitudes y Propuestas"
        subtitle="Filas, tarjetas o Kanban por etapa (Solicitada → Por aprobar → Aprobada → Enviada); Expediente reúne lo enviado al colegio."
      />
      <h2 style={{ marginTop: 24 }}>Versiones de cotización</h2>
      <VersionList />
    </>
  );
}
