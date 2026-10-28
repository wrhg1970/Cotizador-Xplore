import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import type { PrismaClient } from '@ee/db';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../prisma.service.js';
import { LoginRejected, AuthService, SESSION_TTL_MS } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { type LoginChecks, newLoginChecks, OIDC, type OidcProvider } from './oidc.js';
import { CurrentUser, Public, SESSION_COOKIE } from './session.guard.js';

const LOGIN_COOKIE = 'ee_oidc';
const LOGIN_TTL_MS = 10 * 60 * 1000;

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly auth: AuthService,
    @Inject(OIDC) private readonly oidc: OidcProvider | null,
    @Inject(ENV) private readonly env: Env,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /** https://{domain} when the login was opened on an agency's own domain; null = the default deployment. */
  private async customOrigin(req: Request): Promise<string | null> {
    const host = (req.header('x-forwarded-host')?.split(',')[0]?.trim() ?? req.hostname).toLowerCase();
    const a = await this.prisma.agency.findFirst({
      where: { customDomain: host.replace(/:\d+$/, ''), active: true },
      select: { customDomain: true },
    });
    return a?.customDomain ? `https://${a.customDomain}` : null;
  }

  private cookie(path: string, maxAge: number): CookieOptions {
    return { httpOnly: true, secure: this.env.NODE_ENV === 'production', sameSite: 'lax', path, maxAge };
  }

  private provider(): OidcProvider {
    if (!this.oidc)
      throw new ServiceUnavailableException('El inicio de sesión con Google aún no está configurado');
    return this.oidc;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('google/login')
  async login(@Req() req: Request, @Res() res: Response): Promise<void> {
    const checks = newLoginChecks();
    const origin = await this.customOrigin(req);
    const url = await this.provider().authorizationUrl(
      checks,
      origin ? `${origin}/api/v1/auth/google/callback` : undefined,
    );
    // The origin rides in the signed cookie, so the callback never trusts a host header for redirects.
    res
      .cookie(LOGIN_COOKIE, JSON.stringify({ ...checks, origin }), {
        ...this.cookie('/api/v1/auth', LOGIN_TTL_MS),
        signed: true,
      })
      .redirect(302, url.href);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('google/callback')
  async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const provider = this.provider();
    res.clearCookie(LOGIN_COOKIE, { path: '/api/v1/auth' });
    const raw: unknown = req.signedCookies?.[LOGIN_COOKIE];
    const { origin, ...checks } =
      typeof raw === 'string'
        ? (JSON.parse(raw) as LoginChecks & { origin: string | null })
        : { origin: null };
    const web = origin ?? this.env.WEB_ORIGIN;
    const fail = (reason: string) => res.redirect(302, `${web}/login?error=${reason}`);
    if (typeof raw !== 'string') return fail('LOGIN_EXPIRED');

    let token: string;
    try {
      const claims = await provider.exchange(
        new URL(req.originalUrl, origin ?? this.env.API_PUBLIC_URL),
        checks as LoginChecks,
      );
      token = await this.auth.login(claims, req.correlationId);
    } catch (err) {
      if (err instanceof LoginRejected) return fail(err.reason);
      // OAuth error codes (e.g. invalid_client) are safe to log; tokens never reach this object.
      const { name, message, error, error_description } = err as Error & Record<string, unknown>;
      this.logger.error({ correlationId: req.correlationId, name, message, error, error_description });
      return fail('LOGIN_FAILED');
    }
    res.cookie(SESSION_COOKIE, token, this.cookie('/', SESSION_TTL_MS)).redirect(302, web);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    await this.auth.logout(String(req.cookies[SESSION_COOKIE]), user.id, req.correlationId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
