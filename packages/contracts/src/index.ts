import { z } from 'zod';

/** Money travels as a decimal string in JSON (API_SPEC.md), never as a number. */
export const DecimalString = z.string().regex(/^-?\d+(\.\d{1,6})?$/, 'Importe decimal inválido');

export const CurrencyCode = z.enum(['MXN', 'USD', 'EUR', 'GBP', 'CAD', 'AUD']);
export type CurrencyCode = z.infer<typeof CurrencyCode>;

export const Money = z.object({ amount: DecimalString, currency: CurrencyCode });
export type Money = z.infer<typeof Money>;

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string(),
  details: z.array(z.unknown()),
});
export type ApiError = z.infer<typeof ApiError>;

export const HealthResponse = z.object({ status: z.literal('ok') });
export type HealthResponse = z.infer<typeof HealthResponse>;

export const RoleName = z.enum(['ADVISOR', 'QUOTER', 'APPROVER', 'OFFICE_ADMIN', 'SYSTEM_ADMIN', 'AUDITOR']);
export type RoleName = z.infer<typeof RoleName>;

const Email = z
  .email()
  .max(254)
  .transform((e) => e.toLowerCase());
const Name = z.string().trim().min(1).max(120);

export const CreateOffice = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{2,20}$/, 'Código: 2–20 mayúsculas, dígitos o guiones'),
  name: Name,
});
export type CreateOffice = z.infer<typeof CreateOffice>;
/** Rename, recode or (de)activate; deactivating keeps the office's history. */
export const UpdateOffice = CreateOffice.partial()
  .extend({ active: z.boolean().optional() })
  .refine((o) => Object.keys(o).length > 0, { message: 'Nada que cambiar' });
export type UpdateOffice = z.infer<typeof UpdateOffice>;

export const OfficeRoleInput = z.strictObject({ officeId: z.uuid(), role: RoleName });
export type OfficeRoleInput = z.infer<typeof OfficeRoleInput>;

export const InviteUser = z.strictObject({ email: Email, name: Name, officeId: z.uuid(), role: RoleName });
export type InviteUser = z.infer<typeof InviteUser>;
/** Offices a user works in (V2 "oficinas con acceso"); the user's privileges apply in each one. */
export const UserOffices = z.strictObject({ officeIds: z.array(z.uuid()).min(1).max(200) });
export type UserOffices = z.infer<typeof UserOffices>;

/** What each role may do beyond its fixed workflow steps; SYSTEM_ADMIN always has everything. */
export const RolePolicyInput = z
  .strictObject({
    /** Acts in every office, not only where it was granted (e.g. a national auditor). */
    allOffices: z.boolean(),
    /** "Ver": sees the office's requests at all; without it the office is invisible to this role. */
    canView: z.boolean(),
    /** "Crear": opens new requests. */
    canCreate: z.boolean(),
    /** "Editar": edits requests and quotes it takes part in (requester, quoter or coordinator). */
    canEdit: z.boolean(),
    /** "Borrar": cancels requests and retires other people's templates (nothing is hard-deleted). */
    canDelete: z.boolean(),
    /** Sees quotes with internal costs, margins and commissions. */
    viewInternalCosts: z.boolean(),
    /** Downloads the internal Excel; requires viewInternalCosts. */
    exportInternalXlsx: z.boolean(),
    /** Highest group price in MXN this role may approve; null = no limit. */
    approvalLimitMxn: z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Monto en pesos, hasta 2 decimales')
      .nullable(),
  })
  .refine((p) => p.viewInternalCosts || !p.exportInternalXlsx, {
    message: 'Para exportar el Excel interno hay que poder ver costos internos',
    path: ['exportInternalXlsx'],
  });
export type RolePolicyInput = z.infer<typeof RolePolicyInput>;
export const EditableRole = RoleName.exclude(['SYSTEM_ADMIN']);
export type EditableRole = z.infer<typeof EditableRole>;

export const Me = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.object({ officeId: z.uuid(), role: RoleName })),
  policies: z.partialRecord(EditableRole, RolePolicyInput).optional(),
});
export type Me = z.infer<typeof Me>;

// ---- Travel requests (PRD §6) ----

/** Sanity cap so a typo can't create a 10 000-person group; tune with EE. */
export const MAX_GROUP_SIZE = 1000;

