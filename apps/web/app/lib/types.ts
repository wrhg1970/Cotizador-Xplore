import type {
  Budget,
  CurrencyCode,
  DeliveryChannel,
  LineCategory,
  QuoteVersionStatus,
  RequestStatus,
  RoleName,
} from '@ee/contracts';

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
  'quote.scenario.created': 'Creó un escenario',
  'quote.scenario.duplicated': 'Duplicó un escenario',
};

export interface QuoteLineDto {
  id?: string;
  category: LineCategory;
  description: string;
  quantity: string;
  unitCost: string;
  currency: CurrencyCode;
  lineTotal?: string;
  internalOnly: boolean;
  costSource?: string | null;
}

export interface FxRateDto {
  fromCurrency: CurrencyCode;
  rate: string;
  rateDate: string;
  source: string;
}

export interface QuoteDto {
  id: string;
  scenarioId: string;
  scenarioName: string;
  requestId: string;
  number: number;
  status: QuoteVersionStatus;
  rowVersion: number;
  saleCurrency: CurrencyCode;
  targetMarginRate: string;
  mxnRate: string | null;
  participants: number;
  chaperones: number;
  staff: number;
  validUntil: string | null;
  assumptions: string | null;
  lines: QuoteLineDto[];
  fxRates: (FxRateDto & { toCurrency: CurrencyCode })[];
  totals:
    | (Record<
        | 'directPerParticipant'
        | 'sharedPerParticipant'
        | 'costPerParticipant'
        | 'marginPerParticipant'
        | 'pricePerParticipant'
        | 'groupPrice'
        | 'groupMargin',
        string
      > & { pricePerParticipantMxn: string | null; groupMarginMxn: string | null })
    | null;
  warnings: { code: string; message: string }[];
  reviews: { decision: 'APPROVED' | 'RETURNED'; reviewer: string; comment: string | null; at: string }[];
  deliveries: {
    recipients: string;
    channel: DeliveryChannel;
    sentOn: string;
    notes: string | null;
    sentBy: string;
  }[];
  createdById?: string;
}

export const isAuthorized = (s: QuoteVersionStatus) => s === 'APPROVED' || s === 'SENT';
export const CHANNEL_LABEL: Record<DeliveryChannel, string> = {
  EMAIL: 'Correo',
  WHATSAPP: 'WhatsApp',
  IN_PERSON: 'En persona',
  OTHER: 'Otro',
};

export const PENDING_LEGEND = 'VIAJE CON AUTORIZACIÓN PENDIENTE';

export interface ScenarioDto {
  id: string;
  name: string;
  versions: { id: string; number: number; status: QuoteVersionStatus }[];
  latest: QuoteDto;
}

export const QUOTE_STATUS_LABEL: Record<QuoteVersionStatus, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  RETURNED: 'Devuelta',
  APPROVED: 'Aprobada',
  SENT: 'Enviada',
  SUPERSEDED: 'Reemplazada',
};

export const CATEGORY_LABEL: Record<LineCategory, string> = {
  PER_PARTICIPANT: 'Por estudiante',
  PER_CHAPERONE: 'Por chaperón de la escuela',
  PER_STAFF: 'Por chaperón EE',
  PER_GROUP: 'Fijo del grupo',
  CONTINGENCY: 'Fondo de emergencia',
};

const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(`${iso}T00:00:00Z`)) : '—');
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

/** Privileges as people call them; APPROVER is "Autorizar viaje". */
export const ROLE_LABEL: Record<RoleName, string> = {
  ADVISOR: 'Asesor (crea solicitudes)',
  QUOTER: 'Cotizador',
  APPROVER: 'Autorizar viaje',
  OFFICE_ADMIN: 'Coordinador de oficina',
  SYSTEM_ADMIN: 'Administrador del sistema',
  AUDITOR: 'Auditor (solo lectura)',
};
