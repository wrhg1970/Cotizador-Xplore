import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@ee/db';
import nodemailer, { type Transporter } from 'nodemailer';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import { Pusher } from './push.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** Branded version for clients; `text` stays as the plain-text part. */
  html?: string;
}

/** Seam for tests; null in the container means notices are off (no SMTP configured). */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}
export const MAILER = Symbol('MAILER');

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    cfg: { host: string; port: number; user: string; password: string },
    private readonly from: string,
  ) {
    // 465 = implicit TLS; any other port must upgrade with STARTTLS, never plain text.
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      requireTLS: cfg.port !== 465,
      auth: { user: cfg.user, pass: cfg.password },
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
  }
}

export type Notice =
  | { kind: 'ASSIGNED'; requestId: string }
  | { kind: 'REVIEW_REQUESTED' | 'RETURNED' | 'APPROVED' | 'ACCEPTED'; versionId: string };

const COPY: Record<Notice['kind'], { subject: string; line: string }> = {
  ASSIGNED: { subject: 'Te asignaron la solicitud', line: 'Te asignaron una solicitud para cotizar.' },
  REVIEW_REQUESTED: {
    subject: 'Cotización por autorizar',
    line: 'Hay una cotización esperando tu autorización.',
  },
  RETURNED: {
    subject: 'Te devolvieron la cotización',
    line: 'La cotización regresó con comentarios; revísalos en el cotizador.',
  },
  APPROVED: {
    subject: 'Cotización autorizada',
    line: 'La cotización fue autorizada y ya puede enviarse al cliente.',
  },
  ACCEPTED: {
    subject: 'El colegio aceptó la propuesta',
    line: 'El colegio aceptó la propuesta en línea; la solicitud quedó como ganada.',
  },
};

interface Target {
  folio: string;
  groupName: string;
  path: string;
  userIds: string[];
}

/**
 * Workflow notices by email. Only folio, group and a link: never prices, costs or comments,
 * which stay behind the login. Failures are logged and never undo the action that triggered them.
 */
@Injectable()
export class Notifier {
  private readonly logger = new Logger('Notifier');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
    @Inject(MAILER) private readonly mailer: Mailer | null,
    private readonly pusher: Pusher,
  ) {}

  // shortcut: sent in-process after commit with no retry; a lost notice is not recovered. Add a queue if that matters.
  /** Email and device push; resolves once sent (or skipped), never rejects, so callers can fire and forget. */
  async notify(notice: Notice, actorId: string): Promise<void> {
    try {
      const target = await this.target(notice);
      if (!target) return;
      const users = await this.prisma.user.findMany({
        where: { id: { in: target.userIds.filter((id) => id !== actorId) }, status: { not: 'DISABLED' } },
        select: { id: true, email: true },
      });
      const { subject, line } = COPY[notice.kind];
      // Same content rule for push: folio, group and a link, never prices.
      await this.pusher.push(
        users.map((u) => u.id),
        {
          title: `${subject} ${target.folio}`,
          body: `${target.groupName}. ${line}`,
          url: target.path,
          tag: `${notice.kind}:${target.path}`,
        },
      );
      if (!this.mailer) return;
      const text = [
        'Hola:',
        '',
        line,
        '',
        `Folio: ${target.folio}`,
        `Grupo: ${target.groupName}`,
        `${this.env.WEB_ORIGIN}${target.path}`,
        '',
        'Cotizador de Estudiantes Embajadores. Aviso automático, no respondas este correo.',
      ].join('\n');
      for (const u of users)
        await this.mailer.send({ to: u.email, subject: `${subject} ${target.folio}`, text });
    } catch (err) {
      // No addresses or message content in logs: SMTP errors can echo recipients.
      const code = (err as { code?: string; responseCode?: number }).code ?? 'UNKNOWN';
      this.logger.warn({ notice: notice.kind, code });
    }
  }

  private async target(notice: Notice): Promise<Target | null> {
    if (notice.kind === 'ASSIGNED') {
      const r = await this.prisma.travelRequest.findUnique({ where: { id: notice.requestId } });
      return r?.assigneeId
        ? { folio: r.folio, groupName: r.groupName, path: `/solicitudes/${r.id}`, userIds: [r.assigneeId] }
        : null;
    }
    const v = await this.prisma.quoteVersion.findUnique({
      where: { id: notice.versionId },
      select: { id: true, createdById: true, scenario: { select: { request: true } } },
    });
    if (!v) return null;
    const r = v.scenario.request;
    const quoters = [v.createdById, ...(r.assigneeId ? [r.assigneeId] : [])];
    const userIds =
      notice.kind === 'REVIEW_REQUESTED'
        ? // Same rule as QuotesController.assertReviewer: never whoever built or quotes this version.
          (
            await this.prisma.userOfficeRole.findMany({
              where: { officeId: r.officeId, role: 'APPROVER', userId: { notIn: quoters } },
              select: { userId: true },
            })
          ).map((x) => x.userId)
        : notice.kind === 'ACCEPTED'
          ? [...quoters, r.requesterId]
          : quoters;
    return {
      folio: r.folio,
      groupName: r.groupName,
      path: `/cotizaciones/${v.id}`,
      userIds: [...new Set(userIds)],
    };
  }
}
