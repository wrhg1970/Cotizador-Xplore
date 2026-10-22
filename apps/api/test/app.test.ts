import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { makeApp, prisma } from './helpers.js';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});

describe('API', () => {
  it('GET /api/v1/health is public and returns only status', async () => {
    const res = await ctx.http().get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('errors use the API shape and echo a safe correlation id', async () => {
    const res = await ctx.http().get('/api/v1/nope').set('x-correlation-id', 'abc-123').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', correlationId: 'abc-123', details: [] });
    const evil = await ctx.http().get('/api/v1/nope').set('x-correlation-id', '<script>');
    expect(evil.body.correlationId).not.toContain('<');
  });

  it('serves the OpenAPI document outside production', async () => {
    const res = await ctx.http().get('/api/docs-json').expect(200);
    expect(res.body.info.title).toBe('Cotizador EE API');
  });
});

describe('loadEnv', () => {
  const base = {
    WEB_ORIGIN: 'http://x',
    DATABASE_URL: 'postgresql://x',
    ALLOWED_GOOGLE_DOMAINS: 'a.example',
    SESSION_SECRET: 'x'.repeat(32),
  };
  it('fails fast naming bad variables without echoing values', () => {
    const bad = { ...base, DATABASE_URL: 'mysql://secret' };
    expect(() => loadEnv(bad)).toThrow(/DATABASE_URL/);
    expect(() => loadEnv(bad)).not.toThrow(/secret/);
    expect(() => loadEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });
  it('normalises allowed domains', () => {
    expect(
      loadEnv({ ...base, ALLOWED_GOOGLE_DOMAINS: ' A.example, b.example ' }).ALLOWED_GOOGLE_DOMAINS,
    ).toEqual(['a.example', 'b.example']);
  });
});

describe('without Google credentials', () => {
  it('login answers 503 with a clear message instead of crashing', async () => {
    const { createApp } = await import('../src/app.js');
    const { testEnv } = await import('./helpers.js');
    const app = await createApp(testEnv());
    await app.init();
    try {
      const request = (await import('supertest')).default;
      const res = await request(app.getHttpServer()).get('/api/v1/auth/google/login').expect(503);
      expect(res.body.message).toMatch(/no está configurado/);
    } finally {
      await app.close();
    }
  });
});
