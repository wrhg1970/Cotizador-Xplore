import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@ee/contracts';

interface ErrorBody {
  code?: string;
  message?: string | string[];
  details?: unknown[];
}

/** API_SPEC.md error shape; never leaks stack traces to the client. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const correlationId = req.correlationId;
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : undefined;
    const custom: ErrorBody = typeof raw === 'object' && raw !== null ? (raw as ErrorBody) : {};

    // Only unexpected errors are masked; HttpExceptions (incl. 503) carry deliberate, safe messages.
    const unexpected = !(exception instanceof HttpException);
    if (status >= 500) {
      this.logger.error({
        correlationId,
        path: req.path,
        err: exception instanceof Error ? exception.stack : exception,
      });
    }
    const body: ApiError = {
      code: unexpected ? 'INTERNAL_ERROR' : (custom.code ?? HttpStatus[status] ?? 'ERROR'),
      message: unexpected
        ? 'Error interno'
        : typeof custom.message === 'string'
          ? custom.message
          : exception instanceof Error
            ? exception.message
            : 'Error',
      correlationId,
      details: custom.details ?? [],
    };
    res.status(status).json(body);
  }
}
