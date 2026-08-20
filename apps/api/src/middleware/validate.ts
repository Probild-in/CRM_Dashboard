import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import type { FieldError } from '@probild/shared';
import { ValidationError } from '../lib/errors.js';

interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function toFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_root',
    message: issue.message,
  }));
}

/**
 * Validates and replaces `req.body` / `req.query` / `req.params` with the
 * parsed result, so handlers receive coerced, trusted values.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query);
        // Express 5 exposes `query` as a getter; redefine instead of assigning.
        Object.defineProperty(req, 'query', { value: parsedQuery, writable: true });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('The submitted data is invalid.', toFieldErrors(error)));
        return;
      }
      next(error);
    }
  };
}
