import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@ee/db';
import { Public } from './auth/session.guard.js';
import type { HealthResponse } from '@ee/contracts';
import { PRISMA } from './prisma.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  // Liveness only: no versions, hostnames or dependency details (US-128).
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }

  /** For the uptime check: also proves the database answers. Same opaque body, 503 when it doesn't. */
  @Get('ready')
  async ready(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException();
    }
    return { status: 'ok' };
  }
}
