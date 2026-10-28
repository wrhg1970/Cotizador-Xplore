import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseEnumPipe,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { EditableRole, RolePolicyInput } from '@ee/contracts';
import { Prisma, type PrismaClient } from '@ee/db';
import { audit } from '../audit.js';
import { PRISMA } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import type { AuthUser } from './auth.types.js';
import { DEFAULT_POLICIES, isSystemAdmin, toPolicy } from './authz.js';
import { CurrentUser } from './session.guard.js';

const role = new ParseEnumPipe(EditableRole.enum);

/** Configurable permissions per role and agency; only its system admins see or change them, every change is audited. */
@Controller('role-policies')
export class RolePoliciesController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    const rows = await this.prisma.rolePolicy.findMany({ where: { agencyId: user.agencyId } });
    return EditableRole.options.map((r) => {
      const row = rows.find((x) => x.role === r);
      return { role: r, ...(row ? toPolicy(row) : DEFAULT_POLICIES[r]) };
    });
  }

  @Put(':role')
  update(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Param('role', role) r: EditableRole,
    @Body(new ZodPipe(RolePolicyInput)) body: RolePolicyInput,
  ) {
    if (!isSystemAdmin(user)) throw new ForbiddenException('Solo un administrador del sistema');
    return this.prisma.$transaction(async (tx) => {
      const key = { agencyId_role: { agencyId: user.agencyId, role: r } };
      const before = await tx.rolePolicy.findUnique({ where: key });
      const data = {
        ...body,
        approvalLimitMxn: body.approvalLimitMxn === null ? null : new Prisma.Decimal(body.approvalLimitMxn),
        updatedById: user.id,
      };
      const after = await tx.rolePolicy.upsert({
        where: key,
        create: { agencyId: user.agencyId, role: r, ...data },
        update: data,
      });
      await audit(tx, {
        actorUserId: user.id,
        action: 'role_policy.updated',
        entityType: 'RolePolicy',
        entityId: r,
        correlationId: req.correlationId,
        diff: { before: before ? toPolicy(before) : DEFAULT_POLICIES[r], after: toPolicy(after) },
      });
      return { role: r, ...toPolicy(after) };
    });
  }
}
