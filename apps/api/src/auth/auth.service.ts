import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from './auth.types.js';
import type { IdClaims } from './oidc.js';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type LoginFailure =
  'EMAIL_NOT_VERIFIED' | 'DOMAIN_NOT_ALLOWED' | 'NOT_INVITED' | 'DISABLED' | 'ACCOUNT_MISMATCH';

export class LoginRejected extends Error {
  constructor(readonly reason: LoginFailure) {
    super(reason);
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Validates Google claims against EE policy and opens a session. Returns the raw cookie token. */
  async login(claims: IdClaims, correlationId: string): Promise<string> {
    const email = claims.email?.toLowerCase();
    try {
      if (!email || claims.email_verified !== true) throw new LoginRejected('EMAIL_NOT_VERIFIED');
      const domain = email.split('@')[1] ?? '';
      // Both hd and the email domain must match: hd proves a Workspace account, not a Gmail alias.
      const allowed = this.env.ALLOWED_GOOGLE_DOMAINS;
      if (!allowed.includes(domain) || !claims.hd || !allowed.includes(claims.hd.toLowerCase())) {
        throw new LoginRejected('DOMAIN_NOT_ALLOWED');
      }

      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { email } });
        if (!user) throw new LoginRejected('NOT_INVITED');
        if (user.status === 'DISABLED') throw new LoginRejected('DISABLED');
        if (user.googleSub && user.googleSub !== claims.sub) throw new LoginRejected('ACCOUNT_MISMATCH');

        await tx.user.update({
          where: { id: user.id },
          data: { googleSub: claims.sub, status: 'ACTIVE', ...(claims.name ? { name: claims.name } : {}) },
        });
        const token = randomBytes(32).toString('base64url');
        const session = await tx.session.create({
          data: {
            tokenHash: hashToken(token),
            userId: user.id,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
          },
        });
        await audit(tx, {
          actorUserId: user.id,
          action: 'auth.login',
          entityType: 'Session',
          entityId: session.id,
          correlationId,
        });
        return token;
      });
    } catch (err) {
      if (err instanceof LoginRejected) {
        // Domain only, never the full address or token.
        this.logger.warn({ correlationId, reason: err.reason, domain: email?.split('@')[1] });
        await audit(this.prisma, {
          actorUserId: null,
          action: 'auth.login_rejected',
          entityType: 'Auth',
          entityId: err.reason,
          correlationId,
        });
      }
      throw err;
    }
  }

  /** Resolves a session cookie to an ACTIVE user; disabled users lose access on their next request (US-002). */
  async userForToken(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { officeRoles: { include: { office: true } } } } },
    });
    if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return null;
    const { user } = session;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.officeRoles
        .filter((r) => r.office.active)
        .map((r) => ({ officeId: r.officeId, role: r.role })),
    };
  }

  async logout(token: string, actorUserId: string, correlationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.session.deleteMany({ where: { tokenHash: hashToken(token) } });
      if (count) {
        await audit(tx, {
          actorUserId,
          action: 'auth.logout',
          entityType: 'User',
          entityId: actorUserId,
          correlationId,
        });
      }
    });
  }
}
