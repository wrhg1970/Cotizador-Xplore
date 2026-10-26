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

export const OfficeRoleInput = z.strictObject({ officeId: z.uuid(), role: RoleName });
export type OfficeRoleInput = z.infer<typeof OfficeRoleInput>;

export const InviteUser = z.strictObject({ email: Email, name: Name, officeId: z.uuid(), role: RoleName });
export type InviteUser = z.infer<typeof InviteUser>;

export const Me = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  roles: z.array(z.object({ officeId: z.uuid(), role: RoleName })),
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
};

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

export const VersionOnly = z.strictObject({ version: z.number().int().min(1) });
export const AssignRequest = z.strictObject({ assigneeId: z.uuid(), version: z.number().int().min(1) });
export const CancelRequest = z.strictObject({ reason: ShortText(1000), version: z.number().int().min(1) });
export const CreateComment = z.strictObject({ body: ShortText(2000) });

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
  source: ShortText(150),
});
export type FxRateInput = z.infer<typeof FxRateInput>;

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
