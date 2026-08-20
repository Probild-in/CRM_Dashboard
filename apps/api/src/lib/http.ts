import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiSuccess, PaginationMeta } from '@probild/shared';

/** Writes the standard success envelope. */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: ApiSuccess<T>['meta'],
): Response {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return res.status(statusCode).json(body);
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  meta: PaginationMeta,
  statusCode = 200,
): Response {
  return sendSuccess(res, items, statusCode, meta);
}

export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}

/**
 * Wraps an async handler so a rejected promise reaches the error middleware
 * instead of hanging the request.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