const IsoDate = z.iso.date();
const ShortText = (max: number) => z.string().trim().min(1).max(max);
const OptionalText = (max: number) => z.string().trim().max(max).optional();

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' });
// Non-country ICU regions (EU, UN, pseudo-locales…); XK (Kosovo) is kept on purpose.
const NOT_COUNTRIES = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);

/** ISO 3166-1 alpha-2 country in ICU, excluding aliases like UK→GB (unknown codes echo back from DisplayNames). */
export const isCountryCode = (c: string): boolean =>
  /^[A-Z]{2}$/.test(c) &&
  !NOT_COUNTRIES.has(c) &&
  regionNames.of(c) !== c &&
  new Intl.Locale(`und-${c}`).region === c;

/** Countries with Spanish names, sorted; computed once. */
export const COUNTRIES: readonly { code: string; name: string }[] = Array.from({ length: 26 * 26 }, (_, i) =>
  String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
)
  .filter(isCountryCode)
  .map((code) => ({ code, name: regionNames.of(code)! }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'));

export const CountryCode = z.string().refine(isCountryCode, 'País no reconocido');

export const BudgetBasis = z.enum(['TOTAL', 'PER_PARTICIPANT']);
export const Budget = z.strictObject({
  amount: DecimalString.refine((a) => !a.startsWith('-'), 'El presupuesto no puede ser negativo'),
  currency: CurrencyCode,
  basis: BudgetBasis,
});
export type Budget = z.infer<typeof Budget>;

export const Priority = z.enum(['LOW', 'NORMAL', 'HIGH']);
export const RequestStatus = z.enum(['DRAFT', 'SUBMITTED', 'QUOTING', 'SENT', 'WON', 'LOST', 'CANCELLED']);
export type RequestStatus = z.infer<typeof RequestStatus>;

/** Structured trip details (V2 "Especificaciones"); each block is free text. */
export const TripSpecs = z.strictObject({
  accommodation: OptionalText(2000),
  receivingSchool: OptionalText(2000),
  courses: OptionalText(2000),
  transfersMeals: OptionalText(2000),
  flightsExcursions: OptionalText(2000),
  insuranceAccessibility: OptionalText(2000),
  notIncluded: OptionalText(2000),
});
export type TripSpecs = z.infer<typeof TripSpecs>;

const requestFields = {
  groupName: ShortText(150),
  clientName: OptionalText(150),
  program: OptionalText(150),
  city: ShortText(150),
  countryCode: CountryCode,
  departureDate: IsoDate,
  returnDate: IsoDate,
  participants: z.number().int().min(1).max(MAX_GROUP_SIZE),
  chaperones: z.number().int().min(0).max(MAX_GROUP_SIZE),
  staff: z.number().int().min(0).max(MAX_GROUP_SIZE),
  budget: Budget.nullable().optional(),
  requirements: OptionalText(4000),
  priority: Priority,
  dueDate: IsoDate.optional(),
  specifications: TripSpecs.nullable().optional(),
};

/** Every request field, each optional: what a sheet importer may propose for the form. */
export const RequestDraft = z.object(requestFields).partial();
export type RequestDraft = z.infer<typeof RequestDraft>;

const datesInOrder = (r: { departureDate?: string; returnDate?: string }) =>
  !r.departureDate || !r.returnDate || r.returnDate >= r.departureDate;
const datesMessage = { message: 'El regreso no puede ser anterior a la salida', path: ['returnDate'] };

export const CreateRequest = z
  .strictObject({
    officeId: z.uuid(),
    ...requestFields,
    // Defaults only on create: in a partial update they would silently reset stored values.
    chaperones: requestFields.chaperones.default(0),
    staff: requestFields.staff.default(0),
    priority: Priority.default('NORMAL'),
  })
  .refine(datesInOrder, datesMessage);
export type CreateRequest = z.infer<typeof CreateRequest>;

/** Partial edit; `version` is the optimistic-lock token the client last read (US-142). */
export const UpdateRequest = z
  .strictObject({ ...z.object(requestFields).partial().shape, version: z.number().int().min(1) })
  .refine(datesInOrder, datesMessage);
export type UpdateRequest = z.infer<typeof UpdateRequest>;

/** 3 MB file as base64 (4/3 overhead), sniffed server-side against an allowlist. */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const UploadAttachment = z.strictObject({
  fileName: ShortText(200),
  fileBase64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4),
});
/** Request team (V2): one commercial executive and up to 20 support people, all from the request's office. */
export const SetRequestTeam = z
  .strictObject({
    commercialExecutiveId: z.uuid().nullable(),
    supportIds: z.array(z.uuid()).max(20),
  })
  .refine(
    (t) =>
      new Set(t.supportIds).size === t.supportIds.length &&
      !t.supportIds.includes(t.commercialExecutiveId ?? ''),
    {
      message: 'Cada persona aparece una sola vez en el equipo',
      path: ['supportIds'],
    },
  );

/** School link (V2 portal): days until it stops working. */
/** The school's acceptance on the shared link: who signs and with what position. */
export const AcceptProposal = z.strictObject({
  signerName: ShortText(150),
  signerRole: ShortText(150),
  accepted: z.literal(true),
});

export const CreateProposalShare = z.strictObject({ days: z.number().int().min(1).max(90).default(30) });

export const VersionOnly = z.strictObject({ version: z.number().int().min(1) });
export const AssignRequest = z.strictObject({ assigneeId: z.uuid(), version: z.number().int().min(1) });
export const CancelRequest = z.strictObject({ reason: ShortText(1000), version: z.number().int().min(1) });
export const CreateComment = z.strictObject({ body: ShortText(2000) });
/** Client's answer to a sent request (PRD F-06): the one winning sent version, or why it was lost. */
export const RecordOutcome = z.discriminatedUnion('outcome', [
  z.strictObject({ outcome: z.literal('WON'), versionId: z.uuid(), version: z.number().int().min(1) }),
  z.strictObject({ outcome: z.literal('LOST'), reason: ShortText(1000), version: z.number().int().min(1) }),
]);

export const ListRequestsQuery = z.strictObject({
  officeId: z.uuid().optional(),
  status: RequestStatus.optional(),
  assignedToMe: z.enum(['true', 'false']).optional(),
  /** Folio (exact) or group name (contains). */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListRequestsQuery = z.infer<typeof ListRequestsQuery>;

export const QuoteVersionStatus = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'RETURNED',
  'APPROVED',
  'SENT',
  'SUPERSEDED',
]);
export type QuoteVersionStatus = z.infer<typeof QuoteVersionStatus>;

/** Per student, per client chaperone, per EE staff, fixed for the group, emergency fund. */
export const LineCategory = z.enum([
  'PER_PARTICIPANT',
  'PER_CHAPERONE',
  'PER_STAFF',
  'PER_GROUP',
  'CONTINGENCY',
]);
export type LineCategory = z.infer<typeof LineCategory>;

const NonNegative = DecimalString.refine((a) => !a.startsWith('-'), 'No puede ser negativo');
const groupCounts = {
  participants: requestFields.participants,
  chaperones: requestFields.chaperones,
  staff: requestFields.staff,
};

/** Counts default to the request's on the server, so they are optional here. */
export const CreateScenario = z.strictObject({
  name: ShortText(150),
  saleCurrency: CurrencyCode,
  /** Start from an office template instead of the catalog's base concepts. */
  templateId: z.uuid().optional(),
  ...z.object(groupCounts).partial().shape,
});
export type CreateScenario = z.infer<typeof CreateScenario>;

export const DuplicateScenario = z.strictObject({ name: ShortText(150) });

export const QuoteLineInput = z.strictObject({
  category: LineCategory,
  description: ShortText(300),
  quantity: NonNegative,
  unitCost: NonNegative,
  currency: CurrencyCode,
  internalOnly: z.boolean().default(false),
  costSource: OptionalText(300),
});
export type QuoteLineInput = z.infer<typeof QuoteLineInput>;

/** Units of the sale currency per 1 `fromCurrency`, frozen with its date and source (FORMULAS.md §11). */
export const FxRateInput = z.strictObject({
  fromCurrency: CurrencyCode,
  rate: DecimalString.refine((r) => Number(r) > 0, 'El tipo de cambio debe ser mayor que cero'),
  rateDate: IsoDate,
  source: z.string().trim().min(1, 'Indica la fuente del tipo de cambio (p. ej. Banxico)').max(150),
});
export type FxRateInput = z.infer<typeof FxRateInput>;

/** Official EE rate (V2 "Tipos de cambio oficiales"): units of `toCurrency` per 1 `fromCurrency`. */
export const OfficialRateInput = z
  .strictObject({
    fromCurrency: CurrencyCode,
    toCurrency: CurrencyCode,
    rate: DecimalString.refine((r) => Number(r) > 0, 'El tipo de cambio debe ser mayor que cero'),
    rateDate: IsoDate,
    source: ShortText(150),
  })
  .refine((r) => r.fromCurrency !== r.toCurrency, {
    message: 'Las monedas deben ser distintas',
    path: ['toCurrency'],
  });
export type OfficialRateInput = z.infer<typeof OfficialRateInput>;

/** Days before each overdue alert fires (Administración → Alertas); 0 turns that alert off. */
export const AlertSettings = z.strictObject({
  unquotedDays: z.number().int().min(0).max(90),
  reviewDays: z.number().int().min(0).max(90),
  sentNoAnswerDays: z.number().int().min(0).max(180),
  paymentReminderDays: z.number().int().min(0).max(60),
});
export type AlertSettings = z.infer<typeof AlertSettings>;
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  unquotedDays: 3,
  reviewDays: 2,
  sentNoAnswerDays: 7,
  paymentReminderDays: 5,
};

