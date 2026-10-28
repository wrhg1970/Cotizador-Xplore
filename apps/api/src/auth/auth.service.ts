import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import type { AuthUser } from './auth.types.js';
import { isSystemAdmin, toPolicy } from './authz.js';
import { agencyDomains } from '../agency/brand.js';
import type { IdClaims } from './oidc.js';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type LoginFailure =
  'EMAIL_NOT_VERIFIED' | 'DOMAIN_NOT_ALLOWED' | 'NOT_INVITED' | 'DISABLED' | 'ACCOUNT_MISMATCH';

export class LoginRejected extends Error {
  constructor(
    readonly reason: LoginFailure,
    /** Agency of the account, when one matched; null = platform-level entry. */
    readonly agencyId?: string,
  ) {
    super(reason);
  }
}

const userInclude = {
  officeRoles: { include: { office: true } },
  agency: { include: { offices: { select: { id: true } }, rolePolicies: true } },
} satisfies Prisma.UserInclude;

function toAuthUser(user: Prisma.UserGetPayload<{ include: typeof userInclude }>): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    agencyId: user.agencyId,
    agencyOfficeIds: user.agency.offices.map((o) => o.id),
    roles: user.officeRoles
      .filter((r) => r.office.active)
      .map((r) => ({ officeId: r.officeId, role: r.role })),
    policies: Object.fromEntries(user.agency.rolePolicies.map((p) => [p.role, toPolicy(p)])),
  };
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Validates Google claims against the agency's policy and opens a session. Returns the raw cookie token. */
  async login(claims: IdClaims, correlationId: string): Promise<string> {
    const email = claims.email?.toLowerCase();
    try {
      if (!email || claims.email_verified !== true) throw new LoginRejected('EMAIL_NOT_VERIFIED');
      const domain = email.split('@')[1] ?? '';

      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { email }, include: { agency: true } });
        if (!user)
          throw new LoginRejected((await this.knownDomain(domain)) ? 'NOT_INVITED' : 'DOMAIN_NOT_ALLOWED');
        // Both hd and the email domain must be the agency's: hd proves a Workspace account, not a Gmail alias.
        const allowed = agencyDomains(user.agency, this.env);
        if (!allowed.includes(domain) || !claims.hd || !allowed.includes(claims.hd.toLowerCase()))
          throw new LoginRejected('DOMAIN_NOT_ALLOWED', user.agencyId);
        if (user.status === 'DISABLED' || !user.agency.active)
          throw new LoginRejected('DISABLED', user.agencyId);
        if (user.googleSub && user.googleSub !== claims.sub)
          throw new LoginRejected('ACCOUNT_MISMATCH', user.agencyId);

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
          ...(err.agencyId && { agencyId: err.agencyId }),
          action: 'auth.login_rejected',
          entityType: 'Auth',
          entityId: err.reason,
          correlationId,
        });
      }
      throw err;
    }
  }

  /** Some agency (or EE's environment list) accepts this domain: then a missing user is "not invited". */
  private async knownDomain(domain: string): Promise<boolean> {
    return (
      this.env.ALLOWED_GOOGLE_DOMAINS.includes(domain) ||
      (await this.prisma.agency.count({ where: { allowedDomains: { has: domain }, active: true } })) > 0
    );
  }

  /** Resolves a session cookie to an ACTIVE user; disabled users lose access on their next request (US-002). */
  async userForToken(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: userInclude } },
    });
    const now = Date.now();
    if (!session || session.expiresAt.getTime() <= now || session.user.status !== 'ACTIVE') return null;
    const idle = now - session.lastSeenAt.getTime();
    if (idle > this.env.SESSION_IDLE_MINUTES * 60_000) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      return null;
    }
    // One write per minute at most: enough precision for an idle limit counted in minutes.
    if (idle > 60_000)
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    if (!session.user.agency.active) return null;
    const real = toAuthUser(session.user);
    if (!session.viewAsUserId || !isSystemAdmin(real)) return real;
    // Only active users of the admin's own agency; anything else falls back to the admin.
    const target = await this.prisma.user.findFirst({
      where: { id: session.viewAsUserId, agencyId: real.agencyId, status: 'ACTIVE' },
      include: userInclude,
    });
    return target
      ? { ...toAuthUser(target), simulatedBy: { id: real.id, name: real.name, email: real.email } }
      : real;
  }

  /** "Ver como": stored on the session so every request (and every tab) sees the same user. */
  async setViewAs(token: string, viewAsUserId: string | null): Promise<void> {
    await this.prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { viewAsUserId } });
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
