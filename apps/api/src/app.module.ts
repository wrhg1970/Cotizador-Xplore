import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { GoogleOidcProvider, OIDC, type OidcProvider } from './auth/oidc.js';
import { SessionGuard } from './auth/session.guard.js';
import { ENV, type Env } from './env.js';
import { HealthController } from './health.controller.js';
import { PrismaShutdown, prismaProvider } from './prisma.service.js';
import { CatalogsController } from './catalogs.controller.js';
import { ConceptTemplatesController } from './concepts/concept-templates.controller.js';
import { OfficeQuotersController, RequestsController } from './requests/requests.controller.js';
import { QuotesController } from './quotes/quotes.controller.js';
import { QuoteTemplatesController } from './quotes/templates.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { RolePoliciesController } from './auth/role-policies.controller.js';
import { AuditLogController } from './audit-log/audit-log.controller.js';
import { SheetImportController } from './quotes/sheet-import.controller.js';
import { SHEET_READER, type SheetReader, VertexSheetReader } from './quotes/sheet-import.js';
import { UsersController } from './users/users.controller.js';

@Module({})
export class AppModule {
  static forRoot(env: Env, oidcOverride?: OidcProvider, readerOverride?: SheetReader): DynamicModule {
    const reader =
      readerOverride ??
      (env.VERTEX_PROJECT
        ? new VertexSheetReader(env.VERTEX_PROJECT, env.VERTEX_LOCATION, env.VERTEX_MODEL)
        : null);
    const oidc =
      oidcOverride ??
      (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? new GoogleOidcProvider(
            env.GOOGLE_CLIENT_ID,
            env.GOOGLE_CLIENT_SECRET,
            `${env.API_PUBLIC_URL}/api/v1/auth/google/callback`,
          )
        : null);
    return {
      module: AppModule,
      // shortcut: in-memory rate limit store, fine for one API instance; use a shared store when scaling out.
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 300 }],
          // Tests log in many times per minute; the limit itself is covered in a dedicated test.
          skipIf: () => env.NODE_ENV === 'test',
        }),
      ],
      controllers: [
        HealthController,
        AuthController,
        UsersController,
        RequestsController,
        OfficeQuotersController,
        CatalogsController,
        ConceptTemplatesController,
        QuotesController,
        QuoteTemplatesController,
        DashboardController,
        RolePoliciesController,
        AuditLogController,
        SheetImportController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: OIDC, useValue: oidc },
        { provide: SHEET_READER, useValue: reader },
        prismaProvider,
        PrismaShutdown,
        AuthService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
      ],
    };
  }
}
