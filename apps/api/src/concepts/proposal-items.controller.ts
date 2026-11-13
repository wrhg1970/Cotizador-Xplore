import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ProposalItemInput, UpdateProposalItem } from '@ee/contracts';
import { Prisma, type PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import type { AuthUser } from '../auth/auth.types.js';
import { isSystemAdmin } from '../auth/authz.js';
import { CurrentUser } from '../auth/session.guard.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

const uuid = new ParseUUIDPipe({ version: '4' });
const duplicate = (e: unknown) => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
    throw new ConflictException({
      code: 'DUPLICATE',
      message: 'Ya existe ese concepto en el catálogo',
    });
  throw e;
};

/** The agency's Incluye / No incluye phrases: everyone reads the active ones, only its system admins maintain them. */
@Controller('proposal-items')
export class ProposalItemsController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.proposalItem.findMany({
      where: { agencyId: user.agencyId, ...(isSystemAdmin(user) ? {} : { active: true }) },
      orderBy: [{ excluded: 'asc' }, { position: 'asc' }, { label: 'asc' }],
      omit: { agencyId: true, createdAt: true, updatedAt: true },
    });
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Body(new ZodPipe(ProposalItemInput)) body: ProposalItemInput,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    return this.prisma
      .$transaction(async (tx) => {
        const t = await tx.proposalItem.create({ data: { ...body, agencyId: user.agencyId } });
        await audit(tx, {
          actorUserId: user.id,
          action: 'proposal_item.created',
          entityType: 'ProposalItem',
          entityId: t.id,
          correlationId: req.correlationId,
          diff: body,
        });
        return t;
      })
      .catch(duplicate);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(UpdateProposalItem)) body: UpdateProposalItem,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    return this.prisma
      .$transaction(async (tx) => {
        const before = await tx.proposalItem.findFirst({ where: { id, agencyId: user.agencyId } });
        if (!before) throw new NotFoundException('Concepto no encontrado');
        const t = await tx.proposalItem.update({ where: { id }, data: body });
        await audit(tx, {
          actorUserId: user.id,
          action: 'proposal_item.updated',
          entityType: 'ProposalItem',
          entityId: id,
          correlationId: req.correlationId,
          diff: Object.fromEntries(
            Object.entries(body).map(([k, to]) => [k, { from: before[k as keyof typeof body], to }]),
          ),
        });
        return t;
      })
      .catch(duplicate);
  }
}
