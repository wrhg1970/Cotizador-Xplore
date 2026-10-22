import type { Budget, RequestStatus } from '@ee/contracts';

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: { officeId: string; role: string }[];
}

export interface TravelRequestDto {
  id: string;
  folio: string;
  status: RequestStatus;
  version: number;
  office: { id: string; code: string; name: string };
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  groupName: string;
  clientName: string | null;
  program: string | null;
  city: string;
  countryCode: string;
  departureDate: string;
  returnDate: string;
  participants: number;
  chaperones: number;
  staff: number;
  budget: Budget | null;
  requirements: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  dueDate: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Por asignar',
  QUOTING: 'En cotización',
  SENT: 'Enviada',
  WON: 'Ganada',
  LOST: 'Perdida',
  CANCELLED: 'Cancelada',
};

export const PRIORITY_LABEL = { LOW: 'Baja', NORMAL: 'Normal', HIGH: 'Alta' } as const;

export const ACTION_LABEL: Record<string, string> = {
  'request.created': 'Creó la solicitud',
  'request.updated': 'Editó el borrador',
  'request.updated_after_submit': 'Modificó la solicitud',
  'request.submitted': 'Envió a cotización',
  'request.assigned': 'Asignó cotizador',
  'request.cancelled': 'Canceló la solicitud',
  'request.commented': 'Comentó',
};

const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '—');
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
