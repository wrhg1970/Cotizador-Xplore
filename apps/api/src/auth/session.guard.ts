import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV, type Env } from '../env.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';

export const SESSION_COOKIE = 'ee_session';
const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw new UnauthorizedException();
  return user;
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Global: every route needs a valid session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    // CSRF defence in depth on top of SameSite=Lax: state-changing requests must come from the web origin.
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.header('origin');
      if (origin && origin !== new URL(this.env.WEB_ORIGIN).origin)
        throw new ForbiddenException('Origen no permitido');
    }
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user = typeof token === 'string' ? await this.auth.userForToken(token) : null;
    if (!user) throw new UnauthorizedException('Sesión no válida o expirada');
    req.user = user;
    return true;
  }
}