/** Registration + installments, per student; the schedule itself is computed by the engine. */
export const PaymentPlanInput = z
  .strictObject({
    depositRate: DecimalString.refine((r) => Number(r) > 0 && Number(r) < 1, 'Entre 0 y 100%').optional(),
    depositAmount: DecimalString.refine((a) => Number(a) > 0, 'Debe ser mayor que cero').optional(),
    depositDueDate: IsoDate.optional(),
    installments: z.number().int().min(1).max(15),
    frequency: z.enum(['MONTHLY', 'BIWEEKLY', 'WEEKLY']),
    firstDueDate: IsoDate,
  })
  .refine((p) => !(p.depositRate && p.depositAmount), {
    message: 'Inscripción en % o en monto, no ambas',
    path: ['depositAmount'],
  })
  .refine((p) => !(p.depositRate || p.depositAmount) || !!p.depositDueDate, {
    message: 'Falta la fecha de inscripción',
    path: ['depositDueDate'],
  })
  .refine((p) => !p.depositDueDate || p.depositDueDate <= p.firstDueDate, {
    message: 'La inscripción va antes del primer pago',
    path: ['firstDueDate'],
  });
export type PaymentPlanInput = z.infer<typeof PaymentPlanInput>;

export const ItineraryDay = z.strictObject({
  day: z.number().int().min(1).max(366),
  title: ShortText(200),
  details: OptionalText(2000),
});
export type ItineraryDay = z.infer<typeof ItineraryDay>;

