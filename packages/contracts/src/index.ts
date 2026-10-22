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
