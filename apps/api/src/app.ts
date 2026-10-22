import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import type { OidcProvider } from './auth/oidc.js';
import type { Env } from './env.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

const CORRELATION_ID = /^[A-Za-z0-9-]{1,64}$/;

export async function createApp(env: Env, oidc?: OidcProvider): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env, oidc), {
    logger: env.NODE_ENV === 'test' ? false : undefined,
  });
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
