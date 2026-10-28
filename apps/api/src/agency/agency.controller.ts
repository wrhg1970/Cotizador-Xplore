import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AgencyBrandingInput, MAX_LOGO_BYTES, UploadLogo } from '@ee/contracts';
import { Prisma, type PrismaClient } from '@ee/db';
import type { z } from 'zod';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isSystemAdmin } from '../auth/authz.js';
import { CurrentUser, Public } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { sniffMime } from '../requests/attachment-mime.js';
import { ZodPipe } from '../zod.pipe.js';
import { agencyOfHost, BRAND_OMIT, toBrand } from './brand.js';

const uuid = new ParseUUIDPipe({ version: '4' });

/** Branding per agency (Administración → Marca): everyone reads their own, its system admins change it. */
@Controller()
export class AgencyController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private admin(user: AuthUser) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
  }

  @Get('agency/brand')
  async brand(@CurrentUser() user: AuthUser) {
    return toBrand(
      await this.prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId }, omit: BRAND_OMIT }),
    );
  }

  /** Login and landing pages: the brand of the hostname they were opened on (public data only). */
  @Public()
  @Get('branding')
  async byHost(@Req() req: Request) {
    const host = req.header('x-forwarded-host')?.split(',')[0]?.trim() ?? req.hostname;
    const { proposalFooter: _f, mailFromName: _m, ...brand } = toBrand(await agencyOfHost(this.prisma, host));
    return brand;
  }

  @Put('agency/brand')
  async update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(AgencyBrandingInput)) body: AgencyBrandingInput,
  ) {
    this.admin(user);
    return this.prisma
      .$transaction(async (tx) => {
        const a = await tx.agency.update({ where: { id: user.agencyId }, data: body, omit: BRAND_OMIT });
        await audit(tx, {
          actorUserId: user.id,
          action: 'agency.brand_updated',
          entityType: 'Agency',
          entityId: user.agencyId,
          correlationId: req.correlationId,
          diff: body,
        });
        return toBrand(a);
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
          throw new ConflictException('Ese dominio ya lo usa otra agencia');
        throw e;
      });
  }

  @Put('agency/logo')
  async uploadLogo(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(UploadLogo)) body: z.infer<typeof UploadLogo>,
  ) {
    this.admin(user);
    const content = Buffer.from(body.fileBase64, 'base64');
    const mime = sniffMime(content, body.fileName);
    if (!content.length || content.length > MAX_LOGO_BYTES || !mime?.startsWith('image/'))
      throw new BadRequestException({ code: 'LOGO', message: 'El logo debe ser PNG o JPG de hasta 512 KB' });
    return this.setLogo(user, req, { logo: content, logoMime: mime, logoUpdatedAt: new Date() });
  }

  @Delete('agency/logo')
  async removeLogo(@CurrentUser() user: AuthUser, @Req() req: Request) {
    this.admin(user);
    return this.setLogo(user, req, { logo: null, logoMime: null, logoUpdatedAt: null });
  }

  private setLogo(
    user: AuthUser,
    req: Request,
    data: { logo: Uint8Array<ArrayBuffer> | null; logoMime: string | null; logoUpdatedAt: Date | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.agency.update({ where: { id: user.agencyId }, data, omit: BRAND_OMIT });
      await audit(tx, {
        actorUserId: user.id,
        action: data.logo ? 'agency.logo_updated' : 'agency.logo_removed',
        entityType: 'Agency',
        entityId: user.agencyId,
        correlationId: req.correlationId,
        diff: { mime: data.logoMime, size: data.logo?.length ?? 0 },
      });
      return toBrand(a);
    });
  }

  /** Public: the login page shows it before anyone signs in. Only bytes that passed the type check. */
  @Public()
  @Get('agencies/:id/logo')
  @HttpCode(200)
  async logo(@Param('id', uuid) id: string, @Res() res: Response) {
    const a = await this.prisma.agency.findUnique({ where: { id }, select: { logo: true, logoMime: true } });
    if (!a?.logo || !a.logoMime) throw new NotFoundException();
    res
      .set('Content-Type', a.logoMime)
      .set('X-Content-Type-Options', 'nosniff')
      .set('Cache-Control', 'public, max-age=86400')
      .send(Buffer.from(a.logo));
  }
}
