import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { ApiError } from '@ee/contracts';

/** API_SPEC.md error shape; never leaks stack traces to the client. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const correlationId = req.header('x-correlation-id') ?? randomUUID();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error({
        correlationId,
        path: req.path,
        err: exception instanceof Error ? exception.stack : exception,
      });
    }
    const body: ApiError = {
      code: status >= 500 ? 'INTERNAL_ERROR' : (HttpStatus[status] ?? 'ERROR'),
      message:
        status >= 500 ? 'Error interno' : exception instanceof HttpException ? exception.message : 'Error',
      correlationId,
      details: [],
    };
    res.status(status).setHeader('x-correlation-id', correlationId).json(body);
  }
}
