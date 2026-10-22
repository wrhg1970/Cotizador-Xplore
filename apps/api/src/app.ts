import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { Env } from './env.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

export async function createApp(env: Env): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: env.NODE_ENV === 'test' ? false : undefined });
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());

  const openApi = new DocumentBuilder().setTitle('Cotizador EE API').setVersion('0.1.0').build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, openApi));
  return app;
}
