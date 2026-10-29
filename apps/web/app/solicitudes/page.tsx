import { RequestInbox } from './RequestInbox';

export default function RequestsPage() {
  return (
    <RequestInbox
      basePath="/solicitudes"
      title="Solicitudes"
      subtitle="Expedientes en filas, tarjetas o Kanban; abre la ficha para cotizar, comparar o autorizar."
    />
  );
}
