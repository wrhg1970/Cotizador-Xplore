import type {
  Budget,
  CurrencyCode,
  DeliveryChannel,
  LineCategory,
  QuoteVersionStatus,
  RequestStatus,
  RoleName,
  TripSpecs,
} from '@ee/contracts';

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: { officeId: string; role: string }[];
  policies?: Partial<Record<string, RolePolicy>>;
}

export interface RolePolicy {
  allOffices: boolean;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  viewInternalCosts: boolean;
  exportInternalXlsx: boolean;
  approvalLimitMxn: string | null;
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
  specifications: TripSpecs | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  dueDate: string | null;
  cancelReason: string | null;
  wonVersionId: string | null;
  lostReason: string | null;
  closedAt: string | null;
  wetravelUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficialRateDto {
  id: string;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: string;
  rateDate: string;
  source: string;
  capturedBy: string;
  createdAt: string;
}

/** V2 "Especificaciones" blocks, in display order. */
export const SPEC_LABEL: Record<keyof TripSpecs, string> = {
  accommodation: 'Alojamiento',
  receivingSchool: 'Escuela / proveedor receptor',
  courses: 'Cursos y actividades',
  transfersMeals: 'Traslados y alimentación',
  flightsExcursions: 'Vuelos y excursiones',
  insuranceAccessibility: 'Seguro y accesibilidad',
  notIncluded: 'Servicios no incluidos',
};

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
  'request.won': 'Registró la solicitud como ganada',
  'request.lost': 'Registró la solicitud como perdida',
  'request.wetravel_link': 'Creó la liga de pago en WeTravel',
  'request.commented': 'Comentó',
  'quote.scenario.created': 'Creó un escenario',
  'quote.scenario.duplicated': 'Duplicó un escenario',
  'quote.version.created': 'Creó una versión',
  'quote.version.updated': 'Editó la cotización',
  'quote.import_previewed': 'Importó una hoja con IA (vista previa)',
  'official_rate.published': 'Publicó un tipo de cambio oficial',
  'request.attachment_added': 'Agregó un archivo',
  'request.attachment_removed': 'Quitó un archivo',
  'request.team_updated': 'Cambió el equipo de la solicitud',
  'proposal.share_created': 'Creó una liga para el colegio',
  'proposal.share_revoked': 'Revocó una liga para el colegio',
  'report.financial_exported': 'Descargó el reporte financiero',
  'request.import_previewed': 'Importó una solicitud desde una hoja con IA (vista previa)',
  'quote.submitted_for_approval': 'Envió a autorización',
  'quote.approved': 'Autorizó la cotización',
  'quote.rejected_for_changes': 'Devolvió la cotización',
  'quote.sent': 'Registró el envío al cliente',
  'quote_template.created': 'Guardó una plantilla',
  'quote_template.retired': 'Retiró una plantilla',
  'concept_template.created': 'Agregó un rubro al catálogo',
  'concept_template.updated': 'Editó un rubro del catálogo',
  'role_policy.updated': 'Cambió permisos de un rol',
  'office.created': 'Creó una oficina',
  'office.updated': 'Modificó una oficina',
  'office.deleted': 'Borró una oficina',
  'user.role_granted': 'Dio un rol',
  'user.offices_updated': 'Cambió las oficinas de un usuario',
  'user.role_revoked': 'Quitó un rol',
  'user.disabled': 'Desactivó un usuario',
  'auth.login': 'Inició sesión',
  'auth.logout': 'Cerró sesión',
  'auth.login_rejected': 'Inicio de sesión rechazado',
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
      > & {
        pricePerParticipantMxn: string | null;
        groupMarginMxn: string | null;
        /** Per line, in sale currency, headcount applied. */
        lineTotals: string[];
      })
    | null;
  paymentPlan: PaymentPlanDto | null;
  studentsPerFreePlace: number | null;
  freePlaceBenefit: 'CHAPERONE' | 'STUDENT' | null;
  itinerary: ItineraryDayDto[] | null;
  exclusions: string[];
  coverAttachmentId: string | null;
  /** Per student, computed from the rounded price; null without a plan or totals. */
  paymentSchedule: PaymentDto[] | null;
  freePlaces: number | null;
  /** EE sheet subtotals; null like `totals` while FX is missing. */
  sheet: Record<
    | 'chaperonesTotal'
    | 'emergencyFund'
    | 'totalChaperones'
    | 'leaderPerParticipant'
    | 'groupFixedTotal'
    | 'groupFixedPerParticipant',
    string
  > | null;
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

/** Blocks of the EE sheet, in the order Finance reads them. */
export const SHEET_BLOCKS: { category: LineCategory; title: string; hint: string }[] = [
  { category: 'PER_PARTICIPANT', title: 'Conceptos por estudiante', hint: 'Lo que paga cada estudiante.' },
  {
    category: 'PER_STAFF',
    title: 'Chaperones EE',
    hint: 'Costo por chaperón; se multiplica por los chaperones EE.',
  },
  {
    category: 'PER_CHAPERONE',
    title: 'Chaperones de la escuela',
    hint: 'Costo por chaperón; se multiplica por los chaperones de la escuela.',
  },
  { category: 'CONTINGENCY', title: 'Fondo de emergencia', hint: 'Monto total para el grupo.' },
  { category: 'PER_GROUP', title: 'Fijos del grupo', hint: 'Monto total; se reparte entre los estudiantes.' },
];

export interface PaymentPlanDto {
  depositRate?: string;
  depositAmount?: string;
  depositDueDate?: string;
  installments: number;
  frequency: 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';
  firstDueDate: string;
}
export interface PaymentDto {
  number: number;
  dueDate: string;
  amount: string;
}
export interface ItineraryDayDto {
  day: number;
  title: string;
  details?: string;
}
export const FREQUENCY_LABEL: Record<PaymentPlanDto['frequency'], string> = {
  MONTHLY: 'Mensual',
  BIWEEKLY: 'Quincenal',
  WEEKLY: 'Semanal',
};
export const FREE_PLACE_LABEL = { CHAPERONE: 'chaperón', STUDENT: 'beca para estudiante' } as const;
export const paymentLabel = (p: PaymentDto, count: number) =>
  p.number === 0 ? 'Inscripción' : `Pago ${p.number} de ${count}`;

export interface QuoteTemplateDto {
  id: string;
  name: string;
  saleCurrency: CurrencyCode;
  lineCount: number;
  createdBy: string;
  createdById: string;
  createdAt: string;
}

export interface ConceptTemplateDto {
  id: string;
  label: string;
  category: LineCategory;
  internalOnly: boolean;
  isBase: boolean;
  perTripDay: boolean;
  position: number;
  active: boolean;
}

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
  AUDITOR: 'Auditor / Finanzas (solo lectura)',
};

export interface SupplierRateDto {
  id: string;
  description: string;
  category: LineCategory;
  unitCost: string;
  currency: CurrencyCode;
  validUntil: string | null;
  notes: string | null;
  active: boolean;
}
export interface SupplierDto {
  id: string;
  name: string;
  kind: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  rates: SupplierRateDto[];
}
