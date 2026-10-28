import { createPrivateKey } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Logger, Post } from '@nestjs/common';
import type { PrismaClient } from '@ee/db';
import webpush from 'web-push';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Path inside the app, opened on tap. */
  url: string;
  tag: string;
}

/** Seam for tests; null when VAPID_PRIVATE_KEY is unset. */
export interface PushSender {
  publicKey: string;
  send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string): Promise<void>;
}
export const PUSH_SENDER = Symbol('PUSH_SENDER');

/** Error the push service returns for a subscription that no longer exists. */
export class GoneSubscription extends Error {}

export class VapidPushSender implements PushSender {
  readonly publicKey: string;
  private readonly privateKey: string;

  constructor(
    pem: string,
    private readonly subject: string,
  ) {
    // The PEM is the only secret; the two base64url keys web-push wants come from its JWK.
    const jwk = createPrivateKey(pem).export({ format: 'jwk' });
    const b = (s: string | undefined) => Buffer.from(s ?? '', 'base64url');
    this.publicKey = Buffer.concat([Buffer.from([4]), b(jwk.x), b(jwk.y)]).toString('base64url');
    this.privateKey = jwk.d!;
  }

  async send(sub: { endpoint: string; p256dh: string; auth: string }, payload: string) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        {
          vapidDetails: { subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey },
          TTL: 24 * 3600,
          timeout: 10_000,
        },
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) throw new GoneSubscription();
      throw e;
    }
  }
}

/** Sends to every device of each user; dead subscriptions are dropped, other failures only logged. */
@Injectable()
export class Pusher {
  private readonly logger = new Logger('Pusher');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
  ) {}

  async push(userIds: string[], msg: PushMessage): Promise<void> {
    if (!this.sender || !userIds.length) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
    const payload = JSON.stringify(msg);
    for (const s of subs) {
      try {
        await this.sender.send(s, payload);
      } catch (e) {
        if (e instanceof GoneSubscription)
          await this.prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        // The endpoint identifies a device: never logged.
        else
          this.logger.warn({
            push: msg.tag.split(':')[0],
            code: (e as { statusCode?: number }).statusCode ?? 'ERROR',
          });
      }
    }
  }
}

const Subscription = z.strictObject({
  endpoint: z.url({ protocol: /^https$/ }).max(1000),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});
const Unsubscribe = z.strictObject({ endpoint: z.string().max(1000) });

@Controller('push')
export class PushController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
  ) {}

  @Get('key')
  key() {
    return { publicKey: this.sender?.publicKey ?? null };
  }

  /** Registers this browser for the signed-in user; re-subscribing moves the endpoint to them. */
  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(Subscription)) body: z.infer<typeof Subscription>,
  ) {
    const data = { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { endpoint: body.endpoint, ...data },
      update: data,
    });
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(Unsubscribe)) body: z.infer<typeof Unsubscribe>,
  ) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: user.id } });
  }
}