export const FreePlaceBenefit = z.enum(['CHAPERONE', 'STUDENT']);

/** Proposal content shared by versions and templates. */
const proposalContent = {
  studentsPerFreePlace: z.number().int().min(1).max(100).nullable().optional(),
  freePlaceBenefit: FreePlaceBenefit.nullable().optional(),
  itinerary: z.array(ItineraryDay).max(120).nullable().optional(),
  exclusions: z.array(ShortText(300)).max(50).optional(),
  /** Image attachment (JPG/PNG) of the same request shown as the proposal's cover. */
  coverAttachmentId: z.uuid().nullable().optional(),
};

/** Draft edit. `lines` and `fxRates`, when present, replace the whole set (order = position). */
export const UpdateQuote = z
  .strictObject({
    ...z.object(groupCounts).partial().shape,
    saleCurrency: CurrencyCode.optional(),
    /** Margin over sale price, 0 ≤ rate < 1 (Finance's "% Comisión"). */
    targetMarginRate: DecimalString.refine(
      (r) => Number(r) >= 0 && Number(r) < 1,
      'El margen debe estar entre 0 y 1',
    ).optional(),
    /** MXN per 1 sale currency for the approximate peso price; null clears it. */
    mxnRate: DecimalString.refine((r) => Number(r) > 0, 'El tipo de cambio debe ser mayor que cero')
      .nullable()
      .optional(),
    /** Typed final price per participant (whole units); the server derives the margin from it. */
    targetPricePerParticipant: z
      .string()
      .regex(/^[1-9]\d{0,11}$/, 'El precio final debe ser un número entero mayor que cero')
      .optional(),
    validUntil: IsoDate.nullable().optional(),
    assumptions: OptionalText(4000).nullable(),
    lines: z.array(QuoteLineInput).max(500).optional(),
    fxRates: z.array(FxRateInput).max(10).optional(),
    paymentPlan: PaymentPlanInput.nullable().optional(),
    ...proposalContent,
    rowVersion: z.number().int().min(1),
  })
  .refine((q) => !(q.targetMarginRate && q.targetPricePerParticipant), {
    message: 'Captura el % de comisión o el precio final, no ambos',
    path: ['targetPricePerParticipant'],
  })
  .refine((q) => new Set(q.fxRates?.map((f) => f.fromCurrency)).size === (q.fxRates?.length ?? 0), {
    message: 'Un solo tipo de cambio por moneda',
    path: ['fxRates'],
  });
