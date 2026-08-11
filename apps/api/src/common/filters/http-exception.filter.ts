import type { ApiErrorBody } from '@hrms/types';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client';

/**
 * Normalizes every error to the RFC-7807-style body the frontend types
 * against (docs/03-api-structure.md §conventions). Unknown errors become
 * an opaque 500 — internals are never leaked to clients.
 *
 * **Opaque to the client, never opaque to us.** Until now an unexpected
 * exception became "Something went wrong" and was written down nowhere at all,
 * so every 500 this app has ever served was unattributable: the request log
 * recorded that one happened and nothing about why. That is the same shape as
 * the password-reset failure — an error that reached a user leaving no trace —
 * and it is why the first genuine 500 in CI could not be read from its logs.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<{ method?: string; url?: string }>();

    let body: ApiErrorBody;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const payload = typeof res === 'string' ? { message: res } : (res as Record<string, unknown>);
      // nestjs-zod attaches the Zod issues as `errors`; surface them as
      // field-keyed details so forms can map them back onto inputs.
      const details = payload.details ?? zodIssuesToDetails(payload.errors);
      body = {
        statusCode: status,
        error: (payload.error as string) ?? exception.name,
        message: Array.isArray(payload.message)
          ? payload.message.join('; ')
          : ((payload.message as string) ?? exception.message),
        ...(details ? { details: details as ApiErrorBody['details'] } : {}),
      };
    } else if (exception instanceof ZodError) {
      // A schema parsed outside the validation pipe still owes the client
      // field-level errors, not an opaque 500.
      body = {
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'ValidationError',
        message: 'Validation failed',
        details: zodIssuesToDetails(exception.issues) ?? {},
      };
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      body = prismaErrorBody(exception);
    } else {
      body = {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'InternalServerError',
        message: 'Something went wrong',
      };
    }

    /*
     * Anything that reached the client as a 500 gets written down with its
     * stack, whatever produced it — an unknown throw, or a Prisma code this
     * file has no mapping for. A 4xx is the caller's problem and already
     * described in the body; logging those too would bury the ones that matter.
     */
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request?.method ?? '?'} ${request?.url ?? '?'} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(body.statusCode).json(body);
  }
}

/** Maps well-known Prisma errors to client-meaningful statuses. */
function prismaErrorBody(err: Prisma.PrismaClientKnownRequestError): ApiErrorBody {
  switch (err.code) {
    case 'P2002':
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'A record with this value already exists',
      };
    case 'P2003':
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'This record is referenced by other data and cannot be changed',
      };
    case 'P2025':
      return { statusCode: HttpStatus.NOT_FOUND, error: 'NotFound', message: 'Record not found' };
    default:
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'InternalServerError',
        message: 'Something went wrong',
      };
  }
}

function zodIssuesToDetails(errors: unknown): Record<string, string[]> | undefined {
  if (!Array.isArray(errors)) return undefined;
  const details: Record<string, string[]> = {};
  for (const issue of errors as { path?: (string | number)[]; message?: string }[]) {
    const key = issue.path?.join('.') || '_';
    details[key] = [...(details[key] ?? []), issue.message ?? 'Invalid value'];
  }
  return Object.keys(details).length > 0 ? details : undefined;
}
