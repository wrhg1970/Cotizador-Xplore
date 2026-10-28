import {
  BadGatewayException,
  BadRequestException,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@ee/db';
import { alertSettings } from '../alerts/alerts.js';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/session.guard.js';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import { full, toDto } from '../quotes/quotes.controller.js';
import { canView } from '../requests/request-policy.js';
import { hasOfficeRole } from '../auth/authz.js';
import { parseEmails, paymentReminderMail } from './client-mail.js';
import { MAILER, type Mailer } from './notifier.js';

const ACTION = 'request.payment_reminder_sent';
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const wonRequests = (prisma: PrismaClient, where: { id?: string } = {}) =>
  prisma.travelRequest.findMany({
    where: { ...where, status: 'WON', wonVersionId: { not: null } },
    include: { wonVersion: { include: full } },
  });
type Won = Awaited<ReturnType<typeof wonRequests>>[number];

/** The school's addresses: the latest email send of the winning proposal. */
const schoolEmails = (r: Won) =>
  r
    .wonVersion!.deliveries.filter((d) => d.channel === 'EMAIL')
    .map((d) => parseEmails(d.recipients))
    .findLast((to) => to !== null) ?? null;

async function remind(
  prisma: PrismaClient,
  mailer: Mailer,
  origin: string,
  r: Won,
  p: { number: number; dueDate: string; amount: string },
  to: string[],
  actorUserId: string | null,
  correlationId: string,
) {
  await mailer.send(
    paymentReminderMail({
      to,
      folio: r.folio,
      groupName: r.groupName,
      number: p.number,
      dueDate: p.dueDate,
      amount: p.amount,
      currency: r.wonVersion!.saleCurrency,
      url: r.wetravelUrl,
      origin,
    }),
  );
  await audit(prisma, {
    actorUserId,
    action: ACTION,
    entityType: 'TravelRequest',
    entityId: r.id,
    correlationId,
    diff: { number: p.number, dueDate: p.dueDate, recipients: to.length },
  });
}

/**
 * Daily job: emails the school once per payment that falls due within "Recordatorio de pagos" days
 * (Administración). Idempotent through the audit log, so a rerun or a weekend gap never repeats one.
 */
export async function sendPaymentReminders(
  prisma: PrismaClient,
  mailer: Mailer,
  origin: string,
  now = new Date(),
) {
  const { paymentReminderDays: days } = await alertSettings(prisma);
  if (!days) return { skipped: 'off' };
  const today = iso(now);
  const until = iso(new Date(now.getTime() + days * DAY));
  let sent = 0;
  let failed = 0;
  for (const r of await wonRequests(prisma)) {
    const to = schoolEmails(r);
    if (!r.wonVersion?.paymentPlan || !to) continue;
    for (const p of toDto(r.wonVersion).paymentSchedule ?? []) {
      if (p.dueDate < today || p.dueDate > until) continue;
      const done = await prisma.auditLog.findFirst({
        where: { action: ACTION, entityId: r.id, diff: { path: ['number'], equals: p.number } },
        select: { id: true },
      });
      if (done) continue;
      try {
        await remind(prisma, mailer, origin, r, p, to, null, `cron-${today}`);
        sent++;
      } catch {
        failed++; // retried on the next run: nothing was audited
      }
    }
  }
  return { sent, failed };
}

const uuid = new ParseUUIDPipe({ version: '4' });

@Controller('requests')
export class PaymentRemindersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(MAILER) private readonly mailer: Mailer | null,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** "Enviar recordatorio de pago": the next payment due, to the school, right now. */
  @Post(':id/payment-reminder')
  async send(@CurrentUser() user: AuthUser, @Req() req: Request, @Param('id', uuid) id: string) {
    const [r] = await wonRequests(this.prisma, { id });
    if (!r || !canView(user, r)) throw new NotFoundException('Solicitud no encontrada');
    if (!(
      r.assigneeId === user.id ||
      r.requesterId === user.id ||
      hasOfficeRole(user, r.officeId, ['OFFICE_ADMIN'])
    ))
      throw new ForbiddenException('Solo el vendedor, el cotizador o el coordinador de la solicitud');
    if (!this.mailer) throw new ServiceUnavailableException('El correo del cotizador no está configurado');
    const to = schoolEmails(r);
    if (!to)
      throw new BadRequestException({
        code: 'NO_SCHOOL_EMAIL',
        message: 'La propuesta ganadora no se envió por correo; no hay a quién recordarle',
      });
    const today = iso(new Date());
    const next = (toDto(r.wonVersion!).paymentSchedule ?? []).find((p) => p.dueDate >= today);
    if (!next)
      throw new BadRequestException({
        code: 'NO_PAYMENT_DUE',
        message: 'No hay pagos pendientes en el plan',
      });
    try {
      await remind(this.prisma, this.mailer, this.env.WEB_ORIGIN, r, next, to, user.id, req.correlationId);
    } catch {
      throw new BadGatewayException('No se pudo enviar el correo; intenta de nuevo');
    }
    return { number: next.number, dueDate: next.dueDate, recipients: to.length };
  }
}
