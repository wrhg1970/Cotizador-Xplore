import { Controller, ForbiddenException, Get, Inject, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { ExecutiveDashboardQuery, VersionListQuery } from '@ee/contracts';
import type { Prisma, PrismaClient } from '@ee/db';
import { D, type Dec, QuoteEngineError } from '@ee/quote-engine';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  canSeeInternalCosts,
  exportScope,
  hasOfficeRole,
  isSystemAdmin,
  officeScope,
} from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import { engine } from '../quotes/quotes.controller.js';
import { ZodPipe } from '../zod.pipe.js';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const inOffices = (scope: string[]): Prisma.TravelRequestWhereInput => ({ officeId: { in: scope } });
/** A version that no longer computes shows no figures instead of failing the list. */
const calc = (v: Parameters<typeof engine>[0]) => {
  try {
    return engine(v);
  } catch (e) {
    if (e instanceof QuoteEngineError) return null;
    throw e;
  }
};
// shortcut: unpaged, capped at LIMIT rows, fine for pilot volumes; page it if offices grow.
const LIMIT = 200;

/**
 * V2 extra screens: "Aprobaciones" and "Propuestas enviadas" across the user's offices (client
 * price only), and the internal financial report (costs and commission) for roles that may export.
 */
@Controller('reports')
export class ReportsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get('versions')
  async versions(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(VersionListQuery)) q: z.infer<typeof VersionListQuery>,
  ) {
    const rows = await this.prisma.quoteVersion.findMany({
      where: {
        // "Enviadas" traces every delivery, also of versions replaced since.
        ...(q.status === 'SENT'
          ? { deliveries: { some: {} } }
          : {
              status:
                q.status === 'APPROVAL'
                  ? { in: ['IN_REVIEW', 'APPROVED'] }
                  : (q.status ?? { not: 'SUPERSEDED' as const }),
            }),
        scenario: { request: { ...inOffices(officeScope(user)), status: { not: 'CANCELLED' } } },
      },
      orderBy: { updatedAt: 'desc' },
      take: LIMIT,
      include: {
        lines: true,
        fxRates: true,
        createdBy: { select: { name: true } },
        reviews: { orderBy: { createdAt: 'asc' }, select: { decision: true } },
        deliveries: {
          orderBy: { sentOn: 'desc' },
          take: 1,
          select: { sentOn: true, channel: true, recipients: true, notes: true },
        },
        scenario: {
          select: {
            name: true,
            request: {
              select: {
                id: true,
                folio: true,
                groupName: true,
                clientName: true,
                contactName: true,
                status: true,
                wonVersionId: true,
                officeId: true,
                assigneeId: true,
                departureDate: true,
                office: { select: { code: true, name: true } },
              },
            },
          },
        },
      },
    });
    const working = ['DRAFT', 'RETURNED'];
    const visible = rows.filter(
      (v) => !working.includes(v.status) || canSeeInternalCosts(user, v.scenario.request.officeId),
    );
    return visible.map((v) => {
      const r = v.scenario.request;
      const t = calc(v);
      const lastReturn = v.reviews.findLastIndex((x) => x.decision === 'RETURNED');
      return {
        id: v.id,
        status: v.status,
        label: `${v.scenario.name} · v${v.number}`,
        request: {
          id: r.id,
          folio: r.folio,
          groupName: r.groupName,
          clientName: r.clientName,
          contactName: r.contactName,
          status: r.status,
          wonVersionId: r.wonVersionId,
          officeCode: r.office.code,
          officeName: r.office.name,
          departureDate: day(r.departureDate),
        },
        scenarioName: v.scenario.name,
        number: v.number,
        participants: v.participants,
        chaperones: v.chaperones,
        price: t?.pricePerParticipant.toFixed(2) ?? null,
        groupPrice: t?.groupPrice.toFixed(2) ?? null,
        // Internal figure: only for roles that see costs in that office.
        ...(canSeeInternalCosts(user, r.officeId) && {
          marginRate: t && t.groupPrice.gt(0) ? t.groupMargin.div(t.groupPrice).toFixed(4) : null,
        }),
        /** Signatures given since the last return; 1 while a two-signature version waits for the second. */
        signatures: v.reviews.slice(lastReturn + 1).filter((x) => x.decision === 'APPROVED').length,
        currency: v.saleCurrency,
        preparedBy: v.createdBy.name,
        updatedAt: v.updatedAt.toISOString(),
        sentOn: day(v.deliveries[0]?.sentOn ?? null),
        channel: v.deliveries[0]?.channel ?? null,
        ...(v.deliveries[0] && {
          recipients: v.deliveries[0].recipients,
          // Notes that QuotesController.send / HistoryController write; anything else was logged by hand.
          sentVia: v.deliveries[0].notes?.includes('desde el cotizador')
            ? 'APP'
            : v.deliveries[0].notes === 'Histórico importado de Excel'
              ? 'HISTORY'
              : 'MANUAL',
        }),
        // Same rule as QuotesController.assertReviewer, so the list only offers what will be accepted.
        canApprove:
          v.status === 'IN_REVIEW' &&
          hasOfficeRole(user, r.officeId, ['APPROVER']) &&
          v.createdById !== user.id &&
          r.assigneeId !== user.id,
      };
    });
  }

  /** Won trips departing in the period, with cost and commission from the winning version. Internal use. */
  @Get('financial.xlsx')
  async financial(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
    @Query(new ZodPipe(ExecutiveDashboardQuery)) q: z.infer<typeof ExecutiveDashboardQuery>,
  ) {
    const scope = exportScope(user);
    if (scope.length === 0)
      throw new ForbiddenException('Tu rol no tiene permiso para descargar reportes internos');
    if (q.officeId && !scope.includes(q.officeId)) throw new ForbiddenException();
    const year = new Date().getUTCFullYear();
    const from = q.from ?? `${year}-01-01`;
    const to = q.to ?? `${year}-12-31`;
    const rows = await this.prisma.travelRequest.findMany({
      where: {
        ...(q.officeId ? { officeId: q.officeId } : inOffices(scope)),
        status: 'WON',
        departureDate: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: [{ departureDate: 'asc' }, { folio: 'asc' }],
      take: 2000,
      include: {
        office: { select: { code: true } },
        wonVersion: { include: { lines: true, fxRates: true, scenario: { select: { name: true } } } },
      },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ganadas');
    ws.addRow([`USO INTERNO: contiene costos y comisión · salidas del ${from} al ${to}`]).font = {
      bold: true,
    };
    ws.addRow([]);
    const head = ws.addRow([
      'Folio',
      'Oficina',
      'Grupo',
      'Salida',
      'Propuesta',
      'Estudiantes',
      'Moneda',
      'Precio por estudiante',
      'Venta total',
      'Costo total',
      'Comisión',
      '% comisión',
    ]);
    head.font = { bold: true };
    const sums: Record<string, { sale: Dec; cost: Dec; margin: Dec }> = {};
    for (const r of rows) {
      const v = r.wonVersion!;
      const t = calc(v);
      const sale = t?.groupPrice;
      const margin = t?.groupMargin;
      const cost = sale && margin ? sale.minus(margin) : undefined;
      if (sale && cost && margin) {
        const s = (sums[v.saleCurrency] ??= { sale: new D(0), cost: new D(0), margin: new D(0) });
        s.sale = s.sale.plus(sale);
        s.cost = s.cost.plus(cost);
        s.margin = s.margin.plus(margin);
      }
      // Money stays exact until here; Excel needs numbers to sum.
      ws.addRow([
        r.folio,
        r.office.code,
        r.groupName,
        day(r.departureDate),
        `${v.scenario.name} · v${v.number}`,
        v.participants,
        v.saleCurrency,
        t ? Number(t.pricePerParticipant.toFixed(2)) : 'No calcula',
        sale ? Number(sale.toFixed(2)) : null,
        cost ? Number(cost.toFixed(2)) : null,
        margin ? Number(margin.toFixed(2)) : null,
        sale && margin && !sale.isZero() ? Number(margin.div(sale).toFixed(4)) : null,
      ]);
    }
    ws.addRow([]);
    for (const [currency, s] of Object.entries(sums))
      ws.addRow([
        `Total ${currency}`,
        '',
        '',
        '',
        '',
        '',
        currency,
        null,
        Number(s.sale.toFixed(2)),
        Number(s.cost.toFixed(2)),
        Number(s.margin.toFixed(2)),
        s.sale.isZero() ? null : Number(s.margin.div(s.sale).toFixed(4)),
      ]).font = { bold: true };
    for (const c of [8, 9, 10, 11]) ws.getColumn(c).numFmt = '#,##0.00';
    ws.getColumn(12).numFmt = '0.00%';
    ws.getColumn(3).width = 32;
    ws.getColumn(5).width = 24;

    await audit(this.prisma, {
      actorUserId: user.id,
      action: 'report.financial_exported',
      entityType: q.officeId ? 'Office' : 'Report',
      entityId: q.officeId ?? 'financial',
      correlationId: req.correlationId,
      diff: { from, to, rows: rows.length },
    });
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment(`reporte-financiero-${from}-${to}.xlsx`)
      .send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
}

/** V2 "Integraciones": which connectors this deployment has configured. Never returns the secrets. */
@Controller('integrations')
export class IntegrationsController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get()
  status(@CurrentUser() user: AuthUser) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo el administrador del sistema');
    const e = this.env;
    return [
      { key: 'GOOGLE', name: 'Inicio de sesión con Google', configured: !!e.GOOGLE_CLIENT_ID },
      {
        key: 'MAIL',
        name: 'Avisos por correo',
        configured: !!(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASSWORD),
      },
      { key: 'VERTEX', name: 'Importar hojas con IA (Gemini)', configured: !!e.VERTEX_PROJECT },
      { key: 'WETRAVEL', name: 'WeTravel (ligas de pago)', configured: !!e.WETRAVEL_API_KEY },
      { key: 'BANXICO', name: 'Tipo de cambio Banxico (FIX)', configured: !!e.BANXICO_TOKEN },
      { key: 'CRON', name: 'Tareas diarias programadas', configured: !!e.CRON_SECRET },
      // No public API yet: waiting on Wissify's documentation and test credentials.
      { key: 'WISSIFY', name: 'Wissify', configured: false },
    ];
  }
}
