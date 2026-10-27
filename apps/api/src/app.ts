import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import type { OidcProvider } from './auth/oidc.js';
import type { Mailer } from './notify/notifier.js';
import type { SheetReader } from './quotes/sheet-import.js';
import type { Env } from './env.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

const CORRELATION_ID = /^[A-Za-z0-9-]{1,64}$/;

const IMPORT_ROUTE = /^\/api\/v1\/quotes\/[^/]+\/import$/;

export async function createApp(
  env: Env,
  oidc?: OidcProvider,
  reader?: SheetReader,
  mailer?: Mailer,
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env, oidc, reader, mailer), {
    logger: env.NODE_ENV === 'test' ? false : undefined,
    bodyParser: false,
  });
  // Express's 100 kB default everywhere except the sheet upload (3 MB file as base64).
  const json = express.json();
  const importJson = express.json({ limit: '4500kb' });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (IMPORT_ROUTE.test(req.path) ? importJson : json)(req, res, next),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use(helmet());
  app.use(cookieParser(env.SESSION_SECRET));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.header('x-correlation-id');
    req.correlationId = incoming && CORRELATION_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger routes bypass Nest guards, so they stay off in production.
  if (env.NODE_ENV !== 'production') {
    const openApi = new DocumentBuilder().setTitle('Cotizador EE API').setVersion('0.1.0').build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, openApi));
  }
  return app;
}
