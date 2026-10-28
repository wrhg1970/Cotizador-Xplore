import { AlertSettings, DEFAULT_ALERT_SETTINGS } from '@ee/contracts';
import type { PrismaClient } from '@ee/db';
import type { Mailer } from '../notify/notifier.js';
import { getSetting } from '../settings/settings.js';
import { full, toDto } from '../quotes/quotes.controller.js';

export type AlertKind = 'UNQUOTED' | 'REVIEW_PENDING' | 'SENT_NO_ANSWER' | 'PAYMENT_DUE';

export interface Alert {
  kind: AlertKind;
  requestId: string;
  folio: string;
  groupName: string;
  quoteId: string | null;
  /** Free text without prices: it also goes by email. */
  detail: string;
  /** Who should act; never sent to the client. */
  userIds: string[];
}

export const ALERT_LABEL: Record<AlertKind, string> = {
  UNQUOTED: 'Solicitud sin cotizar',
  REVIEW_PENDING: 'Autorización pendiente',
  SENT_NO_ANSWER: 'Propuesta sin respuesta',
  PAYMENT_DUE: 'Pago por vencer',
};

export const ALERTS_KEY = 'alerts';

export const alertSettings = (prisma: PrismaClient, agencyId: string) =>
  getSetting(prisma, agencyId, ALERTS_KEY, AlertSettings, DEFAULT_ALERT_SETTINGS);

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const startOfDay = (d: Date) => new Date(`${iso(d)}T00:00:00Z`);
const daysBetween = (from: Date, to: Date) =>
  Math.floor((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
const plural = (n: number) => (n === 1 ? '1 día' : `${n} días`);
const uniq = (ids: (string | null)[]) => [...new Set(ids.filter((x): x is string => !!x))];

// shortcut: scans every open request of the offices on each call; fine for pilot volumes, page it if it slows down.
/** Everything overdue as of `now` in these offices (one agency's), per its thresholds; 0 turns an alert off. */
export async function computeAlerts(
  prisma: PrismaClient,
  officeIds: string[],
  s: AlertSettings,
  now = new Date(),
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const inOffices = { officeId: { in: officeIds } };
  const cutoff = (days: number) => new Date(startOfDay(now).getTime() - (days - 1) * DAY);

  if (s.unquotedDays) {
    const rows = await prisma.travelRequest.findMany({
      where: {
        ...inOffices,
        status: { in: ['SUBMITTED', 'QUOTING'] },
        createdAt: { lt: cutoff(s.unquotedDays) },
        scenarios: { none: { versions: { some: { status: { in: ['IN_REVIEW', 'APPROVED', 'SENT'] } } } } },
      },
      select: { id: true, folio: true, groupName: true, createdAt: true, assigneeId: true, officeId: true },
    });
    const admins = await prisma.userOfficeRole.findMany({
      where: { role: 'OFFICE_ADMIN', officeId: { in: rows.map((r) => r.officeId) } },
      select: { officeId: true, userId: true },
    });
    for (const r of rows)
      alerts.push({
        kind: 'UNQUOTED',
        requestId: r.id,
        folio: r.folio,
        groupName: r.groupName,
        quoteId: null,
        detail: `Lleva ${plural(daysBetween(r.createdAt, now))} sin cotización enviada a autorizar`,
        userIds: r.assigneeId
          ? [r.assigneeId]
          : uniq(admins.filter((a) => a.officeId === r.officeId).map((a) => a.userId)),
      });
  }

  if (s.reviewDays) {
    const rows = await prisma.quoteVersion.findMany({
      where: {
        status: 'IN_REVIEW',
        updatedAt: { lt: cutoff(s.reviewDays) },
        scenario: { request: inOffices },
      },
      select: {
        id: true,
        updatedAt: true,
        createdById: true,
        scenario: {
          select: {
            request: { select: { id: true, folio: true, groupName: true, officeId: true, assigneeId: true } },
          },
        },
      },
    });
    const approvers = await prisma.userOfficeRole.findMany({
      where: { role: 'APPROVER', officeId: { in: rows.map((v) => v.scenario.request.officeId) } },
      select: { officeId: true, userId: true },
    });
    for (const v of rows) {
      const r = v.scenario.request;
      // Same rule as the review itself: never whoever built or quotes this version.
      const quoters = [v.createdById, r.assigneeId];
      alerts.push({
        kind: 'REVIEW_PENDING',
        requestId: r.id,
        folio: r.folio,
        groupName: r.groupName,
        quoteId: v.id,
        detail: `Espera autorización desde hace ${plural(daysBetween(v.updatedAt, now))}`,
        userIds: uniq(
          approvers
            .filter((a) => a.officeId === r.officeId && !quoters.includes(a.userId))
            .map((a) => a.userId),
        ),
      });
    }
  }

  if (s.sentNoAnswerDays) {
    const rows = await prisma.travelRequest.findMany({
      where: { ...inOffices, status: 'SENT' },
      select: {
        id: true,
        folio: true,
        groupName: true,
        requesterId: true,
        assigneeId: true,
        scenarios: {
          select: { versions: { select: { id: true, deliveries: { select: { sentOn: true } } } } },
        },
      },
    });
    for (const r of rows) {
      const sent = r.scenarios
        .flatMap((sc) => sc.versions.flatMap((v) => v.deliveries.map((d) => ({ id: v.id, on: d.sentOn }))))
        .sort((a, b) => b.on.getTime() - a.on.getTime())[0];
      if (!sent || daysBetween(sent.on, now) < s.sentNoAnswerDays) continue;
      alerts.push({
        kind: 'SENT_NO_ANSWER',
        requestId: r.id,
        folio: r.folio,
        groupName: r.groupName,
        quoteId: sent.id,
        detail: `Enviada el ${iso(sent.on)}, ${plural(daysBetween(sent.on, now))} sin respuesta del colegio`,
        userIds: uniq([r.requesterId, r.assigneeId]),
      });
    }
  }

  if (s.paymentReminderDays) {
    const rows = await prisma.travelRequest.findMany({
      where: { ...inOffices, status: 'WON', wonVersionId: { not: null } },
      select: {
        id: true,
        folio: true,
        groupName: true,
        requesterId: true,
        assigneeId: true,
        wonVersion: { include: full },
      },
    });
    const today = iso(now);
    const until = iso(new Date(startOfDay(now).getTime() + s.paymentReminderDays * DAY));
    for (const r of rows) {
      if (!r.wonVersion?.paymentPlan) continue;
      for (const p of toDto(r.wonVersion).paymentSchedule ?? []) {
        if (p.dueDate < today || p.dueDate > until) continue;
        alerts.push({
          kind: 'PAYMENT_DUE',
          requestId: r.id,
          folio: r.folio,
          groupName: r.groupName,
          quoteId: r.wonVersion.id,
          detail: `${p.number === 0 ? 'La inscripción' : `El pago ${p.number}`} de los alumnos vence el ${p.dueDate}`,
          userIds: uniq([r.requesterId, r.assigneeId]),
        });
      }
    }
  }
  return alerts;
}

const DIGEST_KEY = 'alerts.lastDigest';

/**
 * One email per person with everything overdue, agency by agency with its own thresholds,
 * at most once per day per agency (a retried job is a no-op).
 * Same rule as the other notices: folio, group, what is pending and a link; no prices.
 */
export async function sendDigest(prisma: PrismaClient, mailer: Mailer, webOrigin: string, now = new Date()) {
  const agencies = await prisma.agency.findMany({
    where: { active: true },
    select: { id: true, offices: { select: { id: true } } },
  });
  const totals = { alerts: 0, sent: 0, of: 0, skipped: 0 };
  for (const a of agencies) {
    const r = await sendAgencyDigest(
      prisma,
      mailer,
      webOrigin,
      a.id,
      a.offices.map((o) => o.id),
      now,
    );
    if ('skipped' in r) totals.skipped++;
    else {
      totals.alerts += r.alerts;
      totals.sent += r.sent;
      totals.of += r.of;
    }
  }
  return totals;
}

async function sendAgencyDigest(
  prisma: PrismaClient,
  mailer: Mailer,
  webOrigin: string,
  agencyId: string,
  officeIds: string[],
  now: Date,
) {
  const today = iso(now);
  const key = { agencyId_key: { agencyId, key: DIGEST_KEY } };
  const last = await prisma.appSetting.findUnique({ where: key });
  if (last?.value === today) return { skipped: 'already sent today' };
  const alerts = await computeAlerts(prisma, officeIds, await alertSettings(prisma, agencyId), now);
  const users = await prisma.user.findMany({
    where: { id: { in: uniq(alerts.flatMap((a) => a.userIds)) }, status: { not: 'DISABLED' } },
    select: { id: true, email: true },
  });
  let sent = 0;
  for (const u of users) {
    const mine = alerts.filter((a) => a.userIds.includes(u.id));
    const lines = mine.map(
      (a) =>
        `- ${ALERT_LABEL[a.kind]} · ${a.folio} ${a.groupName}\n  ${a.detail}\n  ${webOrigin}${a.quoteId ? `/cotizaciones/${a.quoteId}` : `/solicitudes/${a.requestId}`}`,
    );
    const text = [
      'Hola:',
      '',
      mine.length === 1 ? 'Tienes 1 pendiente atrasado:' : `Tienes ${mine.length} pendientes atrasados:`,
      '',
      ...lines,
      '',
      'Cotizador de Estudiantes Embajadores. Aviso automático, no respondas este correo.',
    ].join('\n');
    // One failed address must not stop the rest; the error code is enough to diagnose.
    try {
      await mailer.send({ to: u.email, subject: `Pendientes atrasados (${mine.length})`, text });
      sent++;
    } catch {
      /* counted as not sent */
    }
  }
  await prisma.appSetting.upsert({
    where: key,
    create: { agencyId, key: DIGEST_KEY, value: today },
    update: { value: today },
  });
  return { alerts: alerts.length, sent, of: users.length };
}
