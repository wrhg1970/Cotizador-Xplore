import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith('postgresql://'),
});
export type Env = z.infer<typeof Env>;

/** Fails fast at boot; never prints values, only the names of invalid variables. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Env.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variables de entorno inválidas o ausentes: ${names}`);
  }
  return parsed.data;
}
