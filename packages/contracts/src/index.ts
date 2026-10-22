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
