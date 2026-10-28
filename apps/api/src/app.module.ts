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
import { SuppliersController } from './suppliers/suppliers.controller.js';
import { OfficeQuotersController, RequestsController } from './requests/requests.controller.js';
import { QuotesController } from './quotes/quotes.controller.js';
import { QuoteTemplatesController } from './quotes/templates.controller.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { RolePoliciesController } from './auth/role-policies.controller.js';
import { AuditLogController } from './audit-log/audit-log.controller.js';
import { RequestImportController, SheetImportController } from './quotes/sheet-import.controller.js';
import { SHEET_READER, type SheetReader, VertexSheetReader } from './quotes/sheet-import.js';
import { MAILER, type Mailer, Notifier, SmtpMailer } from './notify/notifier.js';
import { UsersController } from './users/users.controller.js';
import { OfficialRatesController } from './rates/official-rates.controller.js';
import { AttachmentsController } from './requests/attachments.controller.js';
import { RequestTeamController } from './requests/team.controller.js';
import { ProposalShareController } from './quotes/share.controller.js';
import { IntegrationsController, ReportsController } from './reports/reports.controller.js';
import { HttpWeTravel, type WeTravel, WETRAVEL } from './integrations/wetravel.js';
import { BANXICO, type Banxico, HttpBanxico } from './rates/banxico.js';
import { CronController } from './cron/cron.controller.js';
import { SchoolsController } from './schools/schools.controller.js';
import { SettingsController } from './alerts/alerts.controller.js';
import { AgencyController } from './agency/agency.controller.js';

@Module({})
export class AppModule {
  static forRoot(
    env: Env,
    oidcOverride?: OidcProvider,
    readerOverride?: SheetReader,
    mailerOverride?: Mailer,
    wetravelOverride?: WeTravel,
    banxicoOverride?: Banxico,
  ): DynamicModule {
    const banxico = banxicoOverride ?? (env.BANXICO_TOKEN ? new HttpBanxico(env.BANXICO_TOKEN) : null);
    const wetravel =
      wetravelOverride ??
      (env.WETRAVEL_API_KEY ? new HttpWeTravel(env.WETRAVEL_API_URL, env.WETRAVEL_API_KEY) : null);
    const mailer =
      mailerOverride ??
      (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD
        ? new SmtpMailer(
            { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, password: env.SMTP_PASSWORD },
            env.MAIL_FROM ?? env.SMTP_USER,
          )
        : null);
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
        SuppliersController,
        QuotesController,
        QuoteTemplatesController,
        DashboardController,
        RolePoliciesController,
        AuditLogController,
        SheetImportController,
        RequestImportController,
        OfficialRatesController,
        AttachmentsController,
        RequestTeamController,
        ProposalShareController,
        ReportsController,
        IntegrationsController,
        CronController,
        SettingsController,
        AgencyController,
        SchoolsController,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: OIDC, useValue: oidc },
        { provide: SHEET_READER, useValue: reader },
        { provide: MAILER, useValue: mailer },
        { provide: WETRAVEL, useValue: wetravel },
        { provide: BANXICO, useValue: banxico },
        Notifier,
        prismaProvider,
        PrismaShutdown,
        AuthService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
      ],
    };
  }
}
