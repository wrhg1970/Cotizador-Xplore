import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/session.guard.js';
import type { HealthResponse } from '@ee/contracts';

@Public()
@Controller('health')
export class HealthController {
  // Liveness only: no versions, hostnames or dependency details (US-128).
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
