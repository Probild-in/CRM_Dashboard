import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiErrorCode, type ApiError } from '@probild/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProduction } from '../config/env.js';
import { toFieldErrors } from './validate.js';

/** Prisma signals a unique-constraint breach with P2002 and a missing row with P2025. */
function fromPrismaError(error: { code?: string; meta?: unknown }): AppError | null {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta as { target?: string[] } | undefined)?.target;
      const field = Array.isArray(target) ? target.join(', ') : 'value';
      return new AppError(
        `A record with this ${field} already exists.`,
        409,
        ApiErrorCode.CONFLICT,
      );
    }
    case 'P2003':
      return new AppError(
        'A related record is missing or still in use.',
        409,
        ApiErrorCode.CONFLICT,
      );
    case 'P2025':
      return new AppError('The requested record was not found.', 404, ApiErrorCode.NOT_FOUND);
    default:
      return null;
  }
}

function normalise(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof ZodError) {
    return new AppError(
      'The submitted data is invalid.',
      400,
      ApiErrorCode.VALIDATION_ERROR,
      toFieldErrors(error),
    );
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const mapped = fromPrismaError(error as { code?: string; meta?: unknown });
    if (mapped) {
      return mapped;
    }
  }
  // Multer signals a rejected upload with a code rather than an AppError.
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      return new AppError(
        'That file is too large. Send something smaller.',
        413,
        ApiErrorCode.PAYLOAD_TOO_LARGE,
      );
    }
    if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') {
      return new AppError('Send one file at a time.', 400, ApiErrorCode.VALIDATION_ERROR);
    }
  }

  if (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as unknown as { status: number }).status === 400
  ) {
    return new AppError('The request body is not valid JSON.', 400, ApiErrorCode.VALIDATION_ERROR);
  }
  return new AppError(
    'Something went wrong. Please try again.',
    500,
    ApiErrorCode.INTERNAL_ERROR,
    undefined,
    false,
  );
}

/**
 * The single place that turns a thrown value into an HTTP response.
 * Stack traces are logged, never sent to the client in production.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = normalise(error);

  const logPayload = {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id,
    statusCode: appError.statusCode,
    code: appError.code,
    err: error,
  };

  if (appError.isOperational && appError.statusCode < 500) {
    logger.warn(logPayload, appError.message);
  } else {
    logger.error(logPayload, 'Unhandled application error');
  }

  const body: ApiError = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
    requestId: req.requestId,
  };

  if (!isProduction && !appError.isOperational && error instanceof Error) {
    (body.error as Record<string, unknown>).stack = error.stack;
  }

  res.status(appError.statusCode).json(body);
}
