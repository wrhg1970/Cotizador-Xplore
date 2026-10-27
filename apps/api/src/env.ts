import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /** Public base URL of the API, used to build the OAuth redirect URI. */
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  // Optional until EE creates the OAuth client; login answers 503 meanwhile.
  GOOGLE_CLIENT_ID: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  GOOGLE_CLIENT_SECRET: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  ALLOWED_GOOGLE_DOMAINS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
  // Sheet importer (Gemini on Vertex AI, credentials from the runtime service account); off when unset.
  VERTEX_PROJECT: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  VERTEX_LOCATION: z.string().min(1).default('global'),
  VERTEX_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  // Workflow notices by email (dedicated Workspace account); off unless host, user and password are all set.
  SMTP_HOST: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  SMTP_PASSWORD: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  /** Defaults to SMTP_USER, e.g. "Cotizador EE <cotizador@estudiantesembajadores.com>". */
  MAIL_FROM: z
    .string()
    .optional()
    .transform((v) => v || undefined),
});
export type Env = z.infer<typeof Env>;
export const ENV = Symbol('ENV');

/** Fails fast at boot; never prints values, only the names of invalid variables. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variables de entorno inválidas o ausentes: ${names}`);
  }
  return parsed.data;
}
