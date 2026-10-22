import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';

const env = loadEnv({
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://unused@localhost/unused',
});

describe('API', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp(env);
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /api/v1/health returns only status', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('unknown routes use the API error shape with a correlation id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', details: [] });
    expect(res.body.correlationId).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.(ts|js)/);
  });

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(res.body.info.title).toBe('Cotizador EE API');
  });
});

describe('loadEnv', () => {
  it('fails fast naming missing variables without echoing values', () => {
    expect(() => loadEnv({ WEB_ORIGIN: 'http://x', DATABASE_URL: 'mysql://secret' })).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ WEB_ORIGIN: 'http://x', DATABASE_URL: 'mysql://secret' })).not.toThrow(/secret/);
  });
});
