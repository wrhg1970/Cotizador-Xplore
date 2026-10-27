import type { INestApplication } from '@nestjs/common';
import { createPrismaClient, type Role } from '@ee/db';
import request from 'supertest';
import type { IdClaims, LoginChecks, OidcProvider } from '../src/auth/oidc.js';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import type { SheetReader } from '../src/quotes/sheet-import.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL es obligatorio para las pruebas de la API');

export const WEB = 'http://localhost:3000';
export const DOMAIN = 'ee-test.example';

export const testEnv = (overrides: Record<string, string> = {}) =>
  loadEnv({
    NODE_ENV: 'test',
    WEB_ORIGIN: WEB,
    DATABASE_URL,
    ALLOWED_GOOGLE_DOMAINS: DOMAIN,
    SESSION_SECRET: 'test-only-session-secret-0123456789abcdef',
    ...overrides,
  });

/** Mimics Google: state must round-trip, claims are whatever the test sets. */
export class FakeOidc implements OidcProvider {
  claims: IdClaims = { sub: 'nobody' };
  async authorizationUrl({ state }: LoginChecks): Promise<URL> {
    return new URL(`https://accounts.example/auth?state=${state}`);
  }
  async exchange(url: URL, checks: LoginChecks): Promise<IdClaims> {
    if (url.searchParams.get('state') !== checks.state) throw new Error('state mismatch');
    return this.claims;
  }
}

export const prisma = createPrismaClient(DATABASE_URL);

export async function makeApp(oidc = new FakeOidc(), reader?: SheetReader) {
  const app: INestApplication = await createApp(testEnv(), oidc, reader);
  await app.init();
  return { app, oidc, http: () => request(app.getHttpServer()) };
}

export const uniq = () => crypto.randomUUID().slice(0, 8);

export async function makeOffice() {
  return prisma.office.create({ data: { code: `T-${uniq()}`.toUpperCase(), name: 'Oficina prueba' } });
}

export async function makeUser(
  roles: { officeId: string; role: Role }[],
  status: 'INVITED' | 'ACTIVE' = 'INVITED',
) {
  const email = `u-${uniq()}@${DOMAIN}`;
  return prisma.user.create({
    data: { email, name: 'Usuario', status, officeRoles: { create: roles } },
  });
}

/** Runs the full fake login and returns the session cookie header. */
export async function loginAs(ctx: Awaited<ReturnType<typeof makeApp>>, email: string, sub = `sub-${email}`) {
  ctx.oidc.claims = { sub, email, email_verified: true, hd: DOMAIN, name: 'Usuario' };
  const start = await ctx.http().get('/api/v1/auth/google/login').expect(302);
  const state = new URL(start.headers.location as string).searchParams.get('state');
  const loginCookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
  const cb = await ctx
    .http()
    .get(`/api/v1/auth/google/callback?code=x&state=${state}`)
    .set('Cookie', loginCookie);
  const session = ((cb.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .map((c) => c.split(';')[0]!)
    .find((c) => c.startsWith('ee_session=') && c !== 'ee_session=');
  return { response: cb, cookie: session };
}
