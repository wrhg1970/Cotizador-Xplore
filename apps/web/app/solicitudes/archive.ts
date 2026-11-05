import { api } from '../lib/api';
import type { TravelRequestDto } from '../lib/types';

type Ref = Pick<TravelRequestDto, 'id' | 'folio' | 'status' | 'version'>;

/** Asks first and says what stops working; false when the user backs out. */
export async function archiveRequest(r: Ref): Promise<boolean> {
  const impact =
    r.status === 'SENT' || r.status === 'WON'
      ? '\n\nYa se envió al colegio: su liga deja de abrir y no salen recordatorios de pago mientras esté archivada.'
      : '';
  if (
    !window.confirm(`¿Archivar ${r.folio}? Sale de listas, tableros y avisos; podrás desarchivarla.${impact}`)
  )
    return false;
  await api(`/requests/${r.id}/archive`, { method: 'POST', body: { version: r.version } });
  return true;
}

export async function unarchiveRequest(r: Ref): Promise<boolean> {
  await api(`/requests/${r.id}/unarchive`, { method: 'POST', body: { version: r.version } });
  return true;
}

/** Permanent: the user retypes the folio, the API checks it again. */
export async function purgeRequest(r: Ref): Promise<boolean> {
  const typed = window.prompt(
    `BORRAR DEFINITIVAMENTE ${r.folio}: se eliminan la solicitud, escenarios, versiones, envíos, ligas y archivos. No se puede deshacer.\n\nEscribe el folio para confirmar:`,
  );
  if (typed === null) return false;
  if (typed.trim().toUpperCase() !== r.folio) {
    window.alert('El folio no coincide; no se borró nada.');
    return false;
  }
  await api(`/requests/${r.id}`, { method: 'DELETE', body: { folio: r.folio } });
  return true;
}