export type UpdateQuote = z.infer<typeof UpdateQuote>;

export const CreateQuoteTemplate = z.strictObject({ name: ShortText(150) });

/** Admin-maintained concept ("rubro") of the EE sheet. */
export const ConceptTemplateInput = z.strictObject({
  label: ShortText(300),
  category: LineCategory,
  internalOnly: z.boolean().default(false),
  isBase: z.boolean().default(false),
  perTripDay: z.boolean().default(false),
  position: z.number().int().min(0).max(10_000).default(0),
});
export type ConceptTemplateInput = z.infer<typeof ConceptTemplateInput>;

export const UpdateConceptTemplate = z
  .strictObject({
    label: ShortText(300),
    category: LineCategory,
    internalOnly: z.boolean(),
    isBase: z.boolean(),
    perTripDay: z.boolean(),
    position: z.number().int().min(0).max(10_000),
    active: z.boolean(),
  })
  .partial();
export type UpdateConceptTemplate = z.infer<typeof UpdateConceptTemplate>;

/** Approval actions carry the rowVersion the reviewer looked at (US-071, US-142). */
export const ReviewQuote = z.strictObject({
  rowVersion: z.number().int().min(1),
  comment: OptionalText(2000),
});
export const ReturnQuote = z.strictObject({ rowVersion: z.number().int().min(1), comment: ShortText(2000) });

export const DeliveryChannel = z.enum(['EMAIL', 'WHATSAPP', 'IN_PERSON', 'OTHER']);
export type DeliveryChannel = z.infer<typeof DeliveryChannel>;

/** Manual send of an authorized version: who got it, how and when (DATABASE.md ProposalDelivery). */
export const SendQuote = z.strictObject({
  rowVersion: z.number().int().min(1),
  recipients: ShortText(500),
  channel: DeliveryChannel,
  sentOn: IsoDate,
  notes: OptionalText(2000),
});

/** Sheet importer input: an uploaded .xlsx/.csv (base64, 3 MB max) or a public Google Sheets link. */
export const ImportSheet = z
  .strictObject({
    fileName: z.string().trim().max(200).optional(),
    fileBase64: z
      .string()
      .max(4_200_000, 'El archivo pesa más de 3 MB')
      .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Archivo inválido')
      .optional(),
    sheetUrl: z.url().max(500).optional(),
  })
  .refine((b) => (b.fileBase64 ? !b.sheetUrl && !!b.fileName : !!b.sheetUrl), {
    message: 'Sube un archivo o pega una liga de Google Sheets, no ambos',
  });
export type ImportSheet = z.infer<typeof ImportSheet>;

/** Audit log browser (admins and auditors); `action` matches a prefix such as "quote." or "quote.approved". */
export const ListAuditLogsQuery = z.strictObject({
  officeId: z.uuid().optional(),
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]{1,60}$/)
    .optional(),
  actorEmail: z.email().max(254).optional(),
  entityId: z.string().trim().max(64).optional(),
  /** A request and every quote version under it. */
  requestId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListAuditLogsQuery = z.infer<typeof ListAuditLogsQuery>;

/** Executive dashboard: requests created in [from, to], optionally one office. */
export const ExecutiveDashboardQuery = z
  .strictObject({
    officeId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'El inicio no puede ser posterior al fin' });
export type ExecutiveDashboardQuery = z.infer<typeof ExecutiveDashboardQuery>;

/** Global lists (V2 "Aprobaciones" and "Propuestas enviadas"). */
export const VersionListQuery = z.strictObject({ status: z.enum(['IN_REVIEW', 'SENT']) });
export type VersionListQuery = z.infer<typeof VersionListQuery>;
